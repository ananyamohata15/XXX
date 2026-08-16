import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ARC_TEMPLATES, pickTemplate } from "../src/server/generation/arc";
import { GOLDEN_PERSONAS } from "../src/shared/persona";

/**
 * Corpus report (XXX-35, Session 12 Step 5) — the founder's words, joined
 * to the day that earned them.
 *
 * Comment 10296 made free text first-class and named the four axes the
 * corpus must be minable by: place, persona, rule-adjacency and date.
 * Those are columns. What was NOT minable was the thing every verdict is
 * actually about — the day. A verdict stores a trace_id; the mechanism
 * behind it (which arc shape, which elected anchor, which venue on which
 * card, which rules were already flagging it) lives in trace metadata
 * nobody was reading. This joins the two and prints them together.
 *
 * FREE and read-only: DB reads only, no Google, no Anthropic, no writes.
 *
 * It also runs one MECHANISM CHECK per day, because Session 12's own
 * close-out found the record can lie: the engine mints a seed when the
 * caller sends none and records it in the trace, but the arc is built
 * from `request.seed ?? 0` — so a room-generated day records a seed that
 * did not produce its shape. The check re-picks the template from the
 * recorded seed and says so when they disagree, rather than letting a
 * later reader mine a mechanism that never ran.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/corpus-report.ts
 *   npx tsx --env-file=.env.local scripts/corpus-report.ts --since 2026-08-15
 *   npx tsx --env-file=.env.local scripts/corpus-report.ts --trace cab8104b-…
 *   npx tsx --env-file=.env.local scripts/corpus-report.ts --persona day-6-excursion
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

/** A taste signal or an evidence row, flattened to what a reader needs. */
interface CorpusRow {
  kind: "taste" | "evidence";
  /** 'day_verdict' | 'liked' | … for taste; the claim for evidence. */
  label: string;
  authority: string;
  traceId: string | null;
  slotId: string | null;
  freeText: string | null;
  personaKey: string | null;
  dayDate: string | null;
  createdAt: string;
  /** evidence only — null on taste rows, which flip nothing by law. */
  flipFactKey?: string | null;
  ruleIds?: string[];
}

interface DayRecord {
  traceId: string;
  personaKey: string | null;
  date: string | null;
  seed: number | null;
  outcome: string | null;
  templateId: string | null;
  electedAnchor: {
    category?: string;
    dwellMinutes?: number;
    reason?: string;
    tier?: number;
  } | null;
  openPeriods: number | null;
  exposureSwaps: number | null;
  findings: number | null;
  costUsd: number | null;
  fullDayMs: number | null;
  synthetic: boolean;
  /** slotId → what was on that card. Empty when the trace carries no context. */
  cards: Map<string, { placeId: string; ruleIds: string[] }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readDay(traceId: string, row: Record<string, unknown>): DayRecord {
  const meta = asRecord(row.metadata);
  const tasting = asRecord(meta.tasting);
  const cards = new Map<string, { placeId: string; ruleIds: string[] }>();
  for (const [slotId, raw] of Object.entries(asRecord(tasting.cards))) {
    const card = asRecord(raw);
    if (typeof card.place_id !== "string") continue;
    cards.set(slotId, {
      placeId: card.place_id,
      ruleIds: Array.isArray(card.rule_ids) ? (card.rule_ids as string[]) : [],
    });
  }
  const anchor = meta.elected_anchor;
  return {
    traceId,
    personaKey:
      typeof tasting.persona_key === "string" ? tasting.persona_key : null,
    date: typeof meta.date === "string" ? meta.date : null,
    seed: typeof meta.seed === "number" ? meta.seed : null,
    outcome: typeof meta.outcome === "string" ? meta.outcome : null,
    templateId:
      typeof meta.arc_template_id === "string" ? meta.arc_template_id : null,
    electedAnchor:
      anchor !== null && typeof anchor === "object" ? asRecord(anchor) : null,
    openPeriods:
      typeof meta.open_periods === "number" ? meta.open_periods : null,
    exposureSwaps:
      typeof meta.exposure_swaps === "number" ? meta.exposure_swaps : null,
    findings: typeof meta.findings === "number" ? meta.findings : null,
    costUsd: typeof row.total_cost_usd === "number" ? row.total_cost_usd : null,
    fullDayMs: typeof row.full_day_ms === "number" ? row.full_day_ms : null,
    synthetic: tasting.synthetic === true,
    cards,
  };
}

async function placeNames(
  client: SupabaseClient,
  placeIds: string[],
): Promise<Map<string, { name: string; category: string }>> {
  const out = new Map<string, { name: string; category: string }>();
  if (placeIds.length === 0) return out;
  const { data, error } = await client
    .from("places")
    .select("id, name, facts!inner(fact_key, value)")
    .in("id", placeIds)
    .eq("facts.fact_key", "categories");
  if (error) throw new Error(`place lookup failed: ${error.message}`);
  for (const row of (data ?? []) as unknown as {
    id: string;
    name: string;
    facts: { value: { mapped: string[] } }[];
  }[]) {
    out.set(row.id, {
      name: row.name,
      category: row.facts[0]?.value?.mapped?.[0] ?? "unknown",
    });
  }
  return out;
}

/**
 * slotId → the arc step that seated it, read off the RECORDED template.
 *
 * Intent ids are minted `i1..iN` over the template's steps in time order,
 * skipping `open` (free time never becomes a slot) and skipping any step
 * dropped for want of window. Dropping shifts every id after it, and the
 * trace does not record drops — so the mapping is only sound when the
 * card count equals the template's seating-step count. When it does not,
 * this returns null and the report says the roles are unknown rather than
 * printing a plausible lie.
 */
function rolesBySlot(
  templateId: string | null,
  cardCount: number,
): Map<string, string> | null {
  if (templateId === null) return null;
  const template = ARC_TEMPLATES.find((t) => t.id === templateId);
  if (template === undefined) return null;
  const seating = template.steps.filter((s) => s !== "open");
  if (seating.length !== cardCount) return null;
  return new Map(seating.map((step, i) => [`s-i${i + 1}`, step]));
}

/**
 * Re-pick the arc template from the seed the trace recorded.
 *
 * Agreement is not proof the day is reproducible — it only means the
 * recorded seed is CONSISTENT with the recorded shape. Disagreement is
 * proof it is not, and that is the case worth printing loudly.
 */
function mechanismCheck(day: DayRecord): string[] {
  const notes: string[] = [];
  if (day.personaKey === null || day.seed === null || day.templateId === null) {
    notes.push(
      "SKIPPED — trace lacks persona, seed or arc_template_id (pre-arc trace).",
    );
    return notes;
  }
  const persona = GOLDEN_PERSONAS[day.personaKey];
  if (persona === undefined) {
    notes.push(`SKIPPED — "${day.personaKey}" is not a golden persona.`);
    return notes;
  }
  const fromRecordedSeed = pickTemplate(persona, day.seed).id;
  if (fromRecordedSeed === day.templateId) {
    notes.push(
      `arc template ${day.templateId} is consistent with recorded seed ${day.seed}.`,
    );
    return notes;
  }
  const fromZero = pickTemplate(persona, 0).id;
  notes.push(
    `ARC SEED MISMATCH — trace records seed ${day.seed}, but that seed picks ` +
      `"${fromRecordedSeed}" and the day was built as "${day.templateId}".`,
  );
  if (fromZero === day.templateId) {
    notes.push(
      "  seed 0 reproduces it. This is the unseeded-caller defect: the engine " +
        "mints a seed for scoring and records it, while buildSkeleton reads " +
        "request.seed ?? 0 — so the ARC was diced at 0 and every unseeded day " +
        "of this persona has the same shape.",
    );
  }
  notes.push(
    "  Consequence for mining: the venues on this day varied with the minted " +
      "seed, the SHAPE did not. Do not read shape variety from this trace.",
  );
  return notes;
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const since = arg("--since");
  const onlyTrace = arg("--trace");
  const onlyPersona = arg("--persona");

  let tasteQuery = client
    .from("taste_signals")
    .select(
      "signal, reporter_authority, trace_id, slot_id, free_text, persona_key, day_date, created_at",
    )
    .order("created_at", { ascending: true });
  let evidenceQuery = client
    .from("evidence")
    .select(
      "claim, reporter_authority, trace_id, slot_id, free_text, persona_key, day_date, created_at, flip_fact_key, adjacent_rule_ids",
    )
    .order("created_at", { ascending: true });
  if (since !== null) {
    tasteQuery = tasteQuery.gte("created_at", since);
    evidenceQuery = evidenceQuery.gte("created_at", since);
  }
  if (onlyTrace !== null) {
    tasteQuery = tasteQuery.eq("trace_id", onlyTrace);
    evidenceQuery = evidenceQuery.eq("trace_id", onlyTrace);
  }
  if (onlyPersona !== null) {
    tasteQuery = tasteQuery.eq("persona_key", onlyPersona);
    evidenceQuery = evidenceQuery.eq("persona_key", onlyPersona);
  }

  const [taste, evidence] = await Promise.all([tasteQuery, evidenceQuery]);
  if (taste.error) throw new Error(`taste read failed: ${taste.error.message}`);
  if (evidence.error) {
    throw new Error(`evidence read failed: ${evidence.error.message}`);
  }

  const rows: CorpusRow[] = [
    ...taste.data.map(
      (r): CorpusRow => ({
        kind: "taste",
        label: r.signal,
        authority: r.reporter_authority,
        traceId: r.trace_id,
        slotId: r.slot_id,
        freeText: r.free_text,
        personaKey: r.persona_key,
        dayDate: r.day_date,
        createdAt: r.created_at,
      }),
    ),
    ...evidence.data.map(
      (r): CorpusRow => ({
        kind: "evidence",
        label: r.claim,
        authority: r.reporter_authority,
        traceId: r.trace_id,
        slotId: r.slot_id,
        freeText: r.free_text,
        personaKey: r.persona_key,
        dayDate: r.day_date,
        createdAt: r.created_at,
        flipFactKey: r.flip_fact_key,
        ruleIds: r.adjacent_rule_ids ?? [],
      }),
    ),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Summary before spend is this project's standing line; this instrument
  // spends nothing, but an unreadable report still wastes the reading.
  head("CORPUS REPORT");
  line(
    `  ${rows.length} row(s): ${taste.data.length} taste, ${evidence.data.length} evidence` +
      `${since === null ? "" : ` · since ${since}`}` +
      `${onlyTrace === null ? "" : ` · trace ${onlyTrace.slice(0, 8)}`}` +
      `${onlyPersona === null ? "" : ` · persona ${onlyPersona}`}`,
  );
  if (rows.length === 0) {
    line("  nothing to report.");
    return;
  }

  const traceIds = [
    ...new Set(rows.map((r) => r.traceId).filter((id): id is string => id !== null)),
  ];
  const { data: traceRows, error: traceError } = await client
    .from("traces")
    .select("id, metadata, total_cost_usd, full_day_ms")
    .in("id", traceIds);
  if (traceError) throw new Error(`trace read failed: ${traceError.message}`);
  const days = new Map<string, DayRecord>();
  for (const row of traceRows ?? []) {
    days.set(row.id, readDay(row.id, row as Record<string, unknown>));
  }

  const allPlaceIds = [
    ...new Set(
      [...days.values()].flatMap((d) =>
        [...d.cards.values()].map((c) => c.placeId),
      ),
    ),
  ];
  const places = await placeNames(client, allPlaceIds);

  const orphaned = rows.filter(
    (r) => r.traceId === null || !days.has(r.traceId),
  );
  line(
    `  ${traceIds.length} trace(s) behind them` +
      (orphaned.length > 0
        ? ` · ${orphaned.length} row(s) with no readable trace (reported below)`
        : ""),
  );

  // Group by trace, in first-verdict order — the corpus is read as "what
  // did they say about this day", never as a flat feed of opinions.
  const byTrace = new Map<string, CorpusRow[]>();
  for (const row of rows) {
    const key = row.traceId ?? "(no trace)";
    const list = byTrace.get(key);
    if (list === undefined) byTrace.set(key, [row]);
    else list.push(row);
  }

  for (const [traceId, verdicts] of byTrace) {
    const day = days.get(traceId) ?? null;
    const roles =
      day === null ? null : rolesBySlot(day.templateId, day.cards.size);
    const persona = day?.personaKey ?? verdicts[0].personaKey ?? "?";
    const date = day?.date ?? verdicts[0].dayDate ?? "?";
    head(`${persona} · ${date} · trace ${traceId.slice(0, 8)}`);

    if (day === null) {
      line("  DAY: no trace row readable — verdict kept, mechanism unknown.");
    } else {
      line(
        `  seed ${day.seed ?? "—"} · outcome ${day.outcome ?? "—"} · ` +
          `${day.findings ?? "—"} findings · ${day.openPeriods ?? "—"} open period(s) · ` +
          `${day.exposureSwaps ?? "—"} exposure swap(s)` +
          (day.synthetic ? " · SYNTHETIC" : ""),
      );
      line(
        `  arc ${day.templateId ?? "—"} · anchor ` +
          (day.electedAnchor === null
            ? "— (user anchor pre-empted election, or pre-arc trace)"
            : `${day.electedAnchor.category ?? "?"} @ ${day.electedAnchor.dwellMinutes ?? "?"}m ` +
              `— "${day.electedAnchor.reason ?? ""}"`),
      );
      line(
        `  cost $${(day.costUsd ?? 0).toFixed(4)} · ${day.fullDayMs ?? "—"} ms`,
      );

      line();
      line("  DAY AS RECORDED:");
      if (day.cards.size === 0) {
        line("    no tasting context on this trace — cards unknown.");
      } else {
        if (roles === null && day.templateId !== null) {
          line(
            "    (roles unknown — the card count does not match the template's",
          );
          line("     seating steps, so a step was dropped and the ids shifted.)");
        }
        for (const [slotId, card] of [...day.cards].sort((a, b) =>
          a[0].localeCompare(b[0]),
        )) {
          const place = places.get(card.placeId);
          const spoken = verdicts.filter((v) => v.slotId === slotId).length;
          line(
            `    ${slotId.padEnd(6)} ${(roles?.get(slotId) ?? "?").padEnd(10)}` +
              `${(place?.name ?? card.placeId).slice(0, 34).padEnd(36)}` +
              `${(place?.category ?? "?").padEnd(18)}` +
              `${spoken > 0 ? `◀ ${spoken} verdict(s)` : ""}` +
              `${card.ruleIds.length > 0 ? `  [${card.ruleIds.join(",")}]` : ""}`,
          );
        }
      }
      // Honest absence, stated every time rather than discovered later: the
      // tasting context stores WHICH place was on each card and not WHEN it
      // was, so "20 minutes" and "1h30" in a verdict cannot be checked here.
      line(
        "    (seated times are not recorded — duration and gap verdicts on this",
      );
      line("     day cannot be adjudicated from the record.)");

      line();
      line("  MECHANISM CHECK:");
      for (const note of mechanismCheck(day)) line(`    ${note}`);
    }

    line();
    line("  WHAT THEY SAID:");
    for (const verdict of verdicts) {
      const place =
        verdict.slotId === null
          ? null
          : places.get(day?.cards.get(verdict.slotId)?.placeId ?? "");
      const role = verdict.slotId === null ? null : (roles?.get(verdict.slotId) ?? null);
      const target =
        verdict.slotId === null
          ? "the day"
          : `${verdict.slotId}${role === null ? "" : ` [${role}]`}` +
            `${place === undefined || place === null ? "" : ` (${place.name})`}`;
      line(
        `    ${verdict.createdAt.slice(0, 19).replace("T", " ")} · ` +
          `${verdict.authority} · ${verdict.label} · ${target}` +
          (verdict.flipFactKey ? ` · flipped ${verdict.flipFactKey}` : ""),
      );
      if (verdict.freeText === null) {
        line("      (no words — a tap only)");
      } else {
        for (const textLine of verdict.freeText.split("\n")) {
          line(`      "${textLine}"`);
        }
      }
    }

    // Repeat taps on one card are one opinion recorded N times. Nothing
    // weights the corpus yet (XXX-34 owns that), so this is a warning
    // rather than a dedupe — the rows stay, the reader is told.
    const seen = new Map<string, number>();
    for (const verdict of verdicts) {
      const dupeKey = `${verdict.label}|${verdict.slotId ?? "day"}|${verdict.freeText ?? ""}`;
      seen.set(dupeKey, (seen.get(dupeKey) ?? 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1);
    if (dupes.length > 0) {
      line();
      line("  DUPLICATE SIGNALS:");
      for (const [dupeKey, n] of dupes) {
        const [label, slot] = dupeKey.split("|");
        line(
          `    ${label} on ${slot} recorded ${n}× — one opinion, ${n} rows. ` +
            "Weighting (XXX-34) must not read this as agreement.",
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
