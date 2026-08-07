import { describe, expect, it } from "vitest";
import {
  buildSearchTextRequest,
  DISCOVERY_FIELD_MASK,
  TEXT_SEARCH_PRO_USD_PER_CALL,
} from "@/server/discovery/fieldmask";
import { buildRunPlan, ANCHORS, CATEGORIES } from "@/server/discovery/plan";
import {
  searchTextResponseSchema,
  newDiscoveredPlaceSchema,
} from "@/server/discovery/schemas";
import {
  coordsExpired,
  expiresWithinDays,
  sweepWouldExpire,
} from "@/server/discovery/ttl";
import {
  createPlacesClient,
  MAX_ATTEMPTS,
  PlacesRequestError,
} from "@/server/discovery/client";
import { runDiscovery } from "@/server/discovery/ingest";
import { withCoordsTtlApplied } from "@/server/discovery/repo";
import { createInstrumentation } from "@/server/instrumentation";
import { createFakeDiscoveryDb } from "./fixtures/fake-discovery-db";
import type { RunCell } from "@/server/discovery/plan";

const CELL: RunCell = buildRunPlan()[0];

describe("field mask (the compliance artifact)", () => {
  it("requests exactly the two storable place fields plus pagination", () => {
    expect(DISCOVERY_FIELD_MASK).toBe("places.id,places.location,nextPageToken");
  });

  it("every built request carries the mask verbatim and pageSize 20", () => {
    const request = buildSearchTextRequest(CELL);
    expect(request.fieldMask).toBe(DISCOVERY_FIELD_MASK);
    expect(request.body.pageSize).toBe(20);
    expect(request.body.pageToken).toBeUndefined();
    expect(request.body.textQuery).toContain("Toronto");
  });

  it("page tokens thread through without altering the mask", () => {
    const request = buildSearchTextRequest(CELL, "token-123");
    expect(request.body.pageToken).toBe("token-123");
    expect(request.fieldMask).toBe(DISCOVERY_FIELD_MASK);
  });
});

describe("run plan", () => {
  it("is the full 7x9 category-anchor cross product, each cell unique", () => {
    const plan = buildRunPlan();
    expect(plan).toHaveLength(CATEGORIES.length * ANCHORS.length);
    expect(plan).toHaveLength(63);
    const keys = new Set(plan.map((c) => `${c.category}:${c.anchor}`));
    expect(keys.size).toBe(plan.length);
  });

  it("all anchors sit inside a Toronto bounding box", () => {
    for (const anchor of ANCHORS) {
      expect(anchor.lat).toBeGreaterThan(43.5);
      expect(anchor.lat).toBeLessThan(43.8);
      expect(anchor.lng).toBeGreaterThan(-79.6);
      expect(anchor.lng).toBeLessThan(-79.2);
    }
  });

  it("parks cells get the widened bias radius", () => {
    const parks = buildRunPlan().filter((c) => c.category === "parks");
    for (const cell of parks) {
      expect(cell.locationBias.circle.radius).toBeGreaterThanOrEqual(2000);
    }
  });
});

describe("response parsing (untrusted input)", () => {
  it("accepts a hit without a location — honest absence, not rejection", () => {
    const parsed = searchTextResponseSchema.parse({
      places: [{ id: "abc" }, { id: "def", location: { latitude: 43.6, longitude: -79.4 } }],
    });
    expect(parsed.places).toHaveLength(2);
    expect(parsed.places?.[0].location).toBeUndefined();
  });

  it("rejects a hit with an empty id or out-of-range coordinates", () => {
    expect(() =>
      searchTextResponseSchema.parse({ places: [{ id: "" }] }),
    ).toThrow();
    expect(() =>
      searchTextResponseSchema.parse({
        places: [{ id: "x", location: { latitude: 91, longitude: 0 } }],
      }),
    ).toThrow();
  });

  it("write boundary refuses non-toronto city and extra fields", () => {
    expect(() =>
      newDiscoveredPlaceSchema.parse({
        city: "london",
        googlePlaceId: "x",
        coords: null,
        fetchedAt: "2026-08-05T12:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      newDiscoveredPlaceSchema.parse({
        city: "toronto",
        googlePlaceId: "x",
        coords: null,
        fetchedAt: "2026-08-05T12:00:00Z",
        name: "smuggled unstorable field",
      }),
    ).toThrow();
  });
});

describe("30-day coordinate TTL", () => {
  const fetched = "2026-08-05T12:00:00Z";

  it("is not expired at 29 days, expired at exactly 30", () => {
    const day29 = new Date("2026-09-03T12:00:00Z");
    const day30 = new Date("2026-09-04T12:00:00Z");
    expect(coordsExpired(fetched, day29)).toBe(false);
    expect(coordsExpired(fetched, day30)).toBe(true);
  });

  it("read guard withholds expired coords even when the sweep has not run", () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      city: "toronto",
      google_place_id: "gp1",
      lat: 43.6,
      lng: -79.4,
      coords_status: "present" as const,
      coords_fetched_at: fetched,
      source: "google_places",
      tier: 1,
      first_discovered_at: fetched,
    };
    const fresh = withCoordsTtlApplied(row, new Date("2026-08-20T12:00:00Z"));
    expect(fresh.coords_status).toBe("present");
    expect(fresh.lat).toBe(43.6);
    const stale = withCoordsTtlApplied(row, new Date("2026-09-10T12:00:00Z"));
    expect(stale.coords_status).toBe("expired");
    expect(stale.lat).toBeNull();
    expect(stale.lng).toBeNull();
  });
});

describe("sweep selection logic (XXX-25, pure mirror of the SQL predicate)", () => {
  const fetched = "2026-08-05T12:00:00Z";
  const day29 = new Date("2026-09-03T12:00:00Z");
  const day30 = new Date("2026-09-04T12:00:00Z");

  it("selects present rows at exactly 30 days, not at 29 — same boundary as coordsExpired", () => {
    const row = { coords_status: "present", coords_fetched_at: fetched };
    expect(sweepWouldExpire(row, day29)).toBe(false);
    expect(sweepWouldExpire(row, day30)).toBe(true);
    // The two layers must agree at the boundary by construction.
    expect(sweepWouldExpire(row, day30)).toBe(coordsExpired(fetched, day30));
  });

  it("never selects absent_at_source or already-expired rows (idempotency)", () => {
    const longAgo = new Date("2027-01-01T00:00:00Z");
    expect(
      sweepWouldExpire({ coords_status: "absent_at_source", coords_fetched_at: null }, longAgo),
    ).toBe(false);
    expect(
      sweepWouldExpire({ coords_status: "expired", coords_fetched_at: fetched }, longAgo),
    ).toBe(false);
  });

  it("expiresWithinDays flags rows whose deadline falls inside the window", () => {
    const row = { coords_status: "present", coords_fetched_at: fetched };
    // Deadline is Sep 4. On Aug 27 that is 8 days out; on Aug 28, 7 days.
    expect(expiresWithinDays(row, new Date("2026-08-27T12:00:00Z"), 7)).toBe(false);
    expect(expiresWithinDays(row, new Date("2026-08-28T12:00:00Z"), 7)).toBe(true);
    // Already expired still counts as "expiring" (it needs action even more).
    expect(expiresWithinDays(row, new Date("2026-09-10T12:00:00Z"), 7)).toBe(true);
    // Non-present rows have no deadline.
    expect(
      expiresWithinDays({ coords_status: "expired", coords_fetched_at: fetched }, day30, 7),
    ).toBe(false);
  });
});

describe("places client retry policy", () => {
  const request = buildSearchTextRequest(CELL);
  const noSleep = () => Promise.resolve();

  function fetchReturning(
    statuses: number[],
    calls: { count: number },
  ): typeof fetch {
    return (async () => {
      const status = statuses[Math.min(calls.count++, statuses.length - 1)];
      if (status === 200) {
        return new Response(JSON.stringify({ places: [] }), { status: 200 });
      }
      return new Response("rate limited", { status });
    }) as unknown as typeof fetch;
  }

  it("retries 429 with backoff then succeeds", async () => {
    const calls = { count: 0 };
    const client = createPlacesClient({
      apiKey: "test-key",
      fetchImpl: fetchReturning([429, 200], calls),
      sleep: noSleep,
    });
    await expect(client.searchText(request)).resolves.toEqual({ places: [] });
    expect(calls.count).toBe(2);
  });

  it("gives up loudly after MAX_ATTEMPTS on persistent 429 — never spins", async () => {
    const calls = { count: 0 };
    const client = createPlacesClient({
      apiKey: "test-key",
      fetchImpl: fetchReturning([429], calls),
      sleep: noSleep,
    });
    await expect(client.searchText(request)).rejects.toThrow("HTTP 429");
    expect(calls.count).toBe(MAX_ATTEMPTS);
  });

  it("aborts immediately on 403 (auth/config) without retrying", async () => {
    const calls = { count: 0 };
    const client = createPlacesClient({
      apiKey: "test-key",
      fetchImpl: fetchReturning([403], calls),
      sleep: noSleep,
    });
    await expect(client.searchText(request)).rejects.toThrow("HTTP 403");
    expect(calls.count).toBe(1);
  });

  it("never leaks the API key into thrown errors", async () => {
    const calls = { count: 0 };
    const client = createPlacesClient({
      apiKey: "SECRET-KEY-VALUE",
      fetchImpl: fetchReturning([400], calls),
      sleep: noSleep,
    });
    const error = await client.searchText(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlacesRequestError);
    expect(String(error)).not.toContain("SECRET-KEY-VALUE");
  });
});

describe("discovery ingestion write path", () => {
  const plan = buildRunPlan().slice(0, 2); // two cells, same category

  function fakePlacesReturning(byQuery: Record<string, unknown>) {
    return {
      searchText: async (req: { body: { textQuery: string } }) =>
        (byQuery[req.body.textQuery] ?? { places: [] }) as never,
    };
  }

  const RESPONSES = {
    [plan[0].textQuery]: {
      places: [
        { id: "gp-a", location: { latitude: 43.65, longitude: -79.38 } },
        { id: "gp-b" }, // no location — absent_at_source
      ],
    },
    [plan[1].textQuery]: {
      places: [
        // gp-a again from a second anchor: dedup + second hit row
        { id: "gp-a", location: { latitude: 43.65, longitude: -79.38 } },
      ],
    },
  };

  async function runOnce(db: ReturnType<typeof createFakeDiscoveryDb>) {
    return runDiscovery({
      supabase: db.client,
      places: fakePlacesReturning(RESPONSES),
      instrumentation: createInstrumentation(db.client),
      plan,
    });
  }

  it("lands rows with correct provenance, honest absence, and hit linkage", async () => {
    const db = createFakeDiscoveryDb();
    const report = await runOnce(db);

    expect(db.places.size).toBe(2);
    const a = db.places.get("gp-a")!;
    expect(a.source).toBe("google_places");
    expect(a.tier).toBe(1);
    expect(a.coords_status).toBe("present");
    expect(a.coords_fetched_at).not.toBeNull();
    const b = db.places.get("gp-b")!;
    expect(b.coords_status).toBe("absent_at_source");
    expect(b.lat).toBeNull();
    expect(b.coords_fetched_at).toBeNull();

    // gp-a surfaced by two cells → two hit rows, both carrying the trace id.
    const aHits = db.hits.filter((h) => h.discovered_place_id === a.id);
    expect(aHits).toHaveLength(2);
    for (const hit of db.hits) expect(hit.trace_id).toBe(report.traceId);

    expect(report.distinctPlaces).toBe(2);
    expect(report.newPlaces).toBe(2);
    expect(report.totalRequests).toBe(2);
  });

  it("logs one trace event per call at LIST price with the verbatim mask", async () => {
    const db = createFakeDiscoveryDb();
    await runOnce(db);
    expect(db.traceEvents).toHaveLength(2);
    for (const event of db.traceEvents) {
      expect(event.provider).toBe("google_places");
      expect(event.endpoint).toBe("places.searchText");
      expect(event.est_cost_usd).toBe(TEXT_SEARCH_PRO_USD_PER_CALL);
      expect(event.metadata.field_mask).toBe(DISCOVERY_FIELD_MASK);
      expect(event.metadata.pricing_basis).toBe("list");
    }
    const trace = db.traces[0];
    expect(trace.kind).toBe("places_discovery");
    expect(trace.finished?.total_cost_usd).toBeCloseTo(
      2 * TEXT_SEARCH_PRO_USD_PER_CALL,
    );
    const meta = trace.finished?.metadata as Record<string, unknown>;
    expect(String(meta.free_tier_note)).toContain("billing offset");
  });

  it("re-running is idempotent: same rows, no duplicate hits, clock refreshed", async () => {
    const db = createFakeDiscoveryDb();
    await runOnce(db);
    const firstDiscovered = db.places.get("gp-a")!.first_discovered_at;
    const hitCount = db.hits.length;

    const second = await runOnce(db);
    expect(db.places.size).toBe(2);
    expect(db.hits.length).toBe(hitCount);
    // first_discovered_at survives the re-run; the retention clock restarts.
    expect(db.places.get("gp-a")!.first_discovered_at).toBe(firstDiscovered);
    expect(second.newPlaces).toBe(0);
    expect(second.distinctPlaces).toBe(2);
  });

  it("a re-discovery without location does not erase live coords", async () => {
    const db = createFakeDiscoveryDb();
    await runOnce(db);
    await runDiscovery({
      supabase: db.client,
      places: fakePlacesReturning({
        [plan[0].textQuery]: { places: [{ id: "gp-a" }] },
      }),
      instrumentation: createInstrumentation(db.client),
      plan: [plan[0]],
    });
    const a = db.places.get("gp-a")!;
    expect(a.coords_status).toBe("present");
    expect(a.lat).toBe(43.65);
  });

  it("a mid-run failure ends the trace honestly and rethrows", async () => {
    const db = createFakeDiscoveryDb();
    const failing = {
      searchText: async (req: { body: { textQuery: string } }) => {
        if (req.body.textQuery === plan[1].textQuery) {
          throw new PlacesRequestError("places.searchText HTTP 429: quota", 429, true);
        }
        return RESPONSES[plan[0].textQuery] as never;
      },
    };
    await expect(
      runDiscovery({
        supabase: db.client,
        places: failing,
        instrumentation: createInstrumentation(db.client),
        plan,
      }),
    ).rejects.toThrow("HTTP 429");
    const meta = db.traces[0].finished?.metadata as Record<string, unknown>;
    expect(meta.outcome).toBe("aborted");
    expect(meta.cells_completed).toBe(1);
    // The one successful call is still costed.
    expect(db.traces[0].finished?.total_cost_usd).toBeCloseTo(
      TEXT_SEARCH_PRO_USD_PER_CALL,
    );
  });
});
