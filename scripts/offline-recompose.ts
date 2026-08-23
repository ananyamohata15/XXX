import { createClient } from "@supabase/supabase-js";
import { ARC_TEMPLATES } from "@/server/generation/arc";
import { buildSkeleton, composeDay } from "@/server/generation/compose";
import { buildMenus, excludeRefusedVenues } from "@/server/generation/engine";
import { hardFilter } from "@/server/generation/filters";
import {
  POOL_WINDOWS,
  retrieveCandidates,
  zonesFor,
} from "@/server/generation/retrieve";
import { collapseByPlace, scoreAll } from "@/server/generation/score";
import { DeterministicSelector } from "@/server/generation/select";
import type { Candidate, GenerationRequest, Selection } from "@/server/generation/types";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { diceIndex, diceStream, personaIdentity } from "@/shared/dice";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { timeToMinutes } from "@/shared/time";
import {
  CATEGORY_FAMILY,
  PLACE_CATEGORIES,
  type PlaceCategory,
} from "@/shared/vocabulary";

/**
 * Offline recompose of the matrix — the $0 half of the CP2 proof.
 *
 * Reads the candidate pool the PAID runs already persisted (Supabase
 * `places` + `facts`; `retrieveCandidates` touches no Google endpoint),
 * then builds each golden persona's skeleton, selects deterministically and
 * composes. No Details call, no Anthropic call, no forecast — so the
 * anchor-seating question can be asked as many times as it takes for
 * nothing.
 *
 * What it cannot prove: live travel times (this uses the Haversine stub,
 * as the report's own fallback does) and LLM selection. Those are the live
 * confirm's job, and the honest division is stated rather than blurred.
 *
 *   npx tsx --env-file=.env.local scripts/offline-recompose.ts [--date YYYY-MM-DD] [--seed n]
 */

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const date = arg("--date") ?? "2026-08-15";
  const seed = Number(arg("--seed") ?? 42);
  const supabase = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
  );

  console.log(
    `offline recompose — date=${date} seed=${seed} · DB pool only, $0 (no Google, no Anthropic)\n`,
  );

  const keys = Object.keys(GOLDEN_PERSONAS);
  let seated = 0;
  const rows: string[] = [];
  const roleSeq = new Map<string, string[]>();
  /**
   * REST FIRE-RATE (XXX-42, Session 14 ruling): reported so drift in either
   * direction is visible. A rare intervention that silently becomes common
   * is as wrong as one that silently stops firing — and the second is what
   * this session's first build did, undetected by five green tests.
   */
  const restFired = new Map<string, string | null>();
  const catSeq = new Map<string, string[]>();
  const venues = new Map<string, Set<string>>();
  const templateHasClose = new Map<string, boolean>();
  /**
   * The retrieved pool per persona, kept for the no-alcohol fire-rate below.
   * Kept rather than re-queried: the constraint's whole claim is about the
   * pool THIS day was built from, and a second query would be a second pool.
   */
  const pools = new Map<string, Candidate[]>();

  for (const key of keys) {
    const persona = GOLDEN_PERSONAS[key];
    const request: GenerationRequest = {
      city: "toronto",
      date,
      persona,
      budgetBand: key === "day-4-budget" ? { min: 0, max: 70, currency: "CAD" } : null,
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
    pools.set(key, pool);
    // FIDELITY (Session 12 CP1, ruled as doctrine): the harness CALLS the
    // engine's selection path and MIRRORS ITS SEQUENCE — it never
    // re-implements either.
    //
    // The sequence matters as much as the functions, and getting it wrong is
    // how the original defect happened. `retrieveCandidates` emits one
    // Candidate per (place, CATEGORY), so a place mapped to several
    // categories appears several times under one `place.id` — 79 of them in
    // the Toronto pool, 45 straddling the food boundary. The engine collapses
    // that collision ONCE, at `engine.ts:292`, BEFORE menus exist, so its
    // selection and its composition necessarily agree about what a place is.
    // The old harness collapsed it AFTER selecting from the still-duplicated
    // list, so it selected Brazen Head Irish Pub at its `restaurants` score
    // for a meal and then composed with the same place's `nightlife_bars`
    // variant. A bar seated as a meal — Session 11's symptom exactly.
    //
    // So the engine's order is mirrored step for step (engine.ts:287-397):
    // score, collapse, hard-filter, re-score, menus over the FULL re-scored
    // pool — which is what `engine.ts:431` passes, NOT the shortlist
    // (`pickShortlist` governs only which candidates earn paid Details calls,
    // and offline there are none).
    //
    // The SEQUENCE is as load-bearing as the functions. Collapse must follow
    // scoring, because `collapseByPlace` keeps the best-SCORING category and
    // scores do not exist before `scoreAll`. Collapsing first picks a
    // different survivor, and the offline day stops being the live day.
    const prescored = scoreAll(pool, persona, request.budgetBand, seed);
    const { kept } = hardFilter(
      collapseByPlace(prescored),
      date,
      skeleton.daySpan,
      (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min,
    );
    const scored = scoreAll(kept, persona, request.budgetBand, seed);
    const byId = new Map(scored.map((c: Candidate) => [c.place.id, c]));
    const menus = buildMenus(
      skeleton,
      scored,
      date,
      timeToMinutes("20:30"),
      undefined,
    );
    const selections: Selection[] = await new DeterministicSelector().select(
      menus,
      persona,
      seed,
    );

    /**
     * ALTERNATES — the fidelity gap that made this harness blind to menu
     * allocation (XXX-40, Session 14 Step 2).
     *
     * `generateDay` passes `alternates` on every `composeDay` call
     * (`engine.ts`, the ComposeInput literal). This harness did not, so the
     * scheduler's whole fallback path — try the selected venue, then the rest
     * of its menu in order — was never exercised offline.
     *
     * That matters more than it sounds. `DeterministicSelector` takes
     * `options[0]`, so the SELECTED venue is unaffected by how positions 2..n
     * are allocated; allocation only shows up when the head fails to seat and
     * the alternates are consulted. Measuring menu allocation on a harness
     * with no alternates therefore reads null BY CONSTRUCTION — which is
     * exactly what the first run after the change reported.
     *
     * Session 12 ruled the doctrine this repairs: the harness calls the
     * engine's path and MIRRORS ITS SEQUENCE. An instrument that omits an
     * input the engine always supplies is measuring a different engine.
     */
    const composedRequest: GenerationRequest = {
      ...request,
      // The rest stop needs lodging to have anywhere to be. The harness
      // measures the fire-rate WITH lodging known, which is the condition
      // the metric is about; the lodging-unknown path is asserted in tests.
      lodging: { lat: 43.6517, lng: -79.3817 },
    };
    const composed = composeDay({
      request: composedRequest,
      skeleton,
      selections,
      candidatesById: byId,
      travel: new HaversineStubProvider(),
      outdoorLatestEnd: timeToMinutes("20:30"),
      alternates: new Map(
        menus.map((m) => [m.intent.id, m.options.map((o) => o.place.id)]),
      ),
    });

    restFired.set(
      key,
      composed.restReason === null ? null : composed.restReason.trigger,
    );
    roleSeq.set(
      key,
      composed.day.slots.map((sl) => sl.role ?? "?"),
    );
    // The category SELECTION used, not the place's stored fact. The two can
    // disagree in the DB pool (a stale fact against the row's own column),
    // and reporting the fact while selecting on the column produced
    // nonsense sequences — a bar seated as a meal. What the arc chose is
    // the thing this metric is about.
    catSeq.set(
      key,
      composed.day.slots.map((sl) => byId.get(sl.placeId)?.category ?? "?"),
    );
    venues.set(key, new Set(composed.day.slots.map((sl) => sl.placeId)));
    templateHasClose.set(
      key,
      (ARC_TEMPLATES.find((t) => t.id === skeleton.templateId)?.steps ?? []).includes(
        "close",
      ),
    );

    const anchorIntent = skeleton.intents.find((i) => i.role === "anchor");
    const anchorSlot = composed.day.slots.find((s) => s.role === "anchor");
    const ok = anchorSlot !== undefined;
    if (ok) seated++;
    const anchorPlace =
      anchorSlot === undefined
        ? null
        : composed.day.places[anchorSlot.placeId]?.name;

    rows.push(
      `${ok ? "  OK " : "  ** "}${key.padEnd(17)}pool=${String(pool.length).padStart(3)} ` +
        `tpl=${skeleton.templateId.padEnd(11)} elected=${(skeleton.electedAnchor?.category ?? "user-anchor").padEnd(18)}` +
        `stops=${composed.day.slots.length} anchor=${ok ? anchorPlace : "MISSING"}` +
        (anchorIntent !== undefined && composed.unfilled.includes(anchorIntent.id)
          ? " [reported unfilled]"
          : "") +
        (skeleton.droppedSteps.length > 0
          ? ` dropped=${skeleton.droppedSteps.map((d) => d.step).join(",")}`
          : "") +
        (composed.unfilled.length > 0
          ? ` unfilled=${composed.unfilled
              .map(
                (id) =>
                  skeleton.intents.find((i) => i.id === id)?.role ?? id,
              )
              .join(",")}`
          : ""),
    );
  }

  console.log(rows.join("\n"));

  // ---- structural matrix, computed here so it costs nothing -------------
  const lcs = (a: string[], b: string[]): number => {
    const t = Array.from({ length: a.length + 1 }, () =>
      new Array<number>(b.length + 1).fill(0),
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        t[i][j] =
          a[i - 1] === b[j - 1]
            ? t[i - 1][j - 1] + 1
            : Math.max(t[i - 1][j], t[i][j - 1]);
      }
    }
    return t[a.length][b.length];
  };
  const overlap = (a: string[], b: string[]): number =>
    a.length === 0 || b.length === 0
      ? 0
      : lcs(a, b) / Math.min(a.length, b.length);

  /**
   * DISCRETIONARY-SEQUENCE OVERLAP — the gated distinctiveness metric
   * (XXX-37, PO adjudication at Session 13 CP3).
   *
   * The pre-registered ≤0.55 was set against raw category-sequence overlap,
   * and Session 13 measured why it cannot be met: **0.396 of the 0.617 is
   * the meal pattern alone**. Every scheduler day carries restaurants at
   * lunch and at dinner because the grammar requires it. Counting those
   * shared positions as sameness measured GRAMMAR COMPLIANCE AS DULLNESS —
   * the metric punished the day for obeying a rule the product wants obeyed.
   *
   * Meals are STRUCTURAL. What a concierge actually chooses — the anchor,
   * the contrast, the warmup, the close — is DISCRETIONARY, and that is what
   * distinctiveness is a claim about. So the gate moves to the non-meal
   * positions and raw category-sequence stays reported as a diagnostic.
   *
   * This is a LOUD RE-BASELINE: prior category-seq readings (Session 9
   * 0.693, Session 11 0.711, Session 13 CP1 0.614) are retained as
   * old-instrument history and are NOT comparable to this number.
   */
  /**
   * STRUCTURAL roles, excluded from the discretionary sequence.
   *
   * `meal` was the original exclusion and the reasoning generalises: a
   * discretionary position is one where a CONCIERGE CHOSE A CATEGORY. Session
   * 14 added two roles that are not choices of that kind, and both would
   * corrupt the metric if counted:
   *
   *   `rest`      — the venue is the hotel. It is not in the candidate pool,
   *                 so its category reads "?" and two days that both rest
   *                 would score as sharing a discretionary choice they never
   *                 made. Caught the moment the fire-rate metric landed: the
   *                 comparable-pair count moved 21 -> 16 on a change that
   *                 altered no category decision anywhere.
   *   `provision` — the category comes from the ExperienceSpec, not a draw.
   *                 Counting a determined value as a choice measures the spec.
   */
  const STRUCTURAL_ROLES = new Set(["meal", "rest", "provision"]);
  const discretionaryOf = (key: string): string[] => {
    const roles = roleSeq.get(key)!;
    const cats = catSeq.get(key)!;
    return cats.filter((_, i) => !STRUCTURAL_ROLES.has(roles[i]));
  };

  /**
   * THE GATED DOMAIN — equal-length pairs only (XXX-40, Session 14 ruling).
   *
   * The pre-registered threshold and normalizer are UNTOUCHED. What changed is
   * the domain, and the Session 11 comparable-pairs precedent is the warrant:
   * a metric may exclude a comparison it cannot make honestly.
   *
   * The diagnosis that forced it: `LCS / min(len)` makes a SUBSEQUENCE score
   * 1.00 by construction. `day-5-wanderer` carries two discretionary
   * positions — the CP1 ruling gives wanderers three intents and one is a
   * meal — and its two choices appear in order inside `day-4-budget`'s three,
   * so the pair reads 1.00 while sharing nothing a concierge chose twice.
   * Measured across the whole matrix: ONE pair above the gate, zero
   * equal-length collisions.
   *
   * Gating on it would have gated the CP1 wanderer ruling rather than
   * sameness. Normalizing by the longer sequence instead would have passed
   * that same pair at exactly 0.67 — a knife-edge pass, refused.
   *
   * Unequal-length pairs are still REPORTED, at `byLonger`, with a watched
   * expectation of <=0.67. Excluded from gating is not excluded from view.
   */
  let dSum = 0, dMax = 0, dN = 0, dWorst = "";
  /** Unequal-length pairs: reported at byLonger, never gating. */
  let uMax = 0, uN = 0, uWorst = "";
  let breakSum = 0, breakMax = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const di = discretionaryOf(keys[i]);
      const dj = discretionaryOf(keys[j]);
      if (Math.abs(di.length - dj.length) > 1) continue;
      const shared = lcs(di, dj);
      if (di.length !== dj.length) {
        const byLonger = shared / Math.max(1, Math.max(di.length, dj.length));
        uN++;
        if (byLonger > uMax) { uMax = byLonger; uWorst = `${keys[i]} vs ${keys[j]}`; }
        continue;
      }
      const so = overlap(di, dj);
      dSum += so; dN++;
      if (so > dMax) { dMax = so; dWorst = `${keys[i]} vs ${keys[j]}`; }
      const floor = di.length;
      const broken = floor === 0 ? 0 : Math.max(0, shared - 1) / floor;
      breakSum += broken;
      breakMax = Math.max(breakMax, broken);
    }
  }

  let cmpSum = 0, cmpMax = 0, cmpN = 0, roleSum = 0, roleN = 0;
  let vSum = 0, vMax = 0, vN = 0;
  let worst = "";
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ci = catSeq.get(keys[i])!, cj = catSeq.get(keys[j])!;
      const ro = overlap(roleSeq.get(keys[i])!, roleSeq.get(keys[j])!);
      roleSum += ro; roleN++;
      const vi = venues.get(keys[i])!, vj = venues.get(keys[j])!;
      const inter = [...vi].filter((v) => vj.has(v)).length;
      const vo = inter / Math.max(1, Math.min(vi.size, vj.size));
      vSum += vo; vMax = Math.max(vMax, vo); vN++;
      if (Math.abs(ci.length - cj.length) <= 1) {
        const so = overlap(ci, cj);
        cmpSum += so; cmpN++;
        if (so > cmpMax) { cmpMax = so; worst = `${keys[i]} vs ${keys[j]}`; }
      }
    }
  }
  const cmpMean = cmpN > 0 ? cmpSum / cmpN : 0;
  const dMean = dN > 0 ? dSum / dN : 0;
  /**
   * PRE-REGISTERED at Session 13 close-out (PO ruling 1):
   *
   *   max  ≤0.67  — GATES
   *   mean          REPORTED ONLY
   *
   * The mean does not gate, and the reason is arithmetic rather than
   * leniency. Discretionary sequences run 2–4 positions, so a single shared
   * position swings the pair's score by 0.25–0.50. A mean gate set by
   * break-one-shared-position lands at ≤0.15, which punishes GRANULARITY
   * rather than sameness: two genuinely different days of three stops each
   * cannot help scoring far above it. The max asks the question that
   * matters — is any PAIR of days too alike — and one pair sharing every
   * discretionary position (1.00, as day-3-winter and day-4-budget do
   * today) is exactly the failure worth gating on.
   *
   * REVISIT TRIGGER, recorded: the mean graduates to gating if and when
   * discretionary sequences LENGTHEN — more activity slots per pattern. At
   * 5+ discretionary positions one shared position is worth ≤0.20 and the
   * mean stops being a measure of how short the sequences are.
   */
  const DISCRETIONARY_MAX_GATE = 0.67;
  /**
   * THE DENOMINATOR GUARD (Session 14 ruling) — the zero-fire lesson applied
   * to the gate itself.
   *
   * A gate whose domain has emptied out reports PASS while measuring nothing,
   * which is the same silence as a feature that never fires. Three is the
   * floor: below it a single pair decides the gate, and "no pair was too
   * alike" stops being a claim about the matrix.
   */
  const GATE_STARVED_BELOW = 3;
  const totalPairs = (keys.length * (keys.length - 1)) / 2;
  const starved = dN < GATE_STARVED_BELOW;
  const gatePass = dMax <= DISCRETIONARY_MAX_GATE;
  console.log(
    `\n  DISCRETIONARY-sequence [equal-length pairs, GATED: n=${dN} of ${totalPairs}]:` +
      ` max=${dMax.toFixed(2)} (GATE ≤${DISCRETIONARY_MAX_GATE}) → ${starved ? "GATE-STARVED" : gatePass ? "PASS" : "FAIL"}   worst=${dWorst || "(none)"}`,
  );
  if (starved) {
    console.log(
      `      ⚠ only ${dN} equal-length pair(s) in the domain — below the ${GATE_STARVED_BELOW}-pair floor.` +
        ` A gate this thin reports PASS while measuring almost nothing; treat as UNPROVEN, not green.`,
    );
  }
  console.log(
    `      unequal-length pairs [REPORTED at byLonger, non-gating, n=${uN}]:` +
      ` max=${uMax.toFixed(2)} (watched ≤${DISCRETIONARY_MAX_GATE})   worst=${uWorst || "(none)"}` +
      `\n        a shorter sequence that is a SUBSEQUENCE of a longer one scores 1.00 under min-normalization` +
      ` by construction, which is why these are reported rather than gated.`,
  );
  console.log(
    `      mean=${dMean.toFixed(3)} (REPORTED ONLY — see the pre-registration note; short sequences make a mean gate measure granularity)`,
  );
  console.log(
    `  raw category-sequence [comparable, n=${cmpN}, REPORTED not gated]: mean=${cmpMean.toFixed(3)} max=${cmpMax.toFixed(2)}   worst=${worst}`,
  );
  console.log(
    `  break-one-shared-position from this run: mean would read ${(breakSum / Math.max(1, dN)).toFixed(2)} · max ${breakMax.toFixed(2)}` +
      ` (the derivation the ≤${DISCRETIONARY_MAX_GATE} max gate came from)`,
  );
  console.log(`  role-sequence [n=${roleN}]: mean=${(roleSum / roleN).toFixed(3)} (non-gating)`);
  console.log(`  venue overlap [n=${vN}]: mean=${(vSum / vN).toFixed(3)} max=${vMax.toFixed(2)}`);
  // Closes, RESTATED (Session 12 CP2 ruling 1): seated closes over the
  // templates that HAVE a close step. Three templates — `moderate-d`,
  // `packed-c`, `relaxed-d` — end on a meal by design, which was Session 11
  // §7.3's own fix for the unrecorded `lastStep = "close"` invariant. Scoring
  // those as a missing close measured the template table, not the composer.
  const wanted = keys.filter((k) => templateHasClose.get(k) === true);
  const closes = wanted.filter((k) => roleSeq.get(k)!.includes("close")).length;
  const raw = keys.filter((k) => roleSeq.get(k)!.includes("close")).length;
  console.log(
    `  closes [restated: seated / templates WITH a close step]: ${closes}/${wanted.length}` +
      ` → ${closes === wanted.length ? "PASS" : "MISS"}   (raw, for the record: ${raw}/${keys.length})`,
  );
  const restCount = [...restFired.values()].filter((t) => t !== null).length;
  console.log(
    `  rest fire-rate [lodging known]: ${restCount}/${keys.length}` +
      `   ${[...restFired.entries()].filter(([, t]) => t !== null).map(([k, t]) => `${k}:${t}`).join(" ") || "(none)"}`,
  );
  console.log(`  role sequences:`);
  for (const k of keys) console.log(`    ${k.padEnd(17)}${roleSeq.get(k)!.join(">")}`);
  console.log(`  category sequences:`);
  for (const k of keys) console.log(`    ${k.padEnd(17)}${catSeq.get(k)!.join(">")}`);

  /**
   * DRINKING-FOCUS FIRE RATE (XXX-44, Session 16) — against each persona's
   * REAL retrieved pool, not a fixture.
   *
   * The number that matters is the third column: venues the CATEGORY gate
   * would have admitted and the LABEL gate refuses. A zero there means the
   * ticket shipped nothing, and this line says so out loud rather than
   * letting a suite of green tests imply otherwise — Session 14's rest stop
   * fired zero times behind five passing tests.
   */
  console.log(`  no-alcohol fire-rate [per persona's own retrieved pool]:`);
  console.log(
    `    persona            pool   refused   of those, CATEGORY-permitted`,
  );
  for (const k of keys) {
    const personaPool = pools.get(k) ?? [];
    const { dropped } = excludeRefusedVenues(personaPool, ["nightlife_bars"]);
    const byLabelOnly = dropped.filter((d) => d.category !== "nightlife_bars");
    console.log(
      `    ${k.padEnd(17)}${String(personaPool.length).padStart(5)}${String(dropped.length).padStart(10)}${String(byLabelOnly.length).padStart(12)}   ${byLabelOnly
        .slice(0, 2)
        .map((d) => `${d.name} (${d.category})`)
        .join(", ")}`,
    );
  }

  // How much of the overlap is the MEAL PATTERN alone? Every scheduler day
  // owes restaurants at lunch and at dinner to `classic`, before the arc
  // has any say. That is the metric's structural floor.
  const foodOnly = (a: string[]): string[] =>
    a.filter((c) => c === "restaurants" || c === "cafes");
  let floorSum = 0, floorN = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ci = catSeq.get(keys[i])!, cj = catSeq.get(keys[j])!;
      if (Math.abs(ci.length - cj.length) > 1) continue;
      floorSum += overlap(foodOnly(ci), foodOnly(cj)) * Math.min(foodOnly(ci).length, foodOnly(cj).length) / Math.min(ci.length, cj.length);
      floorN++;
    }
  }
  /**
   * ADJACENCY CENSUS (XXX-46, Session 16) — the fire-rate line the rule owes.
   *
   * Labelled as what it is: not a validator run (this harness has no forecast
   * and no ephemeris, so half the rules would fire on absence), but the
   * adjacency verdict applied to the composer's OWN category sequences using
   * the rule's OWN tables. It answers the one question a green test cannot —
   * does the composer still produce the shape, and does the rule agree with
   * the days this harness has always called good?
   *
   * It is also where a narrowing got caught. The first version of this rule
   * blocked the whole `table` family; run here it condemned day-2 and day-6
   * for opening `cafes` → `restaurants` — coffee then brunch, a meal pattern
   * this product ships by name. The fixtures were silent, because no
   * founder-authored fixture happens to have that pair.
   */
  const adjacencyRows: string[] = [];
  let blocking = 0;
  let advisories = 0;
  for (const k of keys) {
    const seq = catSeq.get(k)!;
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1] as PlaceCategory;
      const b = seq[i] as PlaceCategory;
      if (!PLACE_CATEGORIES.includes(a) || !PLACE_CATEGORIES.includes(b)) continue;
      const twoMeals =
        GRAMMAR_PARAMS.pacing.mealGrade[a] && GRAMMAR_PARAMS.pacing.mealGrade[b];
      const family = CATEGORY_FAMILY[a];
      const verdict = twoMeals
        ? "blocking"
        : CATEGORY_FAMILY[b] === family
          ? GRAMMAR_PARAMS.pacing.consecutiveFamily[family]
          : "permitted";
      if (verdict === "permitted") continue;
      if (verdict === "blocking") blocking++;
      else advisories++;
      adjacencyRows.push(
        `    ${verdict.toUpperCase().padEnd(9)} ${k.padEnd(17)}${a} → ${b}`,
      );
    }
  }
  console.log(
    `  adjacency census [rule tables over composed sequences]: ${blocking} blocking, ${advisories} advisory` +
      `${blocking === 0 ? "  → PASS (no recomposed day is refused)" : "  → FAIL"}`,
  );
  for (const row of adjacencyRows) console.log(row);
  if (blocking > 0) process.exitCode = 1;
  console.log(
    `  structural floor from the meal pattern alone: mean=${(floorSum / Math.max(1, floorN)).toFixed(3)} of the ${cmpMean.toFixed(3)} measured`,
  );
  console.log(
    `\nanchors seated: ${seated}/${keys.length}${seated === keys.length ? "  → PASS" : "  → FAIL"}`,
  );
  if (seated !== keys.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
