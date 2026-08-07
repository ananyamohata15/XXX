import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stateful in-memory stand-in for the base-layer tables (places, facts,
 * identity_matches, discovered_places) + instrumentation, with REAL
 * unique-key semantics (fsq_place_id, google_place_id, (place_id, fact_key),
 * discovered_place_id) so idempotency and collision tests assert behavior.
 *
 * Supports exactly the query chains src/server/base-layer uses. Mock-fidelity
 * note (Session 1 lesson): PostgREST behavior is proven live at Checkpoint 3,
 * not here.
 */

export interface FakePlace extends Record<string, unknown> {
  id: string;
  city: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  google_place_id: string | null;
  fsq_place_id: string | null;
  source: string;
  source_version: string | null;
  tier: number;
  fetched_at: string;
  created_at: string;
}

export interface FakeFact extends Record<string, unknown> {
  place_id: string;
  fact_key: string;
  status: string;
  value: unknown;
  source: string;
  tier: number;
  fetched_at: string;
}

export interface FakeIdentityMatch extends Record<string, unknown> {
  discovered_place_id: string;
  status: string;
  place_id: string | null;
  best_score: number | null;
  method: string | null;
  candidates: unknown;
  matched_at: string;
  trace_id: string | null;
}

export interface FakeDiscovered extends Record<string, unknown> {
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

export interface FakeBaseDb {
  client: SupabaseClient;
  places: FakePlace[];
  facts: FakeFact[];
  matches: FakeIdentityMatch[];
  discovered: FakeDiscovered[];
  traces: { id: string; kind: string; finished?: Record<string, unknown> }[];
  traceEvents: {
    trace_id: string;
    provider: string;
    endpoint: string;
    est_cost_usd: number | null;
    duration_ms: number | null;
    metadata: Record<string, unknown>;
  }[];
  seedDiscovered(row: Omit<FakeDiscovered, "id">): FakeDiscovered;
}

let nextId = 0;
const uuid = () =>
  `00000000-0000-4000-9000-${String(++nextId).padStart(12, "0")}`;

type Result<T> = Promise<{ data: T; error: { message: string } | null }>;
const ok = <T>(data: T): Result<T> => Promise.resolve({ data, error: null });
const fail = (message: string) =>
  Promise.resolve({ data: null, error: { message } });

export function createFakeBaseDb(): FakeBaseDb {
  const places: FakePlace[] = [];
  const facts: FakeFact[] = [];
  const matches: FakeIdentityMatch[] = [];
  const discovered: FakeDiscovered[] = [];
  const traces: FakeBaseDb["traces"] = [];
  const traceEvents: FakeBaseDb["traceEvents"] = [];

  /** Filterable, orderable, rangeable select chain over an array. */
  function selectChain<Row extends Record<string, unknown>>(rows: Row[]) {
    let filtered = [...rows];
    const chain = {
      eq(column: string, value: unknown) {
        filtered = filtered.filter((r) => r[column] === value);
        return chain;
      },
      order(column: string) {
        filtered.sort((a, b) =>
          String(a[column] ?? "").localeCompare(String(b[column] ?? "")),
        );
        return chain;
      },
      range(from: number, to: number) {
        const page = filtered.slice(from, to + 1).map((r) => ({ ...r }));
        return ok(page);
      },
      maybeSingle() {
        return ok(filtered.length > 0 ? { ...filtered[0] } : null);
      },
      single() {
        return filtered.length === 1
          ? ok({ ...filtered[0] })
          : fail(`expected 1 row, got ${filtered.length}`);
      },
    };
    return chain;
  }

  function placesTable() {
    return {
      select() {
        return selectChain(places);
      },
      insert(row: Record<string, unknown>) {
        return {
          select() {
            return {
              single() {
                if (
                  row.fsq_place_id != null &&
                  places.some((p) => p.fsq_place_id === row.fsq_place_id)
                ) {
                  return fail(
                    'duplicate key value violates unique constraint "places_fsq_place_id_unique"',
                  );
                }
                if (
                  row.google_place_id != null &&
                  places.some(
                    (p) => p.google_place_id === row.google_place_id,
                  )
                ) {
                  return fail(
                    'duplicate key value violates unique constraint "places_google_place_id_key"',
                  );
                }
                const stored = {
                  id: uuid(),
                  google_place_id: null,
                  address: null,
                  source_version: null,
                  fsq_place_id: null,
                  created_at: new Date().toISOString(),
                  ...row,
                } as FakePlace;
                places.push(stored);
                return ok({ ...stored });
              },
            };
          },
        };
      },
      update(patch: Record<string, unknown>) {
        // Filterable conditional update: .eq().is().select() like PostgREST —
        // zero matching rows is data:[] with no error (the collision signal).
        const filters: ((p: FakePlace) => boolean)[] = [];
        const runUpdate = (): {
          error: { message: string } | null;
          rows: FakePlace[];
        } => {
          const matched = places.filter((p) => filters.every((f) => f(p)));
          for (const row of matched) {
            if (
              patch.google_place_id != null &&
              places.some(
                (p) => p !== row && p.google_place_id === patch.google_place_id,
              )
            ) {
              return {
                error: {
                  message:
                    'duplicate key value violates unique constraint "places_google_place_id_key"',
                },
                rows: [],
              };
            }
            Object.assign(row, patch);
          }
          return { error: null, rows: matched };
        };
        const chain = {
          eq(column: string, value: unknown) {
            filters.push((p) => p[column] === value);
            return chain;
          },
          is(column: string, value: unknown) {
            filters.push((p) => p[column] === value);
            return chain;
          },
          then(resolve: (v: { error: { message: string } | null }) => void) {
            resolve({ error: runUpdate().error });
          },
          select() {
            return {
              then(
                resolve: (v: {
                  data: FakePlace[];
                  error: { message: string } | null;
                }) => void,
              ) {
                const r = runUpdate();
                resolve({ data: r.rows.map((x) => ({ ...x })), error: r.error });
              },
              single() {
                const r = runUpdate();
                if (r.error) return fail(r.error.message);
                if (r.rows.length !== 1) {
                  return fail(`expected 1 updated row, got ${r.rows.length}`);
                }
                return ok({ ...r.rows[0] });
              },
            };
          },
        };
        return chain;
      },
    };
  }

  function factsTable() {
    return {
      select() {
        return selectChain(facts);
      },
      upsert(row: FakeFact) {
        const existing = facts.find(
          (f) => f.place_id === row.place_id && f.fact_key === row.fact_key,
        );
        if (existing) Object.assign(existing, row);
        else facts.push({ ...row });
        return Promise.resolve({ error: null });
      },
    };
  }

  function matchesTable() {
    return {
      select() {
        return selectChain(matches);
      },
      upsert(row: FakeIdentityMatch) {
        const MATCHED = ["matched_confirmed", "matched_unconfirmed"];
        if (
          MATCHED.includes(row.status) &&
          matches.some(
            (m) =>
              m.discovered_place_id !== row.discovered_place_id &&
              m.place_id === row.place_id &&
              MATCHED.includes(m.status),
          )
        ) {
          return Promise.resolve({
            error: {
              message:
                'duplicate key value violates unique constraint "identity_matches_place_matched_unique"',
            },
          });
        }
        const existing = matches.find(
          (m) => m.discovered_place_id === row.discovered_place_id,
        );
        if (existing) Object.assign(existing, row);
        else matches.push({ ...row });
        return Promise.resolve({ error: null });
      },
    };
  }

  function discoveredTable() {
    return {
      select() {
        return selectChain(discovered);
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
      insert(row: FakeBaseDb["traceEvents"][number]) {
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
        case "places":
          return placesTable();
        case "facts":
          return factsTable();
        case "identity_matches":
          return matchesTable();
        case "discovered_places":
          return discoveredTable();
        case "traces":
          return tracesTable();
        case "trace_events":
          return traceEventsTable();
        default:
          throw new Error(`fake-base-db: unexpected table ${table}`);
      }
    },
  } as unknown as SupabaseClient;

  return {
    client,
    places,
    facts,
    matches,
    discovered,
    traces,
    traceEvents,
    seedDiscovered(row) {
      const stored = { id: uuid(), ...row } as FakeDiscovered;
      discovered.push(stored);
      return stored;
    },
  };
}
