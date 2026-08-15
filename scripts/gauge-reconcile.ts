import { createClient } from "@supabase/supabase-js";
import {
  DETAILS_FREE_EVENTS_PER_MONTH,
  monthStart,
} from "../src/server/tasting/quota";

/**
 * Month-gauge reconciliation (XXX-35, Session 12 §5.7 forward item 4).
 *
 * Session 12 close-out found the on-page Details gauge reading **1,758** at
 * CP4 launch while counting `places.get(engine)` since 2026-08-01 — the
 * gauge's own definition — gave **1,824**. A 66-event gap, unexplained and
 * deliberately not smoothed over. The gauge is a spend fence, and a fence
 * that is 66 out is not a footnote.
 *
 * This asks the database where the 66 went, rather than reasoning about it
 * (CLAUDE.md: live-reproduce before fixing). It re-runs the gauge's exact
 * query, then widens one filter at a time — provider, endpoint, time bound —
 * so the gap lands on whichever predicate is responsible.
 *
 * FREE and read-only: DB counts only. No Google, no Anthropic, no writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/gauge-reconcile.ts
 *   npx tsx --env-file=.env.local scripts/gauge-reconcile.ts --at 2026-08-15T21:00:00Z
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 66 - s.length))}`);
};

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowIso = arg("--at") ?? new Date().toISOString();
  const from = monthStart(nowIso);

  /** One count under an explicitly-named set of predicates. */
  const count = async (
    label: string,
    build: (q: ReturnType<typeof client.from>) => unknown,
  ): Promise<number> => {
    const query = build(client.from("trace_events")) as {
      count: number | null;
      error: { message: string } | null;
    };
    const { count: n, error } = await query;
    if (error) throw new Error(`${label}: ${error.message}`);
    return n ?? 0;
  };

  head("THE GAUGE'S OWN QUERY (src/server/tasting/quota.ts readQuota)");
  line(`  as of:       ${nowIso}`);
  line(`  month from:  ${from}`);

  const gauge = await count("gauge", (q) =>
    q
      .select("id", { count: "exact" })
      .eq("provider", "google_places")
      .eq("endpoint", "places.get(engine)")
      .gte("created_at", from)
      .limit(1),
  );
  line(`  gauge reads: ${gauge} / ${DETAILS_FREE_EVENTS_PER_MONTH} free`);

  head("WIDENING ONE PREDICATE AT A TIME — where does the count move?");

  const anyEndpoint = await count("any-endpoint", (q) =>
    q
      .select("id", { count: "exact" })
      .eq("provider", "google_places")
      .gte("created_at", from)
      .limit(1),
  );
  line(`  provider=google_places, ANY endpoint : ${anyEndpoint}`);
  line(`  gauge (endpoint pinned)              : ${gauge}`);
  line(`  → endpoints the gauge does not count : ${anyEndpoint - gauge}`);

  const allTime = await count("all-time", (q) =>
    q
      .select("id", { count: "exact" })
      .eq("provider", "google_places")
      .eq("endpoint", "places.get(engine)")
      .limit(1),
  );
  line(`  gauge query with NO time bound       : ${allTime}`);
  line(`  → events before ${from.slice(0, 10)}          : ${allTime - gauge}`);

  head("EVERY google_places ENDPOINT THIS MONTH (the gauge counts one)");

  // Paged read of the endpoint column — grouping happens here rather than in
  // SQL because PostgREST has no GROUP BY and this is a few thousand rows.
  const endpoints = new Map<string, number>();
  const traceIds = new Map<string, number>();
  const byDay = new Map<string, number>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("trace_events")
      .select("endpoint, trace_id, created_at")
      .eq("provider", "google_places")
      .gte("created_at", from)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`endpoint scan: ${error.message}`);
    if (data === null || data.length === 0) break;
    for (const row of data as {
      endpoint: string;
      trace_id: string | null;
      created_at: string;
    }[]) {
      endpoints.set(row.endpoint, (endpoints.get(row.endpoint) ?? 0) + 1);
      if (row.endpoint === "places.get(engine)") {
        const day = row.created_at.slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
        const t = row.trace_id ?? "(no trace)";
        traceIds.set(t, (traceIds.get(t) ?? 0) + 1);
      }
    }
    if (data.length < PAGE) break;
  }

  for (const [endpoint, n] of [...endpoints].sort((a, b) => b[1] - a[1])) {
    const counted = endpoint === "places.get(engine)" ? "COUNTED" : "not counted";
    line(`  ${String(n).padStart(6)}  ${endpoint.padEnd(34)} ${counted}`);
  }

  head("places.get(engine) BY DAY — the shape of the month's spend");
  for (const [day, n] of [...byDay].sort()) {
    line(`  ${day}  ${String(n).padStart(5)}  ${"▪".repeat(Math.min(60, n))}`);
  }

  head("TRACES CARRYING THE MOST Details events this month");
  const top = [...traceIds].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [trace, n] of top) {
    line(`  ${String(n).padStart(5)}  ${trace}`);
  }
  line();
  line(
    `  distinct traces: ${traceIds.size} · mean ${(gauge / Math.max(1, traceIds.size)).toFixed(1)} Details/trace`,
  );

  head("THE 66 — reconciling Session 12 §5.7's recorded reading of 1,758");

  // Every counted event in time order, so any historical reading can be
  // placed on the timeline instead of argued about.
  const ordered: { created_at: string; trace_id: string | null }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("trace_events")
      .select("created_at, trace_id")
      .eq("provider", "google_places")
      .eq("endpoint", "places.get(engine)")
      .gte("created_at", from)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`timeline scan: ${error.message}`);
    if (data === null || data.length === 0) break;
    ordered.push(...(data as typeof ordered));
    if (data.length < PAGE) break;
  }

  const RECORDED = 1758; // §5.7's reading at what the notes call "CP4 launch"
  const atReading = ordered[RECORDED - 1];
  const nextAfter = ordered[RECORDED];
  if (atReading !== undefined) {
    line(`  the month's ${RECORDED}th counted event landed at ${atReading.created_at}`);
    line(
      `  the next one at                       ${nextAfter?.created_at ?? "(none — 1758 is the whole month)"}`,
    );
    line(`  events after it                       ${ordered.length - RECORDED}`);
    const tail = ordered.slice(RECORDED);
    if (tail.length > 0) {
      line(
        `  that tail spans                       ${tail[0].created_at} → ${tail[tail.length - 1].created_at}`,
      );
      const tailTraces = [...new Set(tail.map((r) => r.trace_id))];
      line(`  across                                ${tailTraces.length} traces`);
      const { data: tailRows, error: tailErr } = await client
        .from("traces")
        .select("id, kind, metadata, started_at")
        .in("id", tailTraces.filter((t): t is string => t !== null));
      if (tailErr) throw new Error(`tail trace lookup: ${tailErr.message}`);
      line();
      line("  WHICH SURFACE SPENT THE TAIL — the whole question:");
      const tailCounts = new Map<string, number>();
      for (const r of tail) {
        const row = (tailRows ?? []).find(
          (t) => (t as { id: string }).id === r.trace_id,
        ) as { metadata: Record<string, unknown> | null } | undefined;
        const surface =
          typeof row?.metadata?.surface === "string"
            ? row.metadata.surface
            : "(no surface — CLI harness, not the room)";
        tailCounts.set(surface, (tailCounts.get(surface) ?? 0) + 1);
      }
      for (const [surface, n] of [...tailCounts].sort((a, b) => b[1] - a[1])) {
        line(`    ${String(n).padStart(4)}  ${surface}`);
      }
    }
  }
  const { data: traceRows, error: traceErr } = await client
    .from("traces")
    .select("id, kind, metadata, started_at")
    .in("id", [...traceIds.keys()].filter((t) => t !== "(no trace)").slice(0, 400));
  if (traceErr) throw new Error(`trace lookup: ${traceErr.message}`);
  const known = new Map(
    (traceRows ?? []).map((t) => [
      (t as { id: string }).id,
      t as { id: string; kind: string; metadata: Record<string, unknown> | null },
    ]),
  );
  const bySurface = new Map<string, number>();
  let orphanEvents = 0;
  for (const [trace, n] of traceIds) {
    const row = known.get(trace);
    if (row === undefined) {
      orphanEvents += n;
      bySurface.set("(trace row not found)", (bySurface.get("(trace row not found)") ?? 0) + n);
      continue;
    }
    const surface =
      typeof row.metadata?.surface === "string"
        ? row.metadata.surface
        : "(no surface)";
    const label = `${row.kind} · ${surface}`;
    bySurface.set(label, (bySurface.get(label) ?? 0) + n);
  }
  for (const [label, n] of [...bySurface].sort((a, b) => b[1] - a[1])) {
    line(`  ${String(n).padStart(6)}  ${label}`);
  }
  if (orphanEvents > 0) {
    line();
    line(`  ${orphanEvents} events could not be joined to a trace row.`);
  }
  line();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
