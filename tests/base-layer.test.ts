import { describe, expect, it } from "vitest";
import { matchBreadcrumb } from "../src/server/base-layer/categories";
import { classifyRow } from "../src/server/base-layer/rows";
import {
  nameSimilarity,
  normalizeName,
  T_HIGH,
  T_LOW,
} from "../src/server/base-layer/similarity";
import { buildGrid, haversineMeters } from "../src/server/base-layer/geo";
import { buildMatchPlan, decideMatch, runMatching } from "../src/server/base-layer/match";
import {
  setPlaceGoogleLink,
  upsertBaseLayerPlace,
  upsertCategoriesFact,
  upsertIdentityMatch,
} from "../src/server/base-layer/repo";
import { createInstrumentation } from "../src/server/instrumentation";
import { createFakeBaseDb } from "./fixtures/fake-base-db";
import type { PlaceCategory } from "../src/server/domain/schemas";
import {
  createDetailsClient,
  type DetailsClient,
} from "../src/server/base-layer/details-client";

const ID_MAP: Record<string, PlaceCategory> = {
  cat_cafe: "cafes",
  cat_rest: "restaurants",
  cat_park: "parks",
};

const rawRow = (over: Record<string, unknown> = {}) => ({
  fsq_place_id: "fsq_1",
  name: "Cafe Pamenar",
  latitude: 43.6547,
  longitude: -79.4005,
  address: "307 Augusta Ave",
  category_ids_json: JSON.stringify(["cat_cafe"]),
  category_labels_json: JSON.stringify([
    "Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop",
  ]),
  date_closed: null,
  unresolved_flags_json: null,
  ...over,
});

const PUB = "2026-07-09T00:00:00.000Z";
const newPlace = (over: Record<string, unknown> = {}) => ({
  city: "toronto" as const,
  fsqPlaceId: "fsq_1",
  name: "Cafe Pamenar",
  lat: 43.6547,
  lng: -79.4005,
  address: "307 Augusta Ave" as string | null,
  datasetVersion: "dt=2026-07-09",
  publicationDate: PUB,
  ...over,
});

describe("category breadcrumb rules", () => {
  it("maps restaurant sub-labels", () => {
    expect(
      matchBreadcrumb("Dining and Drinking > Restaurant > Sushi Restaurant"),
    ).toBe("restaurants");
  });
  it("catches the Cafe, Coffee label family via the comma-anchored prefix", () => {
    expect(
      matchBreadcrumb(
        "Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop",
      ),
    ).toBe("cafes");
  });
  it("excludes Cafeteria (the pin-review over-capture)", () => {
    expect(matchBreadcrumb("Dining and Drinking > Cafeteria")).toBeNull();
  });
  it("maps bakeries to cafes (recorded judgment)", () => {
    expect(matchBreadcrumb("Dining and Drinking > Bakery")).toBe("cafes");
  });
  it("returns null for out-of-scope labels", () => {
    expect(matchBreadcrumb("Business and Professional Services > Dentist")).toBeNull();
    expect(matchBreadcrumb("Retail > Grocery Store")).toBeNull();
  });
});

describe("classifyRow quality filter", () => {
  it("keeps a clean row with mapped categories and provenance shape", () => {
    const out = classifyRow(rawRow(), ID_MAP);
    if (!out.kept) throw new Error("expected kept");
    expect(out.place.fsqPlaceId).toBe("fsq_1");
    expect(out.place.publicationDate).toBe(PUB);
    expect(out.mapped).toEqual(["cafes"]);
    expect(out.sourceLabels).toHaveLength(1);
  });
  it("drops empty/whitespace names", () => {
    expect(classifyRow(rawRow({ name: "  " }), ID_MAP)).toMatchObject({
      kept: false,
      reason: "empty_name",
    });
    expect(classifyRow(rawRow({ name: null }), ID_MAP)).toMatchObject({
      kept: false,
      reason: "empty_name",
    });
  });
  it("drops missing coords", () => {
    expect(classifyRow(rawRow({ latitude: null }), ID_MAP)).toMatchObject({
      kept: false,
      reason: "missing_coords",
    });
  });
  it("drops closed places", () => {
    expect(
      classifyRow(rawRow({ date_closed: "2024-01-01" }), ID_MAP),
    ).toMatchObject({ kept: false, reason: "date_closed" });
  });
  it("drops each excluded unresolved flag", () => {
    for (const [flag, reason] of [
      ["closed", "flag_closed"],
      ["doesnt_exist", "flag_doesnt_exist"],
      ["delete", "flag_delete"],
      ["duplicate", "flag_duplicate"],
      ["privatevenue", "flag_privatevenue"],
      ["inappropriate", "flag_inappropriate"],
    ] as const) {
      expect(
        classifyRow(
          rawRow({ unresolved_flags_json: JSON.stringify([flag]) }),
          ID_MAP,
        ),
      ).toMatchObject({ kept: false, reason });
    }
  });
  it("drops unmapped categories and reports top-level breadcrumbs", () => {
    const out = classifyRow(
      rawRow({
        category_ids_json: JSON.stringify(["cat_unknown"]),
        category_labels_json: JSON.stringify([
          "Business and Professional Services > Dentist",
        ]),
      }),
      ID_MAP,
    );
    expect(out).toMatchObject({
      kept: false,
      reason: "category_unmapped",
      unmappedTopLevels: ["Business and Professional Services"],
    });
  });
  it("keeps multi-category places in stable vocabulary order", () => {
    const out = classifyRow(
      rawRow({ category_ids_json: JSON.stringify(["cat_park", "cat_cafe"]) }),
      ID_MAP,
    );
    if (!out.kept) throw new Error("expected kept");
    expect(out.mapped).toEqual(["cafes", "parks"]);
  });
  it("turns blank address into honest null", () => {
    const out = classifyRow(rawRow({ address: " " }), ID_MAP);
    if (!out.kept) throw new Error("expected kept");
    expect(out.place.address).toBeNull();
  });
});

describe("name similarity ns1", () => {
  it("normalizes case, diacritics, punctuation", () => {
    expect(normalizeName("Café-Pamenar!")).toBe("cafe pamenar");
  });
  it("scores identical names 1", () => {
    expect(nameSimilarity("Cafe Pamenar", "Cafe Pamenar")).toBe(1);
  });
  it("forgives token order and diacritics", () => {
    expect(nameSimilarity("Pamenar Café", "Cafe Pamenar")).toBe(1);
  });
  it("scores unrelated names below T_LOW", () => {
    expect(nameSimilarity("Starbucks", "Golden Dumpling House")).toBeLessThan(
      T_LOW,
    );
  });
  it("scores near-variants above T_HIGH", () => {
    expect(
      nameSimilarity("Pamenar Coffee House Kensington", "Pamenar Coffee House"),
    ).toBeGreaterThanOrEqual(T_HIGH);
  });
  it("scores empty as 0", () => {
    expect(nameSimilarity("", "Anything")).toBe(0);
  });
});

describe("decideMatch", () => {
  const c = (placeUuid: string, fsqName: string) => ({
    placeUuid,
    fsqName,
    distanceM: 5,
  });
  it("confirms a single high-scoring candidate", () => {
    const d = decideMatch("Cafe Pamenar", [c("a", "Cafe Pamenar")]);
    expect(d).toMatchObject({ status: "matched_confirmed", placeUuid: "a" });
  });
  it("resolves the 10m-stacking scenario by name, not proximity", () => {
    // Two venues at the same address (Session 4 anomaly 5): the food hall
    // stall and the venue that contains it are 5 m apart. Proximity cannot
    // decide; the name must.
    const d = decideMatch("Golden Dumpling House", [
      c("stall", "Golden Dumpling House"),
      c("hall", "Kensington Food Hall"),
    ]);
    expect(d).toMatchObject({ status: "matched_confirmed", placeUuid: "stall" });
  });
  it("flags identically-named twins as low-margin ambiguous", () => {
    // Two FSQ rows carrying the same name near one coordinate (chain
    // outlets, duplicate entries): both score 1.0, margin 0 — never a
    // silent coin-flip.
    const d = decideMatch("Dumpling House", [
      c("a", "Dumpling House"),
      c("b", "Dumpling House"),
    ]);
    expect(d.status).toBe("ambiguous");
    if (d.status !== "ambiguous") throw new Error("unreachable");
    expect(d.note).toBe("low_margin");
  });
  it("flags mid-band best scores as ambiguous", () => {
    const d = decideMatch("Pamenar Espresso Bar", [
      c("a", "Pamenar Coffee Bar"),
    ]);
    expect(d).toMatchObject({ status: "ambiguous", note: "mid_band" });
  });
  it("calls proximity coincidence name_mismatch", () => {
    const d = decideMatch("Second Cup Coffee", [c("a", "Golden Dumpling House")]);
    expect(d.status).toBe("name_mismatch");
  });
  it("breaks score ties deterministically by place id", () => {
    const d1 = decideMatch("Cafe X", [c("b", "Cafe X"), c("a", "Cafe X")]);
    const d2 = decideMatch("Cafe X", [c("a", "Cafe X"), c("b", "Cafe X")]);
    expect(d1.scores[0].place_id).toBe("a");
    expect(d2.scores[0].place_id).toBe("a");
  });
});

describe("geo", () => {
  it("haversine measures a known Toronto distance", () => {
    // Kensington anchor to St. Lawrence anchor ≈ 2.4 km.
    const d = haversineMeters(43.6547, -79.4005, 43.6487, -79.3716);
    expect(d).toBeGreaterThan(2200);
    expect(d).toBeLessThan(2600);
  });
  it("grid.near respects the radius boundary", () => {
    const grid = buildGrid([
      { id: "near", name: "Near", lat: 43.6547, lng: -79.4005 },
      { id: "far", name: "Far", lat: 43.6547, lng: -79.399 }, // ≈120 m east
    ]);
    const hits = grid.near(43.6547, -79.4005, 100);
    expect(hits.map((h) => h.id)).toEqual(["near"]);
  });
});

describe("base-layer write path (fake client)", () => {
  it("insert then re-ingest updates identity, preserves link and created_at", async () => {
    const db = createFakeBaseDb();
    const first = await upsertBaseLayerPlace(db.client, newPlace());
    expect(first.isNew).toBe(true);

    const linked = await setPlaceGoogleLink(db.client, first.row.id, "gpid_1");
    expect(linked.collision).toBe(false);

    const second = await upsertBaseLayerPlace(
      db.client,
      newPlace({ name: "Cafe Pamenar (Renamed)", address: null }),
    );
    expect(second.isNew).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.name).toBe("Cafe Pamenar (Renamed)");
    // The link and created_at survive re-ingestion by construction.
    expect(second.row.google_place_id).toBe("gpid_1");
    expect(db.places[0].created_at).toBe(db.places[0].created_at);
    expect(db.places).toHaveLength(1);
  });

  it("google link collision is surfaced, not thrown", async () => {
    const db = createFakeBaseDb();
    const a = await upsertBaseLayerPlace(db.client, newPlace());
    const b = await upsertBaseLayerPlace(
      db.client,
      newPlace({ fsqPlaceId: "fsq_2", name: "Other" }),
    );
    expect((await setPlaceGoogleLink(db.client, a.row.id, "gpid_1")).collision).toBe(false);
    expect((await setPlaceGoogleLink(db.client, b.row.id, "gpid_1")).collision).toBe(true);
    expect(db.places.filter((p) => p.google_place_id === "gpid_1")).toHaveLength(1);
  });

  it("categories fact upserts one current row per place", async () => {
    const db = createFakeBaseDb();
    const { row } = await upsertBaseLayerPlace(db.client, newPlace());
    await upsertCategoriesFact(db.client, {
      placeId: row.id,
      mapped: ["cafes"],
      sourceLabels: ["Dining and Drinking > Cafes, Coffee, and Tea Houses"],
      publicationDate: PUB,
    });
    await upsertCategoriesFact(db.client, {
      placeId: row.id,
      mapped: ["cafes", "restaurants"],
      sourceLabels: ["Dining and Drinking > Cafes, Coffee, and Tea Houses"],
      publicationDate: PUB,
    });
    expect(db.facts).toHaveLength(1);
    expect(db.facts[0]).toMatchObject({
      fact_key: "categories",
      source: "fsq_os_places",
      tier: 2,
      fetched_at: PUB,
    });
    expect((db.facts[0].value as { mapped: string[] }).mapped).toEqual([
      "cafes",
      "restaurants",
    ]);
  });

  it("identity match boundary rejects malformed status shapes", async () => {
    const db = createFakeBaseDb();
    await expect(
      upsertIdentityMatch(db.client, {
        discoveredPlaceId: "00000000-0000-4000-9000-000000000001",
        status: "no_candidates",
        placeId: "00000000-0000-4000-9000-000000000002", // illegal for status
        bestScore: null,
        method: null,
        candidates: null,
        matchedAt: PUB,
        traceId: "00000000-0000-4000-9000-000000000003",
      }),
    ).rejects.toThrow(/no_candidates/);
  });
});

describe("details client retry policy", () => {
  const makeClient = (responses: (() => Response)[]) => {
    let calls = 0;
    const fetchImpl = (async () => {
      const make = responses[Math.min(calls, responses.length - 1)];
      calls++;
      return make();
    }) as unknown as typeof fetch;
    return {
      client: createDetailsClient({
        apiKey: "test-key",
        fetchImpl,
        sleep: async () => {},
      }),
      calls: () => calls,
    };
  };

  it("hard-stops on per-day RESOURCE_EXHAUSTED without retrying", async () => {
    const quotaBody = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message:
          "Quota exceeded for quota metric 'GetPlaceRequest' and limit 'GetPlaceRequest per day'",
      },
    });
    const { client, calls } = makeClient([
      () => new Response(quotaBody, { status: 429 }),
    ]);
    await expect(client.getPlace("x")).rejects.toThrow(/RESOURCE_EXHAUSTED/);
    expect(calls()).toBe(1);
  });

  it("retries plain rate-limit 429s with backoff, then succeeds", async () => {
    const { client, calls } = makeClient([
      () => new Response("rate limited", { status: 429 }),
      () =>
        new Response(
          JSON.stringify({ id: "x", displayName: { text: "A" } }),
          { status: 200 },
        ),
    ]);
    const result = await client.getPlace("x");
    expect(result.id).toBe("x");
    expect(calls()).toBe(2);
  });
});

describe("matching end-to-end (fake client + fake details)", () => {
  const seed = async (
    db: ReturnType<typeof createFakeBaseDb>,
    fsqName = "Cafe Pamenar",
  ) => {
    const cafe = await upsertBaseLayerPlace(
      db.client,
      newPlace({ name: fsqName }),
    );
    const now = new Date().toISOString();
    // Deterministic-order check: insert B before A.
    db.seedDiscovered({
      city: "toronto",
      google_place_id: "gpid_B",
      lat: 43.6547,
      lng: -79.4005,
      coords_status: "present",
      coords_fetched_at: now,
      source: "google_places",
      tier: 1,
      first_discovered_at: now,
    });
    db.seedDiscovered({
      city: "toronto",
      google_place_id: "gpid_A",
      lat: 43.7,
      lng: -79.3,
      coords_status: "present",
      coords_fetched_at: now,
      source: "google_places",
      tier: 1,
      first_discovered_at: now,
    });
    return cafe;
  };

  const detailsReturning = (name: string): DetailsClient => ({
    getPlace: async (id) => ({ id, displayName: { text: name } }),
  });

  it("plans in google_place_id order and splits confirm vs no-candidates", async () => {
    const db = createFakeBaseDb();
    await seed(db);
    const plan = await buildMatchPlan(db.client, "toronto", new Date());
    // gpid_A (far from the cafe) has no candidates; gpid_B has one.
    expect(plan.noCandidates).toHaveLength(1);
    expect(plan.toConfirm).toHaveLength(1);
    expect(plan.toConfirm[0].googlePlaceId).toBe("gpid_B");
    expect(plan.fsqCorpusSize).toBe(1);
  });

  it("writes outcomes, the link, cost events — and never a Google name", async () => {
    const db = createFakeBaseDb();
    const cafe = await seed(db, "Pamenar Coffee House");
    const plan = await buildMatchPlan(db.client, "toronto", new Date());
    const report = await runMatching({
      supabase: db.client,
      // Google's name differs from FSQ's (one extra token) but similarity
      // lands exactly at T_HIGH — confirmed, and the Google-only token
      // ("Kensington") is the leak probe below.
      details: detailsReturning("Pamenar Coffee House Kensington"),
      instrumentation: createInstrumentation(db.client),
      plan,
    });

    expect(report.confirmCalls).toBe(1);
    expect(report.totalEstCostUsd).toBeCloseTo(0.017);
    expect(report.outcomes).toMatchObject({
      matched_confirmed: 1,
      no_candidates: 1,
    });
    expect(report.scoreDistribution).toHaveLength(1);

    const confirmed = db.matches.find((m) => m.status === "matched_confirmed");
    expect(confirmed?.place_id).toBe(cafe.row.id);
    expect(confirmed?.method).toBe("ns1");
    expect(db.places[0].google_place_id).toBe("gpid_B");

    const event = db.traceEvents.find((e) => e.endpoint === "places.get");
    expect(event?.est_cost_usd).toBe(0.017);
    expect(event?.metadata).toMatchObject({
      status: "matched_confirmed",
      pricing_basis: "list",
    });

    // The discarded-name law: the Google-only token appears nowhere in
    // anything persisted — rows, matches, traces, events.
    const persisted = JSON.stringify({
      places: db.places,
      facts: db.facts,
      matches: db.matches,
      traces: db.traces,
      traceEvents: db.traceEvents,
    });
    expect(persisted).not.toMatch(/Kensington/i);
  });

  it("demotes a second confirm on the same identity to link_collision", async () => {
    // The full-run abort scenario: two Google listings for one venue, both
    // name-matching the same FSQ identity. First (google_place_id order)
    // wins the link; second must land ambiguous/link_collision — never
    // overwrite, never crash into identity_matches_place_matched_unique.
    const db = createFakeBaseDb();
    const cafe = await upsertBaseLayerPlace(db.client, newPlace());
    const now = new Date().toISOString();
    for (const gpid of ["gpid_dup_B", "gpid_dup_A"]) {
      db.seedDiscovered({
        city: "toronto",
        google_place_id: gpid,
        lat: 43.6547,
        lng: -79.4005,
        coords_status: "present",
        coords_fetched_at: now,
        source: "google_places",
        tier: 1,
        first_discovered_at: now,
      });
    }
    const plan = await buildMatchPlan(db.client, "toronto", new Date());
    const report = await runMatching({
      supabase: db.client,
      details: detailsReturning("Cafe Pamenar"),
      instrumentation: createInstrumentation(db.client),
      plan,
    });
    expect(report.collisions).toBe(1);
    expect(report.outcomes).toMatchObject({
      matched_confirmed: 1,
      ambiguous: 1,
    });
    // Deterministic winner: gpid_dup_A processes first and keeps the link.
    expect(db.places[0].google_place_id).toBe("gpid_dup_A");
    const demoted = db.matches.find((m) => m.status === "ambiguous");
    expect(
      (demoted?.candidates as { note?: string } | null)?.note,
    ).toBe("link_collision");
    expect(cafe.row.id).toBe(db.matches.find((m) => m.status === "matched_confirmed")?.place_id);
  });

  it("skips terminal statuses on re-run — a re-run re-spends nothing", async () => {
    const db = createFakeBaseDb();
    await seed(db);
    const plan1 = await buildMatchPlan(db.client, "toronto", new Date());
    await runMatching({
      supabase: db.client,
      details: detailsReturning("Pamenar Cafe"),
      instrumentation: createInstrumentation(db.client),
      plan: plan1,
    });
    const plan2 = await buildMatchPlan(db.client, "toronto", new Date());
    expect(plan2.toConfirm).toHaveLength(0);
    expect(plan2.noCandidates).toHaveLength(0);
    expect(plan2.skippedTerminal).toBe(2);
  });

  it("expired discovery coords are excluded, never guessed at", async () => {
    const db = createFakeBaseDb();
    await seed(db);
    // Age both clocks past 30 days.
    for (const d of db.discovered) {
      d.coords_fetched_at = "2026-06-01T00:00:00.000Z";
    }
    const plan = await buildMatchPlan(
      db.client,
      "toronto",
      new Date("2026-08-05T00:00:00.000Z"),
    );
    expect(plan.toConfirm).toHaveLength(0);
    expect(plan.noCandidates).toHaveLength(0);
    expect(plan.skippedNoCoords).toBe(2);
  });
});
