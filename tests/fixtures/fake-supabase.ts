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
 * [.select().single()], .from().update().eq(). Extend as the server layer
 * grows — do not reach for a full mock library until this hurts.
 */
export function createFakeSupabase(
  options: { failWith?: string } = {},
): FakeSupabase {
  const inserts: RecordedInsert[] = [];
  const updates: RecordedUpdate[] = [];
  const error = options.failWith ? { message: options.failWith } : null;

  const client = {
    from(table: string) {
      return {
        select() {
          // Awaited directly by the health db check (head count).
          return Promise.resolve({ data: null, count: error ? null : 0, error });
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
