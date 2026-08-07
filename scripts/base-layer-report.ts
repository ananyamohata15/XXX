import { createClient } from "@supabase/supabase-js";

/**
 * Read-only base-layer evidence report (Checkpoints 3–4). No writes, no
 * Google calls. Paginates every select (the Session 4 1,000-row lesson).
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const PAGE = 1000;

async function listAll<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: Row[] | null;
    error: { message: string } | null;
  }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function main() {
  const sampleCount = (() => {
    const i = process.argv.indexOf("--sample");
    return i >= 0 ? Number.parseInt(process.argv[i + 1] ?? "5", 10) : 5;
  })();

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // --traces: list base-layer traces for spend accounting across runs.
  if (process.argv.includes("--traces")) {
    const traces = await listAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("traces")
        .select("id, kind, started_at, finished_at, total_cost_usd, metadata")
        .in("kind", ["base_layer_ingest", "identity_matching"])
        .order("started_at")
        .range(from, to),
    );
    console.log(JSON.stringify(traces, null, 2));
    return;
  }

  // --trace <id>: dump one trace + its events (metadata included — which is
  // itself evidence that no Google content rides in trace metadata).
  const traceIndex = process.argv.indexOf("--trace");
  if (traceIndex >= 0) {
    const traceId = process.argv[traceIndex + 1];
    if (!traceId) {
      console.error("--trace requires a trace id.");
      process.exit(1);
    }
    const trace = await supabase.from("traces").select().eq("id", traceId).single();
    if (trace.error) throw new Error(trace.error.message);
    const events = await listAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("trace_events")
        .select()
        .eq("trace_id", traceId)
        .order("created_at")
        .range(from, to),
    );
    console.log(JSON.stringify({ trace: trace.data, events }, null, 2));
    return;
  }

  const places = await listAll<{
    id: string;
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
  }>((from, to) =>
    supabase
      .from("places")
      .select(
        "id, name, lat, lng, address, google_place_id, fsq_place_id, source, source_version, tier, fetched_at",
      )
      .eq("source", "fsq_os_places")
      .order("fsq_place_id")
      .range(from, to),
  );

  const categoryFacts = await listAll<{
    place_id: string;
    value: { mapped: string[] } | null;
  }>((from, to) =>
    supabase
      .from("facts")
      .select("place_id, value")
      .eq("fact_key", "categories")
      .order("place_id")
      .range(from, to),
  );

  const matches = await listAll<{
    discovered_place_id: string;
    status: string;
    place_id: string | null;
    best_score: number | null;
    method: string | null;
    candidates: unknown;
    matched_at: string;
    trace_id: string | null;
  }>((from, to) =>
    supabase
      .from("identity_matches")
      .select(
        "discovered_place_id, status, place_id, best_score, method, candidates, matched_at, trace_id",
      )
      .order("discovered_place_id")
      .range(from, to),
  );

  const byCategory: Record<string, number> = {};
  for (const f of categoryFacts) {
    for (const c of f.value?.mapped ?? []) {
      byCategory[c] = (byCategory[c] ?? 0) + 1;
    }
  }

  const byStatus: Record<string, number> = {};
  for (const m of matches) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;

  // Ambiguous rows carry their reason in candidates.note (mid_band /
  // low_margin / link_collision). Each collision is a duplicate-Google-listing
  // case: a second discovered Google place confirmed an already-linked FSQ
  // identity. Enriched with the FSQ side (name, ids) so the listing reads
  // without a second query; the FSQ name is FSQ content, not Google content.
  const placeById = new Map(places.map((p) => [p.id, p]));
  const ambiguousReasons: Record<string, number> = {};
  const linkCollisions: unknown[] = [];
  for (const m of matches) {
    if (m.status !== "ambiguous") continue;
    const cand = m.candidates as {
      note?: string;
      entries?: { place_id: string; score: number }[];
    } | null;
    const note = cand?.note ?? "unrecorded";
    ambiguousReasons[note] = (ambiguousReasons[note] ?? 0) + 1;
    if (note !== "link_collision") continue;
    const top = cand?.entries?.[0];
    const fsq = top ? placeById.get(top.place_id) : undefined;
    linkCollisions.push({
      discovered_place_id: m.discovered_place_id,
      best_score: m.best_score,
      matched_at: m.matched_at,
      trace_id: m.trace_id,
      n_candidates: cand?.entries?.length ?? 0,
      collided_fsq_place: fsq
        ? {
            place_id: fsq.id,
            name: fsq.name,
            fsq_place_id: fsq.fsq_place_id,
            holds_google_link: fsq.google_place_id,
          }
        : null,
    });
  }

  const scores = matches
    .map((m) => m.best_score)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);
  const histogram: Record<string, number> = {};
  for (const s of scores) {
    const bucket = `${(Math.floor(s * 10) / 10).toFixed(1)}`;
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }

  const linked = places.filter((p) => p.google_place_id !== null);
  const bbox =
    places.length > 0
      ? {
          latMin: Math.min(...places.map((p) => p.lat)),
          latMax: Math.max(...places.map((p) => p.lat)),
          lngMin: Math.min(...places.map((p) => p.lng)),
          lngMax: Math.max(...places.map((p) => p.lng)),
        }
      : null;

  // Deterministic pseudo-random sample: stable stride over the sorted list.
  const stride = Math.max(1, Math.floor(places.length / Math.max(sampleCount, 1)));
  const sample = places.filter((_, i) => i % stride === 0).slice(0, sampleCount);

  // End-to-end evidence: confirmed matches joined to their identity row and
  // categories fact — the full persisted surface of a match, showing nothing
  // Google-sourced beyond google_place_id.
  const factByPlace = new Map(categoryFacts.map((f) => [f.place_id, f.value]));
  const endToEnd = matches
    .filter((m) => m.status === "matched_confirmed")
    .slice(0, 3)
    .map((m) => ({
      identity_match: m,
      place: m.place_id ? (placeById.get(m.place_id) ?? null) : null,
      categories_fact_value: m.place_id
        ? (factByPlace.get(m.place_id) ?? null)
        : null,
    }));

  console.log(
    JSON.stringify(
      {
        fsq_places: places.length,
        with_google_link: linked.length,
        source_versions: [...new Set(places.map((p) => p.source_version))],
        tiers: [...new Set(places.map((p) => p.tier))],
        bbox,
        category_fact_rows: categoryFacts.length,
        distinct_per_category: byCategory,
        match_outcomes: byStatus,
        ambiguous_reasons: ambiguousReasons,
        link_collisions: linkCollisions,
        score_histogram: histogram,
        scores_sorted: scores,
        sample_places: sample,
        end_to_end_confirmed: endToEnd,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
