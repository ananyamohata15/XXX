import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stateful in-memory stand-in for the discovery tables + instrumentation
 * tables, implementing REAL unique-key semantics so idempotency tests assert
 * behavior, not just recorded calls. Supports exactly the query chains
 * src/server/discovery and src/server/instrumentation use — extend when the
 * repo grows, don't generalize speculatively.
 *
 * Mock-fidelity note (Session 1 lesson): this cannot prove PostgREST
 * behavior — Checkpoint 3's live probe does that. These tests prove our
 * write-path logic against a database-shaped contract.
 */

export interface FakeDiscoveredPlace extends Record<string, unknown> {
  id: string;
  city: string;
  google_place_id: string;
  lat: number | null;
  lng: number | null;
  coords_status: string;
  coords_fetched_at: string | null;
  source: string;
  tier: number;
  first_discovered_at: string;
}

export interface FakeDiscoveryHit extends Record<string, unknown> {
  discovered_place_id: string;
  category: string;
  anchor: string;
  result_rank: number;
  trace_id: string | null;
  discovered_at: string;
}

export interface FakeTraceEvent {
  trace_id: string;
  provider: string;
  endpoint: string;
  est_cost_usd: number | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
}

export interface FakeDiscoveryDb {
  client: SupabaseClient;
  places: Map<string, FakeDiscoveredPlace>;
  hits: FakeDiscoveryHit[];
  traces: { id: string; kind: string; finished?: Record<string, unknown> }[];
  traceEvents: FakeTraceEvent[];
}

let nextId = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;

export function createFakeDiscoveryDb(): FakeDiscoveryDb {
  const places = new Map<string, FakeDiscoveredPlace>();
  const hits: FakeDiscoveryHit[] = [];
  const traces: FakeDiscoveryDb["traces"] = [];
  const traceEvents: FakeTraceEvent[] = [];

  const ok = <T>(data: T) => Promise.resolve({ data, error: null });
  const fail = (message: string) =>
    Promise.resolve({ data: null, error: { message } });

  function discoveredPlaces() {
    return {
      select() {
        return {
          eq(_column: string, value: unknown) {
            const row = places.get(String(value)) ?? null;
            return {
              maybeSingle: () => ok(row ? { id: row.id } : null),
              single: () =>
                row ? ok({ ...row }) : fail("no discovered_places row"),
            };
          },
        };
      },
      insert(row: Record<string, unknown>) {
        return {
          select() {
            return {
              single() {
                const key = String(row.google_place_id);
                if (places.has(key)) {
                  return fail(
                    'duplicate key value violates unique constraint "discovered_places_google_place_id_unique"',
                  );
                }
                const stored = { id: uuid(), ...row } as FakeDiscoveredPlace;
                places.set(key, stored);
                return ok({ ...stored });
              },
            };
          },
        };
      },
      update(patch: Record<string, unknown>) {
        return {
          eq(_column: string, value: unknown) {
            return {
              select() {
                return {
                  single() {
                    const row = places.get(String(value));
                    if (!row) return fail("no discovered_places row");
                    // Mirrors the SQL UPDATE: patch columns only —
                    // first_discovered_at is untouched by construction.
                    Object.assign(row, patch);
                    return ok({ ...row });
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  function discoveryHits() {
    return {
      upsert(row: FakeDiscoveryHit, options?: { ignoreDuplicates?: boolean }) {
        const duplicate = hits.some(
          (h) =>
            h.discovered_place_id === row.discovered_place_id &&
            h.category === row.category &&
            h.anchor === row.anchor,
        );
        if (duplicate && !options?.ignoreDuplicates) {
          return Promise.resolve({
            error: {
              message:
                'duplicate key value violates unique constraint "discovery_hits_place_query_unique"',
            },
          });
        }
        if (!duplicate) hits.push({ ...row });
        return Promise.resolve({ error: null });
      },
    };
  }

  function tracesTable() {
    return {
      insert(row: { kind: string }) {
        return {
          select() {
            return {
              single() {
                const trace = { id: uuid(), kind: row.kind };
                traces.push(trace);
                return ok({ id: trace.id });
              },
            };
          },
        };
      },
      update(patch: Record<string, unknown>) {
        return {
          eq(_column: string, value: unknown) {
            const trace = traces.find((t) => t.id === value);
            if (trace) trace.finished = patch;
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }

  function traceEventsTable() {
    return {
      insert(row: FakeTraceEvent) {
        traceEvents.push(row);
        return {
          then(resolve: (value: { error: null }) => void) {
            resolve({ error: null });
          },
        };
      },
    };
  }

  const client = {
    from(table: string) {
      switch (table) {
        case "discovered_places":
          return discoveredPlaces();
        case "discovery_hits":
          return discoveryHits();
        case "traces":
          return tracesTable();
        case "trace_events":
          return traceEventsTable();
        default:
          throw new Error(`fake-discovery-db: unexpected table ${table}`);
      }
    },
  } as unknown as SupabaseClient;

  return { client, places, hits, traces, traceEvents };
}
