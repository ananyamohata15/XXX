import { createClient } from "@supabase/supabase-js";
import { DETAILS_FREE_EVENTS_PER_MONTH, monthStart } from "../src/server/tasting/quota";

/**
 * Session-11 intake probe (XXX-35 CHECKPOINT 0).
 *
 * FREE and read-only: DB counts only, no Google, no Anthropic. Answers the
 * two intake questions a session cannot answer from the repo — how much of
 * the month's free Details allowance is already spent, and whether the two
 * founder-reviewed days from Session 10 have verdicts in the corpus yet.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/intake-report.ts
 */

const line = (s = "") => console.log(s);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

/** The two days Session 10 audited, by their recorded traces. */
const REVIEWED = [
  { traceId: "a825417a", personaKey: "day-3-winter", date: "2026-09-15" },
  { traceId: "d9935541", personaKey: "day-6-excursion", date: "2026-09-15" },
];

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const nowIso = new Date().toISOString();

  // ---- Details gauge, month to date ------------------------------------
  const details = await supabase
    .from("trace_events")
    .select("id", { count: "exact" })
    .eq("provider", "google_places")
    .eq("endpoint", "places.get(engine)")
    .gte("created_at", monthStart(nowIso))
    .limit(1);
  if (details.error) throw new Error(`details count: ${details.error.message}`);

  const searches = await supabase
    .from("trace_events")
    .select("id", { count: "exact" })
    .eq("provider", "google_places")
    .eq("endpoint", "places.searchText(ids-only)")
    .gte("created_at", monthStart(nowIso))
    .limit(1);
  if (searches.error) throw new Error(`search count: ${searches.error.message}`);

  line(`month start (UTC): ${monthStart(nowIso)}  now: ${nowIso}`);
  line(
    `Details events MTD: ${details.count} / ${DETAILS_FREE_EVENTS_PER_MONTH} free  ` +
      `(remaining ${DETAILS_FREE_EVENTS_PER_MONTH - (details.count ?? 0)})`,
  );
  line(`SearchText(ids-only) MTD: ${searches.count} (free, unlimited cap)`);

  // ---- generations today (the runaway guard's own count) ----------------
  const traces = await supabase
    .from("traces")
    .select("id, started_at, metadata", { count: "exact" })
    .eq("kind", "day_generation")
    .gte("started_at", monthStart(nowIso))
    .order("started_at", { ascending: false })
    .limit(200);
  if (traces.error) throw new Error(`traces: ${traces.error.message}`);
  line(`day_generation traces MTD: ${traces.count}`);

  // ---- the corpus: day verdicts + evidence -----------------------------
  const taste = await supabase
    .from("taste_signals")
    .select("id, signal, persona_key, day_date, trace_id, free_text, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (taste.error) throw new Error(`taste_signals: ${taste.error.message}`);

  const evidence = await supabase
    .from("evidence")
    .select("id, claim, fact_key, reporter_authority, trace_id, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (evidence.error) throw new Error(`evidence: ${evidence.error.message}`);

  line();
  line(`taste_signals rows: ${taste.data.length}`);
  const verdicts = taste.data.filter((r) => r.signal === "day_verdict");
  line(`  of which day_verdict: ${verdicts.length}`);
  for (const v of verdicts) {
    line(
      `    ${String(v.created_at).slice(0, 19)}  persona=${v.persona_key} date=${v.day_date} ` +
        `trace=${String(v.trace_id ?? "—").slice(0, 8)}`,
    );
    if (v.free_text) line(`      text: ${String(v.free_text).slice(0, 300)}`);
  }
  const others = taste.data.filter((r) => r.signal !== "day_verdict");
  line(`  other taste signals: ${others.length}`);
  for (const o of others) {
    line(
      `    ${String(o.created_at).slice(0, 19)}  ${o.signal} persona=${o.persona_key} date=${o.day_date}`,
    );
  }

  line();
  line(`evidence rows: ${evidence.data.length}`);
  for (const e of evidence.data) {
    line(
      `    ${String(e.created_at).slice(0, 19)}  ${e.claim} fact=${e.fact_key ?? "—"} ` +
        `authority=${e.reporter_authority} trace=${String(e.trace_id ?? "—").slice(0, 8)}`,
    );
  }

  // ---- do the two reviewed days have verdicts? -------------------------
  line();
  for (const day of REVIEWED) {
    const byTrace = taste.data.filter(
      (r) => String(r.trace_id ?? "").startsWith(day.traceId),
    );
    const byPersonaDate = taste.data.filter(
      (r) => r.persona_key === day.personaKey && r.day_date === day.date,
    );
    line(
      `${day.traceId} (${day.personaKey} ${day.date}): ` +
        `signals by trace=${byTrace.length}, by persona+date=${byPersonaDate.length} → ` +
        `${byTrace.length + byPersonaDate.length > 0 ? "PRESENT" : "ABSENT from the corpus"}`,
    );
  }

  // ---- founder_groundtruth facts standing -------------------------------
  const gt = await supabase
    .from("facts")
    .select("id, place_id, fact_key, source, tier", { count: "exact" })
    .eq("source", "founder_groundtruth")
    .limit(20);
  if (gt.error) throw new Error(`facts: ${gt.error.message}`);
  line();
  line(`founder_groundtruth facts standing: ${gt.count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
