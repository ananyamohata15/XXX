import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecordedInsert {
  table: string;
  row: Record<string, unknown>;
}

export interface RecordedUpdate {
  table: string;
  patch: Record<string, unknown>;
  eq: [string, unknown];
}

export interface FakeSupabase {
  client: SupabaseClient;
  inserts: RecordedInsert[];
  updates: RecordedUpdate[];
}

/**
 * Minimal in-memory stand-in for the slice of the supabase-js query builder
 * that src/server uses: .from().select(head count), .from().insert()
 * [.select().single()], .from().update().eq(), and the domain repo reads
 * .from().select().eq()[.single() | .order()]. Seed reads via options.rows.
 * Extend as the server layer grows — do not reach for a full mock library
 * until this hurts.
 */
export function createFakeSupabase(
  options: {
    failWith?: string;
    rows?: Record<string, Record<string, unknown>[]>;
  } = {},
): FakeSupabase {
  const inserts: RecordedInsert[] = [];
  const updates: RecordedUpdate[] = [];
  const error = options.failWith ? { message: options.failWith } : null;
  const seeded = options.rows ?? {};

  const client = {
    from(table: string) {
      return {
        select() {
          return {
            // Health db check: select("id").limit(1).
            limit() {
              return Promise.resolve({ data: error ? null : [], error });
            },
            eq(column: string, value: unknown) {
              const matches = (seeded[table] ?? []).filter(
                (row) => row[column] === value,
              );
              return {
                single() {
                  const row = matches[0] ?? null;
                  return Promise.resolve(
                    error || !row
                      ? {
                          data: null,
                          error: error ?? { message: `no ${table} row` },
                        }
                      : { data: row, error: null },
                  );
                },
                order(orderColumn: string) {
                  const sorted = [...matches].sort((a, b) =>
                    String(a[orderColumn]) < String(b[orderColumn]) ? -1 : 1,
                  );
                  return Promise.resolve(
                    error ? { data: null, error } : { data: sorted, error: null },
                  );
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          if (!error) inserts.push({ table, row });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve(
                    error
                      ? { data: null, error }
                      : { data: { id: `fake-${table}-${inserts.length}` }, error: null },
                  );
                },
              };
            },
            // Awaited directly (no .select()) by logEvent.
            then(resolve: (value: { error: typeof error }) => void) {
              resolve({ error });
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(column: string, value: unknown) {
              if (!error) updates.push({ table, patch, eq: [column, value] });
              return Promise.resolve({ error });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, inserts, updates };
}
