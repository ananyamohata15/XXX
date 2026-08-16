import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildSkeleton, defaultMealPattern } from "../src/server/generation/compose";
import { retrieveCandidates, zonesFor } from "../src/server/generation/retrieve";
import { scoreAll } from "../src/server/generation/score";
import { SHORTLIST_NOMINAL } from "../src/server/generation/engine";
import { MENU_SIZE } from "../src/server/generation/select";
import { getWeatherDay } from "../src/server/weather/repo";
import { GRAMMAR_PARAMS } from "../src/shared/day-grammar/params";
import { GOLDEN_PERSONAS } from "../src/shared/persona";
import type { PlaceCategory } from "../src/shared/vocabulary";

/**
 * Trace audit (XXX-35 intake, Session 10 Step 4).
 *
 * Answers four questions about days a founder has already reviewed,
 * WITHOUT regenerating them: every input to the deterministic layers is
 * recorded in the trace (persona, date, seed) and every rule they
 * consulted is a pure function, so the skeleton, the pattern and the
 * retrieval mix can all be re-derived exactly.
 *
 * FREE and read-only: DB reads only, no Google, no Anthropic. It calls
 * nothing that spends. What it therefore CANNOT reconstruct is the
 * post-Details state — hard filters need live hours — so the menu
 * figures are reported at the shortlist boundary and labelled as such.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/trace-audit.ts <traceId> [<traceId>…]
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 66 - s.length))}`);
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

interface TraceMeta {
  seed: number;
  date: string;
  outcome: string;
  pool_candidates: number;
  shortlisted: number;
  details_calls: number;
  validation_passes: number;
  findings: number;
  repair_log: { pass: number; ruleIds: string[] }[];
  tasting?: {
    persona_key: string;
    cards: Record<string, { place_id: string; rule_ids: string[] }>;
  };
}

const tally = (values: string[]): [string, number][] =>
  [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]);

const pct = (n: number, total: number) =>
  total === 0 ? "—" : `${((n / total) * 100).toFixed(0)}%`;

async function categoriesOf(
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

async function auditTrace(client: SupabaseClient, traceId: string) {
  const { data, error } = await client
    .from("traces")
    .select("started_at, metadata")
    .eq("id", traceId)
    .single();
  if (error) throw new Error(`trace read failed: ${error.message}`);
  const meta = data.metadata as TraceMeta;
  const personaKey = meta.tasting?.persona_key ?? "(unknown)";
  const persona = GOLDEN_PERSONAS[personaKey];
  if (persona === undefined) throw new Error(`unknown persona ${personaKey}`);

  head(`${personaKey} · ${meta.date} · trace ${traceId.slice(0, 8)}`);
  line(
    `  seed ${meta.seed} · outcome ${meta.outcome} · ${meta.validation_passes} pass(es) · ` +
      `${meta.findings} findings · repairs ${JSON.stringify(meta.repair_log)}`,
  );
  line(
    `  persona: pace=${persona.pace} lens=${persona.lens} structure=${persona.structure} ` +
      `food=${persona.foodCourage} gravity=[${persona.gravity.join(", ")}]`,
  );

  // ---- (a)(b) meal pattern, and whether the edges were legal ----------
  const pattern = defaultMealPattern(persona);
  const spec = GRAMMAR_PARAMS.mealPatterns[pattern];
  line();
  line(`  (a)(b) MEAL PATTERN: ${pattern}`);
  line(
    `    selected by: defaultMealPattern(persona) — structure="${persona.structure}" ` +
      `→ ${persona.structure === "wanderer" ? "coffee_then_brunch" : "classic"}. ` +
      `No other input participates: the route sends no mealPattern, so taste, ` +
      `pace, gravity and foodCourage are ALL ignored by pattern selection.`,
  );
  line(`    windows: ${spec.windows.map((w) => `${w.label} ${w.open}–${w.close}`).join(" · ")}`);
  line(`    maxFoodStops (rule pacing.food-stops-exceeded): ${spec.maxFoodStops}`);

  const skeleton = buildSkeleton(
    {
      city: "toronto",
      date: meta.date,
      persona,
      budgetBand: null,
      transport: ["walk", "transit"],
      seed: meta.seed,
    },
    // The trace's recorded seed, replayed as the resolved seed — which is
    // exactly the reproducibility law this audit exists to check.
    { seed: meta.seed },
  );
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  line(`    skeleton intents (${skeleton.intents.length}):`);
  for (const intent of skeleton.intents) {
    line(
      `      ${intent.id.padEnd(3)} ${intent.kind.padEnd(8)} ${intent.label.padEnd(18)} ` +
        `window ${hhmm(intent.window.start)}–${hhmm(intent.window.end)} ` +
        `dwell ${intent.dwellMinutes}m  categories: ${intent.categories.join(">")}`,
    );
  }
  const mealIntents = skeleton.intents.filter((i) => i.kind === "meal");
  line(
    `    meal intents: ${mealIntents.length} (${mealIntents.map((i) => i.label).join(", ")})`,
  );

  // ---- the day as seated -----------------------------------------------
  const cards = Object.entries(meta.tasting?.cards ?? {});
  const byPlace = await categoriesOf(
    client,
    cards.map(([, c]) => c.place_id),
  );
  line();
  line(`  DAY AS SEATED (${cards.length} slots):`);
  const seatedCategories: string[] = [];
  for (const [slotId, card] of cards.sort((a, b) => a[0].localeCompare(b[0]))) {
    const place = byPlace.get(card.place_id);
    const intent = skeleton.intents.find((i) => `s-${i.id}` === slotId);
    seatedCategories.push(place?.category ?? "unknown");
    line(
      `      ${slotId.padEnd(6)} ${(intent?.label ?? "—").padEnd(18)} ` +
        `${(place?.name ?? card.place_id).slice(0, 34).padEnd(36)} ` +
        `${(place?.category ?? "?").padEnd(18)}` +
        `${card.rule_ids.length > 0 ? ` [${card.rule_ids.join(",")}]` : ""}`,
    );
  }
  const foodStops = seatedCategories.filter(
    (c) => c === "restaurants" || c === "cafes",
  ).length;
  line(
    `    food-category stops seated: ${foodStops} of ${cards.length} ` +
      `(rule ceiling ${spec.maxFoodStops} → ${foodStops > spec.maxFoodStops ? "VIOLATION" : "legal"})`,
  );
  line(`    category sequence: ${seatedCategories.join(" > ")}`);

  // ---- (c) what the weather context actually held ----------------------
  const weather = await getWeatherDay(client, "toronto", meta.date);
  line();
  line(`  (c) WEATHER CONTEXT for ${meta.date}:`);
  if (weather === null) {
    line(`    NO ROW — the grammar ran with windows=null and reported weather.unknown.`);
  } else {
    const w = weather as unknown as Record<string, unknown>;
    const keys = Object.keys(w).filter(
      (k) => !["city", "date", "created_at", "updated_at", "id"].includes(k),
    );
    for (const key of keys) {
      const value = w[key];
      if (value === null || typeof value === "object") continue;
      line(`    ${key}: ${String(value)}`);
    }
  }

  // ---- (d) retrieval mix, re-derived deterministically ------------------
  const zones = zonesFor(persona.lens, []);
  const categories = [
    ...new Set(skeleton.intents.flatMap((i) => i.categories)),
  ] as PlaceCategory[];
  const pool = await retrieveCandidates(client, "toronto", categories, zones);
  const scored = scoreAll(pool, persona, null, meta.seed);
  line();
  line(`  (d) RETRIEVAL / MENU COMPOSITION (re-derived, seed ${meta.seed}):`);
  line(
    `    pool now ${pool.length} vs ${meta.pool_candidates} recorded in the trace` +
      `${pool.length === meta.pool_candidates ? " — faithful reconstruction" : " — POOL HAS CHANGED since the run; figures below are indicative"}`,
  );
  line(`    zones drawn (lens=${persona.lens}): ${zones.map((z) => z.slug).join(", ")}`);
  line(`    pool category mix:`);
  const poolTally = tally(pool.map((c) => c.category));
  for (const [category, n] of poolTally) {
    line(`      ${category.padEnd(20)} ${String(n).padStart(5)}  ${pct(n, pool.length)}`);
  }

  // Menus are dealt per intent from the score-ranked candidates matching
  // that intent's categories. Hard filters need live hours, so this is
  // the PRE-FILTER deal: what the intent had to choose among before
  // anything was excluded for being shut.
  line(`    per-intent deal (top ${MENU_SIZE} by score, PRE hard-filter):`);
  let dealtTotal = 0;
  let dealtFood = 0;
  for (const intent of skeleton.intents) {
    const eligible = scored.filter((c) => intent.categories.includes(c.category));
    const preferenceRanked = [...eligible].sort(
      (a, b) =>
        intent.categories.indexOf(a.category) - intent.categories.indexOf(b.category) ||
        b.score - a.score,
    );
    const dealt = preferenceRanked.slice(0, MENU_SIZE);
    dealtTotal += dealt.length;
    dealtFood += dealt.filter(
      (c) => c.category === "restaurants" || c.category === "cafes",
    ).length;
    line(
      `      ${intent.id.padEnd(3)} ${intent.label.padEnd(18)} eligible ${String(eligible.length).padStart(5)} → dealt ` +
        `${tally(dealt.map((d) => d.category))
          .map(([k, n]) => `${n}×${k}`)
          .join(", ")}`,
    );
  }
  line(
    `    dealt across all intents: ${dealtTotal} cards, ${dealtFood} food ` +
      `(${pct(dealtFood, dealtTotal)}) — the 61%-pool question, made concrete`,
  );
  line(
    `    shortlist actually fetched: ${meta.shortlisted} (nominal ${SHORTLIST_NOMINAL}), ` +
      `${meta.details_calls} Details calls`,
  );
}

async function main() {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (ids.length === 0) {
    console.error("usage: trace-audit.ts <traceId> [<traceId>…]");
    process.exit(1);
  }
  for (const id of ids) await auditTrace(client, id);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
