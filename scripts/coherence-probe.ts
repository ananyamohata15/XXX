import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildSkeleton, composeDay, defaultMealPattern } from "@/server/generation/compose";
import { COMPOSE_PARAMS } from "@/server/generation/compose-params";
import { improveCoherence, describeMove } from "@/server/generation/coherence";
import { buildGrammarContext, fetchEnvironment } from "@/server/generation/context";
import { buildMenus, excludeRefusedVenues } from "@/server/generation/engine";
import { hardFilter } from "@/server/generation/filters";
import { POOL_WINDOWS, retrieveCandidates, zonesFor } from "@/server/generation/retrieve";
import { collapseByPlace, scoreAll } from "@/server/generation/score";
import { DeterministicSelector } from "@/server/generation/select";
import type { Candidate, GenerationRequest, Menu, Selection } from "@/server/generation/types";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { haversineKm, HaversineStubProvider } from "@/shared/day-grammar/travel";
import { validateDay } from "@/shared/day-grammar/validate";
import { diceIndex, diceStream, personaIdentity } from "@/shared/dice";
import { GOLDEN_PERSONAS, type Persona } from "@/shared/persona";
import { timeToMinutes } from "@/shared/time";
import { PLACE_CATEGORIES } from "@/shared/vocabulary";

/**
 * Coherence probe (XXX-47, Session 16 CP2) — the acceptance evidence.
 *
 * TWO measurements, and they answer different questions:
 *
 *   A. THE FOUNDER'S OWN ZIG-ZAG DAY (trace 10708aa4, 2026-08-29). His six
 *      stops swung east-west across ~8 km three times and
 *      `route.detour-avoidable` fired on two of them. The day is reconstructed
 *      from the trace's own recorded card place_ids — REAL venues, REAL
 *      coordinates — and his actual picks are used as the pass's starting
 *      point. What is reconstructed rather than recorded is the MENU each
 *      slot had, which is rebuilt offline from the pool at his recorded seed;
 *      the divergences are printed rather than smoothed over.
 *
 *   B. THE EIGHT EXAM PERSONAS, recomposed offline. Answers the question a
 *      single day cannot: does the pass help generally, does it ever make a
 *      day worse, and how often does it find nothing.
 *
 * FREE: Supabase reads only. No Google endpoint, no Anthropic call, no
 * generation. The pass itself is pure — every trial is an in-memory compose
 * and validate.
 *
 *   npx tsx --env-file=.env.local scripts/coherence-probe.ts
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 62 - s.length))}`);
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const TRACE_PREFIX = "10708aa4";

interface Built {
  menus: Menu[];
  byId: Map<string, Candidate>;
  skeleton: ReturnType<typeof buildSkeleton>;
  request: GenerationRequest;
  pool: Candidate[];
}

async function buildFor(
  supabase: SupabaseClient,
  persona: Persona,
  date: string,
  seed: number,
): Promise<Built> {
  const request: GenerationRequest = {
    city: "toronto",
    date,
    persona,
    budgetBand: null,
    transport: ["walk", "transit"],
    seed,
  };
  const skeleton = buildSkeleton(request, { seed });
  const identity = personaIdentity(persona);
  const zones = zonesFor(
    persona.lens,
    [],
    diceStream({ seed, identity, site: "zone", context: date }),
  );
  const pool = await retrieveCandidates(
    supabase,
    "toronto",
    [...PLACE_CATEGORIES],
    zones,
    (category) =>
      diceIndex(
        { seed, identity, site: "pool-window", context: category },
        POOL_WINDOWS.length,
      ),
  );
  const permitted = excludeRefusedVenues(pool, request.excludedCategories ?? []);
  const scored = scoreAll(permitted.kept, persona, null, seed);
  const { kept } = hardFilter(
    scored,
    date,
    skeleton.daySpan,
    (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min,
  );
  const rescored = scoreAll(kept, persona, null, seed);
  const byId = new Map(collapseByPlace(rescored).map((c) => [c.place.id, c] as const));
  const menus = buildMenus(
    skeleton,
    rescored,
    date,
    timeToMinutes("20:30"),
    undefined,
  );
  return { menus, byId, skeleton, request, pool };
}

/** Total travel across a composed day's priced legs. */
const travelOf = (legs: readonly { minutes: number }[]): number =>
  legs.reduce((sum, l) => sum + l.minutes, 0);

/** Longitude swing: the founder's own complaint, measured. */
function swings(coords: { lat: number; lng: number }[]): {
  km: number;
  reversals: number;
} {
  let km = 0;
  let reversals = 0;
  let lastDir = 0;
  for (let i = 1; i < coords.length; i += 1) {
    km += haversineKm(coords[i - 1], coords[i]);
    const dir = Math.sign(coords[i].lng - coords[i - 1].lng);
    if (dir !== 0 && lastDir !== 0 && dir !== lastDir) reversals++;
    if (dir !== 0) lastDir = dir;
  }
  return { km, reversals };
}

async function run(
  supabase: SupabaseClient,
  label: string,
  built: Built,
  selections: Selection[],
  date: string,
): Promise<{ before: number; after: number; moves: number; detourBefore: number; detourAfter: number }> {
  const environment = await fetchEnvironment(supabase, "toronto", date);
  const composeInput = {
    request: built.request,
    skeleton: built.skeleton,
    selections,
    candidatesById: built.byId,
    travel: new HaversineStubProvider(),
    outdoorLatestEnd: timeToMinutes("20:30"),
    alternates: new Map(
      built.menus.map((m) => [m.intent.id, m.options.map((o) => o.place.id)]),
    ),
  };
  const baseline = composeDay(composeInput);
  const ctx = buildGrammarContext({
    environment,
    mealPattern: defaultMealPattern(built.request.persona),
    persona: built.request.persona,
    budgetBand: null,
    lodging: null,
    anchorBaseline: baseline.anchorBaseline,
    travel: new HaversineStubProvider(),
    transport: ["walk", "transit"],
    excludedCategories: built.request.excludedCategories ?? null,
  });
  const findingsOf = (day: Parameters<typeof validateDay>[0]) => validateDay(day, ctx);
  const beforeFindings = findingsOf(baseline.day);
  const beforeViolations = beforeFindings.filter((f) => f.severity === "violation");

  const protectedIntentIds = new Set(
    built.skeleton.intents.filter((i) => i.role === "anchor").map((i) => i.id),
  );
  const outcome = improveCoherence({
    selections,
    menus: built.menus,
    protectedIntentIds,
    params: COMPOSE_PARAMS.coherence,
    evaluate: (candidate) => {
      const trial = composeDay({ ...composeInput, selections: [...candidate] });
      const found = findingsOf(trial.day);
      return {
        totalTravelMinutes: travelOf(trial.legs),
        valid: !found.some((f) => f.severity === "violation"),
        unfilledCount: trial.unfilled.length,
      };
    },
  });
  const improved =
    outcome.moves.length > 0
      ? composeDay({ ...composeInput, selections: outcome.selections })
      : baseline;
  const afterFindings = findingsOf(improved.day);

  const coordsOf = (d: typeof baseline) =>
    d.day.slots
      .map((s) => d.day.places[s.placeId]?.coords)
      .filter((c): c is { lat: number; lng: number } => c != null);
  const sBefore = swings(coordsOf(baseline));
  const sAfter = swings(coordsOf(improved));
  const detourBefore = beforeFindings.filter((f) => f.ruleId === "route.detour-avoidable").length;
  const detourAfter = afterFindings.filter((f) => f.ruleId === "route.detour-avoidable").length;

  line(
    `  ${label.padEnd(18)} travel ${String(travelOf(baseline.legs)).padStart(4)} → ${String(travelOf(improved.legs)).padStart(4)} min` +
      `   path ${sBefore.km.toFixed(1)} → ${sAfter.km.toFixed(1)} km` +
      `   reversals ${sBefore.reversals} → ${sAfter.reversals}` +
      `   detour-advisory ${detourBefore} → ${detourAfter}` +
      `   moves ${outcome.moves.length}/${outcome.trials} trials`,
  );
  if (beforeViolations.length > 0) {
    line(
      `      baseline did NOT validate (${beforeViolations.map((v) => v.ruleId).join(", ")}) — the pass declines to touch it, by design`,
    );
  }
  for (const m of outcome.moves) {
    line(
      `      ${describeMove(m, (id) => improved.day.places[id]?.name ?? built.byId.get(id)?.place.name ?? id)}`,
    );
  }
  /**
   * A SURVIVING DETOUR ADVISORY IS THE INTERESTING CASE, so it is diagnosed
   * rather than counted. The ticket's AC is "no inter-zone hop that
   * `route.detour-avoidable` would flag", and a pass that quietly leaves one
   * standing while reporting a travel saving would be answering an easier
   * question than the one asked.
   *
   * Three things can leave one standing, and they need different fixes:
   * the swap the advisory wants involves the pinned ANCHOR (by design — the
   * centre does not move); the grammar refused every improving move; or no
   * menu held anything nearer, which is retrieval's ceiling, not this pass's.
   */
  for (const f of afterFindings.filter((f) => f.ruleId === "route.detour-avoidable")) {
    const slotIds = (f.data.swapSlotIds ?? []) as string[];
    const touchesAnchor = slotIds.some((id) =>
      protectedIntentIds.has(id.replace(/^s-/, "")),
    );
    /**
     * IS THE ADVISORY'S OWN SWAP EVEN LEGAL? Asked rather than assumed.
     *
     * `checkDetour` permutes the slot ARRAY and re-prices it, keeping each
     * slot's own start and end times. It never asks whether the two venues
     * could occupy each other's windows — whether the hours hold, whether a
     * meal stays inside its pattern window, whether the categories are
     * interchangeable at all. So the minutes it quotes are a HINT, and this
     * checks whether they are a plan.
     */
    const swapLegal = (() => {
      const a = improved.day.slots.findIndex((sl) => sl.id === slotIds[0]);
      const b = improved.day.slots.findIndex((sl) => sl.id === slotIds[1]);
      if (a < 0 || b < 0) return null;
      const swapped = {
        ...improved.day,
        slots: improved.day.slots.map((sl, i) =>
          i === a
            ? { ...sl, placeId: improved.day.slots[b].placeId }
            : i === b
              ? { ...sl, placeId: improved.day.slots[a].placeId }
              : sl,
        ),
      };
      const legal = !findingsOf(swapped).some((v) => v.severity === "violation");
      const describe = (i: number) => {
        const sl = improved.day.slots[i];
        const pl = improved.day.places[sl.placeId];
        const cat = pl?.category?.status === "present" ? pl.category.value : "?";
        return `${sl.id}[${sl.kind}/${sl.role ?? "-"}] ${pl?.name} (${cat})`;
      };
      line(`        would put: ${describe(a)}  ↔  ${describe(b)}`);
      return legal;
    })();
    line(
      `      RESIDUAL ${f.ruleId} (${f.data.deltaMinutes} min): ${slotIds.join(" ↔ ")}` +
        (touchesAnchor
          ? " — involves the pinned ANCHOR, which no move may touch"
          : outcome.rejectedByGrammar > 0
            ? " — improving moves existed and the grammar refused them"
            : " — no menu held anything nearer; retrieval's ceiling, not the pass's"),
    );
    line(
      swapLegal === null
        ? "        (its slots could not be located to test the swap)"
        : swapLegal
          ? "        the advisory's own swap DOES validate — a reachable saving the pass could not express"
          : "        the advisory's own swap does NOT validate: it quotes a saving the day cannot legally take",
    );
  }
  if (outcome.rejectedByGrammar > 0 || outcome.rejectedByUnfilled > 0) {
    line(
      `      refused: ${outcome.rejectedByGrammar} by the grammar, ${outcome.rejectedByUnfilled} for dropping a stop`,
    );
  }
  return {
    before: travelOf(baseline.legs),
    after: travelOf(improved.legs),
    moves: outcome.moves.length,
    detourBefore,
    detourAfter,
  };
}

async function main(): Promise<void> {
  const supabase = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  head("A — the founder's zig-zag day, measured from its own trace");

  const traces = await supabase
    .from("traces")
    .select("id, metadata")
    .eq("kind", "day_generation")
    .order("started_at", { ascending: false })
    .limit(30);
  if (traces.error) throw new Error(traces.error.message);
  const row = (traces.data as { id: string; metadata: Record<string, unknown> }[]).find(
    (t) => t.id.startsWith(TRACE_PREFIX),
  );
  if (row === undefined) {
    line(`  trace ${TRACE_PREFIX} is no longer in the last 30 generations — skipped.`);
  } else {
    const meta = row.metadata;
    const cards = (meta.tasting as { cards: Record<string, { place_id: string }> }).cards;
    line(
      `  trace ${row.id.slice(0, 8)} · ${meta.date} · seed ${meta.seed} · template ${meta.arc_template_id} · anchor ${(meta.elected_anchor as { category: string }).category}`,
    );

    /**
     * WHAT IS MEASURED HERE, AND WHAT IS NOT.
     *
     * The trace records his six stops, and `places` has their real
     * coordinates — so his day's GEOMETRY is a recorded fact and is measured
     * exactly below. What the trace does NOT record is the MENU each slot
     * had, and the pass can only ever choose from menus. So the honest number
     * for "what would the pass have saved on his day" comes in two parts:
     *
     *   the SEQUENCING BOUND — the best possible ordering of his own six
     *   venues, brute-forced over all 720 permutations. Every pass that only
     *   reorders is bounded by this, and it is an UPPER bound: a free
     *   permutation ignores meal windows and opening hours, so no real day
     *   can necessarily reach it.
     *
     *   the SUBSTITUTION HALF, which needs his menus and therefore cannot be
     *   measured from this trace at all. Section B measures that on days
     *   whose menus we do hold.
     *
     * An earlier version of this probe rebuilt his menus from a DIFFERENT
     * persona's pool window (his profile was edited after the day, so his
     * `persona_identity` matches nothing stored) and recovered 3 of his 6
     * stops. It then reported a saving on that three-stop day as though it
     * were his. It was not his day, and the number is deleted rather than
     * carried with a caveat — a measurement of the wrong thing is not
     * evidence, however well labelled.
     */
    const ids = Object.values(cards).map((c) => c.place_id);
    const places = await supabase
      .from("places")
      .select("id, name, lat, lng")
      .in("id", ids);
    if (places.error) throw new Error(places.error.message);
    const byPlace = new Map(
      (places.data as { id: string; name: string; lat: number; lng: number }[]).map(
        (p) => [p.id, p],
      ),
    );
    const stops = Object.entries(cards)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([slotId, card]) => ({ slotId, ...byPlace.get(card.place_id)! }));

    line();
    line("  his day, in the order he was given it:");
    for (const stop of stops) {
      line(
        `    ${stop.slotId}  ${stop.name.padEnd(26)} ${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`,
      );
    }

    const travel = new HaversineStubProvider();
    const legMinutes = (
      a: { lat: number; lng: number },
      b: { lat: number; lng: number },
    ): number =>
      travel.estimate({
        origin: a,
        destination: b,
        mode: "transit",
        departureLocal: "12:00",
      })?.minutes ?? 0;
    const tourMinutes = (order: typeof stops): number => {
      let sum = 0;
      for (let i = 1; i < order.length; i += 1) sum += legMinutes(order[i - 1], order[i]);
      return sum;
    };

    const asShipped = tourMinutes(stops);
    const shippedSwing = swings(stops);

    // 6 stops = 720 orderings. Exhaustive, so "best" is exact rather than a
    // heuristic's opinion about what is reachable.
    let best = stops;
    let bestMinutes = asShipped;
    const permute = (rest: typeof stops, acc: typeof stops): void => {
      if (rest.length === 0) {
        const m = tourMinutes(acc);
        if (m < bestMinutes) {
          bestMinutes = m;
          best = acc;
        }
        return;
      }
      for (let i = 0; i < rest.length; i += 1) {
        permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
      }
    };
    permute(stops, []);
    const bestSwing = swings(best);

    line();
    line(
      `  as shipped:      ${asShipped} min of travel · ${shippedSwing.km.toFixed(1)} km walked/ridden · ${shippedSwing.reversals} east-west reversals`,
    );
    line(
      `  best ordering:   ${bestMinutes} min · ${bestSwing.km.toFixed(1)} km · ${bestSwing.reversals} reversals   → ${best.map((s) => s.name.split(" ")[0]).join(" → ")}`,
    );
    line(
      `  SEQUENCING BOUND: ${asShipped - bestMinutes} min (${asShipped === 0 ? "—" : `${(((asShipped - bestMinutes) / asShipped) * 100).toFixed(0)}%`}) was available from ordering alone, on his own six venues.`,
    );
    line(
      "  Upper bound, stated as one: a free permutation ignores meal windows and",
    );
    line(
      "  opening hours, so a real day cannot necessarily reach it. It is the",
    );
    line("  ceiling on the reordering half, not a promise.");
  }

  head("B — the eight exam personas, recomposed offline");
  const totals = { before: 0, after: 0, moves: 0, worse: 0, detourBefore: 0, detourAfter: 0 };
  const date = "2026-08-15";
  const seed = 42;
  for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
    const built = await buildFor(supabase, persona, date, seed);
    const selections = await new DeterministicSelector().select(built.menus, persona, seed);
    const r = await run(supabase, key, built, selections, date);
    totals.before += r.before;
    totals.after += r.after;
    totals.moves += r.moves;
    totals.detourBefore += r.detourBefore;
    totals.detourAfter += r.detourAfter;
    if (r.after > r.before) totals.worse++;
  }
  head("verdict");
  line(`  total travel across 8 days: ${totals.before} → ${totals.after} min (${totals.before === 0 ? "—" : `${(((totals.before - totals.after) / totals.before) * 100).toFixed(1)}% saved`})`);
  line(`  route.detour-avoidable advisories: ${totals.detourBefore} → ${totals.detourAfter}`);
  line(`  moves made: ${totals.moves} · days made WORSE: ${totals.worse}`);
  line();
  if (totals.worse > 0) {
    console.error("FAIL: the pass made a day worse. It may only accept a strict improvement.");
    process.exit(1);
  }
  line("PASS — no day was made worse, and every move was re-validated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
