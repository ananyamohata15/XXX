/**
 * The day's ARC (XXX-35 item 3, ruled at Session 11 CP1).
 *
 * Session 10's trace audit found the monotony's real cause upstream of
 * everything the ticket originally blamed: `buildSkeleton` had no concept
 * of a day's shape. It dealt meal intents straight off the pattern's
 * windows and filled the leftovers with activities in persona-gravity
 * order, so 3 of 5 intents were meals and both activity slots could
 * legally draw the same top-gravity category. "Meal, gallery, meal,
 * gallery, meal" was not a bug in any rule — it was the only shape that
 * skeleton could produce.
 *
 * The founder's recorded verdicts say the same thing twice, in words the
 * ticket does not use: **"the day isnt anchored on anything"**. So the arc
 * is anchor-led. Every day ELECTS a centrepiece, and the rest of the day
 * is described relative to it.
 *
 * Three independent axes of variation keep this a GRAMMAR OF SHAPES rather
 * than one shape (comment 10294's homogenization failure mode):
 *
 *   1. which template — seeded, from a set per (structure × pace)
 *   2. which anchor category — persona gravity
 *   3. which venue — existing scoring, jitter and selection
 *
 * Two personas that draw the same template still differ in their centre
 * and in every venue; one persona on two dates draws different templates.
 *
 * Pure and deterministic: same (persona, pattern, seed) → same arc.
 */

import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { personaIdentity, weightedOrderBy } from "@/shared/dice";
import { categoryAffinity, type Persona } from "@/shared/persona";
import {
  CATEGORY_FAMILY,
  PLACE_CATEGORIES,
  type CategoryFamily,
  type PlaceCategory,
  type SlotRole,
} from "@/shared/vocabulary";
import { COMPOSE_PARAMS } from "./compose-params";

/**
 * A role in a template. `open` is placed FREE TIME and is deliberately not
 * a `SlotRole`: it never becomes a slot (see OpenInterval — slots.place_id
 * is NOT NULL and free time is not a stop). Everything else seats a venue.
 */
export type ArcStep = SlotRole | "open";

export interface ArcTemplate {
  /** Stable id — it goes in the trace, so a shape is auditable after the fact. */
  id: string;
  structure: Persona["structure"];
  pace: Persona["pace"];
  steps: ArcStep[];
}

/**
 * The templates. Literal data, read once — no engine, no DSL, no
 * inheritance. Every row is asserted against TEMPLATE_INVARIANTS in tests:
 * exactly one `anchor`, an ending that is an experience or a dinner, and
 * never a bare `meal` sitting behind an `open` (the "2hrs free → meal"
 * ending the founder rejected).
 *
 * Meal steps are placed by the arc; how MANY exist is still the meal
 * pattern's call (comment 10290 — patterns, not fixed slots), so a
 * template's meal steps are filled in pattern-window order and any
 * surplus step is dropped rather than inventing a fourth meal.
 */
export const ARC_TEMPLATES: readonly ArcTemplate[] = [
  // --- scheduler · relaxed -------------------------------------------------
  { id: "relaxed-a", structure: "scheduler", pace: "relaxed", steps: ["warmup", "meal", "anchor", "open", "meal", "close"] },
  { id: "relaxed-b", structure: "scheduler", pace: "relaxed", steps: ["meal", "anchor", "contrast", "meal", "close"] },
  { id: "relaxed-c", structure: "scheduler", pace: "relaxed", steps: ["warmup", "anchor", "meal", "contrast", "meal", "close"] },
  // Ends on dinner rather than an after-dinner stop. See TEMPLATE_INVARIANTS:
  // CP1 forbade a meal ending only when it sits behind an `open`, and the
  // stronger "always close" was an unrecorded tightening that made every
  // scheduler day end the same way.
  { id: "relaxed-d", structure: "scheduler", pace: "relaxed", steps: ["meal", "anchor", "contrast", "meal"] },
  // --- scheduler · moderate ------------------------------------------------
  { id: "moderate-a", structure: "scheduler", pace: "moderate", steps: ["warmup", "meal", "anchor", "contrast", "meal", "close"] },
  { id: "moderate-b", structure: "scheduler", pace: "moderate", steps: ["meal", "anchor", "open", "contrast", "meal", "close"] },
  { id: "moderate-c", structure: "scheduler", pace: "moderate", steps: ["warmup", "anchor", "meal", "contrast", "open", "meal", "close"] },
  { id: "moderate-d", structure: "scheduler", pace: "moderate", steps: ["warmup", "meal", "anchor", "contrast", "meal"] },
  // --- scheduler · packed --------------------------------------------------
  { id: "packed-a", structure: "scheduler", pace: "packed", steps: ["warmup", "meal", "anchor", "contrast", "contrast", "meal", "close"] },
  { id: "packed-b", structure: "scheduler", pace: "packed", steps: ["meal", "warmup", "anchor", "contrast", "open", "meal", "close"] },
  { id: "packed-c", structure: "scheduler", pace: "packed", steps: ["warmup", "meal", "anchor", "contrast", "contrast", "meal"] },
  // --- wanderer ------------------------------------------------------------
  // THREE stops, per the CP1 ruling: "wanderers get an arc of three
  // intents, and rule 27's unstructured floor stays the binding
  // constraint". One meal step, which `mealWindowsFor` reads as the middle
  // pattern window — a drifting day's one meal is brunch, and its `close`
  // is the strip (golden Day 5: "the strip is the plan").
  // The drift sits BETWEEN brunch and the anchor. It was ["meal",
  // "anchor", "open", "close"] until the invariant test caught it: that
  // shape ends open-then-close, which is the "2hrs free → meal" the
  // founder rejected, written into a template.
  { id: "wanderer-a", structure: "wanderer", pace: "relaxed", steps: ["meal", "open", "anchor", "close"] },
  { id: "wanderer-b", structure: "wanderer", pace: "relaxed", steps: ["anchor", "open", "meal", "close"] },
];

/**
 * Invariants every template holds, asserted in tests rather than trusted:
 *
 *  1. exactly one `anchor` — a day has one centre
 *  2. the last step is `close` or `meal` — a day ends on an experience or
 *     on dinner, both of which are endings people actually want
 *  3. the step before the last is never `open` — "2hrs free → meal" is the
 *     ending the founder rejected, and no template may express it
 *  4. a SCHEDULER template carries at least two `meal` steps. Wanderers
 *     carry one on purpose (three intents, per the CP1 ruling); a
 *     scheduler with one strands its whole non-meal arc on one side of a
 *     single meal window, which is how the first draft produced days that
 *     started at 19:00.
 */
export const TEMPLATE_INVARIANTS = {
  anchorCount: 1,
  /**
   * What a day may END on.
   *
   * This used to be `close`, full stop — and that was a tightening of the
   * CP1 ruling nobody recorded. CP1 forbade one specific ending: a bare
   * `meal` sitting behind an `open` ("2hrs free → dinner"), which is the
   * shape the founder rejected. Requiring `close` everywhere instead made
   * every scheduler day end identically, and the CP2 fix round measured
   * the cost — role-sequence overlap 1.000 once closes seated on 6 of 6.
   *
   * Dinner IS how many good days end. What must never happen is dinner
   * arriving because the day ran out, which is exactly the
   * behind-an-`open` case, and `rhythm.ending-without-landing` advises on
   * the same shape from the other side.
   */
  lastSteps: ["close", "meal"] as ArcStep[],
  minMealStepsScheduler: 2,
  minMealStepsWanderer: 1,
};

/**
 * Wanderers have one template set regardless of pace: their day is three
 * anchors and negative space, and pacing does not change that shape — it
 * is the structure tolerance that does (golden Day 5: "the strip is the
 * plan"). Recorded rather than silently folded in.
 */
export function templatesFor(persona: Persona): ArcTemplate[] {
  return templatesForDraw(persona);
}

/** The same rule, keyed on what a trace can carry. See `TemplateDraw`. */
export function templatesForDraw(
  draw: Pick<TemplateDraw, "structure" | "pace">,
): ArcTemplate[] {
  const matching = ARC_TEMPLATES.filter(
    (t) =>
      t.structure === draw.structure &&
      (draw.structure === "wanderer" || t.pace === draw.pace),
  );
  return matching.length > 0 ? matching : [ARC_TEMPLATES[3]];
}

/**
 * Deterministic template choice, keyed on WHO the traveller is and then
 * varied by seed.
 *
 * The first version mixed the seed with `persona.gravity.join(",").length`
 * — the character count of the interest list, not the interests. Two
 * personas whose gravity strings happened to be the same length drew the
 * same template on a shared seed, which is the Session 9 jitter bug's
 * signature exactly: similar inputs, identical dice. The Session 11 matrix
 * ran all six personas on one date and measured role-sequence overlap
 * 0.850 with two personas landing on `moderate-b`.
 *
 * Hashing the persona's identity CONTENT fixes the cause rather than the
 * symptom. Seed still varies the draw, so one persona on two dates gets
 * two shapes — the property the arc needs to avoid trip-level monotony.
 */
export function pickTemplate(persona: Persona, seed: number): ArcTemplate {
  return templateForDraw(
    {
      identity: personaIdentity(persona),
      structure: persona.structure,
      pace: persona.pace,
    },
    seed,
  );
}

/**
 * Everything a template draw actually depends on — and nothing else.
 *
 * Split out so a TRACE can carry it. Reproducibility is only a law if it can
 * be checked, and until Session 13 a trace recorded the seed but not who the
 * day was for, so `pickTemplate` could not be replayed against it. Only
 * tasting-room traces were checkable, via a `persona_key` the room happened
 * to stash for its own reasons — while 1,633 of the month's 1,842 Details
 * events were spent by harness runs whose traces could not be checked at
 * all. That is the surface Session 12's defect hid on for a whole session.
 *
 * These three fields are enough and are not the persona: an identity hash,
 * a structure and a pace replay the draw without the trace storing anyone's
 * taste profile.
 */
export interface TemplateDraw {
  identity: number;
  structure: Persona["structure"];
  pace: Persona["pace"];
}

export function templateForDraw(draw: TemplateDraw, seed: number): ArcTemplate {
  const options = templatesForDraw(draw);
  const key = (draw.identity ^ (Math.abs(seed) >>> 0)) >>> 0;
  return options[key % options.length];
}

export interface ElectedAnchor {
  category: PlaceCategory;
  /** Minutes — an ANCHOR dwell, not an ordinary stop's. See `anchorDwellFor`. */
  dwellMinutes: number;
  /** Why this category — the trace and the narration both read it. */
  reason: string;
}

/**
 * How long a CENTREPIECE of this category gets (XXX-35, Session 13 Step 2).
 *
 * The anchor used to take `dwellMinutes[c].typical` — the same number an
 * ordinary stop of that category gets. The audit that measured it found the
 * consequence in one line: `day-6-excursion`, a nature-first persona, drew a
 * **60-minute** centre in 200 of 200 skeletons, because `parks.typical` is
 * 60. Not once was that a narrow window degrading a good election. It was
 * the ceiling, every time.
 *
 * That is the founder's finding at its root. A category's typical dwell is
 * an average over the category, so a pocket park and Toronto Islands share
 * it, and the day's centre inherits the average of everything that is not a
 * centrepiece. "The anchor should be a highlight, not just anything random."
 *
 * So the anchor gets at least anchor calibre, and never more than the
 * category's own grammar maximum — the grammar still owns the ceiling, this
 * only stops the centre from being sized like a coffee stop:
 *
 *     clamp(minDwellMinutes, typical, max)
 *
 * parks 60 → 75 · markets 75 → 75 · historic_sites 90 → 90 ·
 * museums_galleries 120 → 120 · nightlife_bars 90 → 90.
 *
 * It moves exactly the categories that were being under-served and leaves
 * the rest untouched, which is the shape a fix should have.
 */
export function anchorDwellFor(category: PlaceCategory): number {
  const range = GRAMMAR_PARAMS.dwellMinutes[category];
  return Math.min(
    range.max,
    Math.max(range.typical, COMPOSE_PARAMS.anchor.minDwellMinutes),
  );
}

/**
 * Anchor election. The day's centrepiece is the highest-affinity NON-FOOD
 * category: a meal can be wonderful, but "we built your day around lunch"
 * is not a day, and food already owns the pattern's own slots.
 *
 * Tier 3 by construction — this is judgment, and it is labelled as such
 * wherever it travels. A user-origin anchor pre-empts election entirely
 * (see buildSkeleton): the day already has a centre, and electing a second
 * one would be exactly the duplicate ownership XXX-27 exists to prevent.
 */
export const ANCHOR_ELECTOR_SOURCE = "arc_elector_v1";

export function electAnchor(
  persona: Persona,
  options: {
    /**
     * Categories already tried and proven unseatable for this day. The
     * engine re-elects rather than shipping an anchorless day: a centrepiece
     * that cannot be seated is a reason to choose a different centrepiece,
     * never a reason to quietly deliver the un-anchored day the founder
     * rejected in exactly those words.
     */
    exclude?: readonly PlaceCategory[];
    /**
     * The seeded stream for site "anchor". Required — an un-diced elector is
     * how `historic_sites` won every tie against `museums_galleries` for
     * every persona forever (the alphabet was the tie-break).
     */
    dice: () => number;
  },
): ElectedAnchor | null {
  const exclude = options.exclude ?? [];
  const eligible = PLACE_CATEGORIES.filter(
    (c) =>
      !GRAMMAR_PARAMS.pacing.foodCategories.includes(c) && !exclude.includes(c),
  );
  // τ is deliberately near zero: the anchor MOSTLY FOLLOWS GRAVITY. It is the
  // persona's first interest made concrete, and a die that could move it
  // would break the product's promise rather than vary it. At 0.05 the draw
  // only reaches near-exact ties — which are common (seven categories, three
  // interests) and previously fell to `localeCompare`.
  const ordered = weightedOrderBy(
    eligible,
    (c) => categoryAffinity(persona, c),
    options.dice,
    COMPOSE_PARAMS.dice.anchor,
  );
  const category = ordered[0];
  // Every non-food category has been tried and none could be seated. The
  // caller must fail loudly; there is no honest anchor left to elect.
  if (category === undefined) return null;
  const affinity = categoryAffinity(persona, category);
  const first =
    affinity > 0
      ? `${persona.gravity[0]} is this traveller's first interest`
      : `no interest maps to a category, so the day is centred on ${category}`;
  return {
    category,
    dwellMinutes: anchorDwellFor(category),
    reason:
      exclude.length === 0
        ? first
        : `${first}; re-elected after ${exclude.join(", ")} could not be seated`,
  };
}

/**
 * A contrast category: a different TEXTURE FAMILY from the anchor, ranked
 * by affinity within that constraint. This is where anti-alternation is
 * won or lost — picking "the next best category" is how day-3 got two
 * galleries, because `historic_sites` is the same family as
 * `museums_galleries` and reads the same to a traveller.
 *
 * `used` carries the families already spent so a second contrast differs
 * from the first as well as from the anchor.
 */
export function pickContrast(
  persona: Persona,
  anchor: PlaceCategory,
  used: Set<CategoryFamily>,
  options: { eveningOnly?: boolean; dice: () => number },
): PlaceCategory[] {
  const anchorFamily = CATEGORY_FAMILY[anchor];
  const eveningOk: readonly PlaceCategory[] = ["nightlife_bars", "historic_sites"];
  const evening = options.eveningOnly === true;
  const eligible = PLACE_CATEGORIES.filter((c) => {
    if (GRAMMAR_PARAMS.pacing.foodCategories.includes(c)) return false;
    if (CATEGORY_FAMILY[c] === anchorFamily) return false;
    if (used.has(CATEGORY_FAMILY[c])) return false;
    if (evening && !eveningOk.includes(c)) return false;
    return true;
  });
  // A bar is an EVENING contrast. Daytime windows exclude `night` outright
  // rather than ranking it last: it is a fact about what a 14:20 stop can
  // be, not a preference the dice may trade away. Filter first, then roll —
  // the funnel rule. Kept as a fallback only if nothing else survives, so a
  // constrained day still gets a contrast rather than none.
  const daytime = evening
    ? eligible
    : eligible.filter((c) => CATEGORY_FAMILY[c] !== "night");
  const pool = daytime.length > 0 ? daytime : eligible;
  return weightedOrderBy(
    pool,
    (c) => categoryAffinity(persona, c),
    options.dice,
    COMPOSE_PARAMS.dice.contrast,
  );
}

/** Categories a `warmup` may draw from — low commitment, early, easy. */
export function warmupCategories(
  persona: Persona,
  dice: () => number,
): PlaceCategory[] {
  const preferred: PlaceCategory[] = ["cafes", "markets", "parks"];
  return weightedOrderBy(
    preferred,
    (c) => categoryAffinity(persona, c),
    dice,
    COMPOSE_PARAMS.dice.warmup,
  );
}

/**
 * Categories a `close` may draw from. An ending that lands is an
 * EXPERIENCE, not a table you arrive at because the day ran out — so a
 * close prefers night and outdoor-at-golden-hour, and falls back to a table
 * only when no experience can be seated.
 *
 * The `night >= 0.35` gate that used to decide whether `restaurants` was
 * offered is DELETED, not retuned (Session 12 CP1 ruling). It was a
 * knife-edge: `day-5-wanderer` measured **exactly** 0.350, because
 * `nightlife` sat at gravity position 3 and `GRAVITY_WEIGHTS[2]` IS 0.35.
 * Any persona with a 1.0-affinity interest in third position landed
 * precisely on the threshold, so `>=` vs `>` silently changed their day —
 * the load-bearing-constant failure exactly.
 *
 * The restructure removes the comparison rather than moving it: the three
 * experience categories are DRAWN, and `restaurants` is APPENDED behind them
 * as a ranked tail. No constant, no penalty to tune, and Session 11's stated
 * intent — "a table must not be the FIRST answer" — now holds structurally
 * instead of conditionally.
 */
export function closeCategories(
  persona: Persona,
  dice: () => number,
): PlaceCategory[] {
  const experience: PlaceCategory[] = [
    "nightlife_bars",
    "historic_sites",
    "parks",
  ];
  const drawn = weightedOrderBy(
    experience,
    (c) => categoryAffinity(persona, c),
    dice,
    COMPOSE_PARAMS.dice.close,
  );
  return [...drawn, "restaurants"];
}

export type { CategoryFamily };
