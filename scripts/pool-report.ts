import { createClient } from "@supabase/supabase-js";
import { withCoordsTtlApplied, type DiscoveredPlaceRow } from "../src/server/discovery/repo";

/**
 * Read-only discovery-pool report (XXX-22): pool statistics, per-category /
 * per-anchor counts, coordinate-status breakdown, sample rows, and the trace
 * for a given run. Makes no Google calls and writes nothing.
 *
 * Usage: npx tsx scripts/pool-report.ts [--trace <trace_id>] [--samples <n>]
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const traceArg = argv.indexOf("--trace");
  const traceId = traceArg >= 0 ? argv[traceArg + 1] : null;
  const samplesArg = argv.indexOf("--samples");
  const sampleCount =
    samplesArg >= 0 ? Number.parseInt(argv[samplesArg + 1] ?? "3", 10) : 3;

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const now = new Date();

  // PostgREST caps responses at 1,000 rows by default and truncates
  // SILENTLY — a single .select() here under-reports the pool while looking
  // complete. Page explicitly until a short page proves the end.
  async function selectAll<Row>(table: string, columns: string): Promise<Row[]> {
    const pageSize = 1000;
    const all: Row[] = [];
    for (let from = 0; ; from += pageSize) {
      const page = await supabase
        .from(table)
        .select(columns)
        .order("id")
        .range(from, from + pageSize - 1);
      if (page.error) throw new Error(`${table}: ${page.error.message}`);
      all.push(...(page.data as Row[]));
      if (page.data.length < pageSize) return all;
    }
  }

  const rows = (
    await selectAll<DiscoveredPlaceRow>(
      "discovered_places",
      "id, city, google_place_id, lat, lng, coords_status, coords_fetched_at, source, tier, first_discovered_at",
    )
  ).map((row) => withCoordsTtlApplied(row, now));

  const hitsData = await selectAll<{
    discovered_place_id: string;
    category: string;
    anchor: string;
    result_rank: number;
    trace_id: string | null;
    discovered_at: string;
  }>(
    "discovery_hits",
    "id, discovered_place_id, category, anchor, result_rank, trace_id, discovered_at",
  );
  const hits = { data: hitsData };

  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    byStatus[row.coords_status] = (byStatus[row.coords_status] ?? 0) + 1;
  }
  const byCategory: Record<string, Set<string>> = {};
  const byAnchor: Record<string, Set<string>> = {};
  for (const hit of hits.data) {
    (byCategory[hit.category] ??= new Set()).add(hit.discovered_place_id);
    (byAnchor[hit.anchor] ??= new Set()).add(hit.discovered_place_id);
  }
  const setSizes = (m: Record<string, Set<string>>) =>
    Object.fromEntries(
      Object.entries(m)
        .map(([k, v]) => [k, v.size] as const)
        .sort((a, b) => b[1] - a[1]),
    );

  const report: Record<string, unknown> = {
    generated_at: now.toISOString(),
    pool: {
      distinct_places: rows.length,
      coords_status: byStatus,
      hits_total: hits.data.length,
      distinct_by_category: setSizes(byCategory),
      distinct_by_anchor: setSizes(byAnchor),
    },
    sample_rows: rows.slice(0, sampleCount),
    sample_hits: hits.data.slice(0, sampleCount),
  };

  if (traceId) {
    const trace = await supabase
      .from("traces")
      .select("id, kind, started_at, finished_at, total_cost_usd, metadata")
      .eq("id", traceId)
      .single();
    if (trace.error) throw new Error(trace.error.message);
    const events = await supabase
      .from("trace_events")
      .select("provider, endpoint, est_cost_usd, duration_ms, metadata")
      .eq("trace_id", traceId)
      .order("created_at");
    if (events.error) throw new Error(events.error.message);
    report.trace = trace.data;
    report.trace_events = events.data;
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
