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
  NON_ANCHOR_CATEGORIES,
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
 * THE EXPERIENCE TEMPLATE FAMILY (XXX-38, Session 14 Step 3 — granted as
 * recorded legislation).
 *
 * Kept out of `ARC_TEMPLATES` because it is not a variation on a city day.
 * The first live islands generation proved the difference: filtering the
 * ordinary templates gave the composite block a 240-minute window between
 * lunch and dinner, which is a four-hour island day with no room to walk to
 * the ferry. Golden Day 7's own block runs **12:00–20:00**.
 *
 * The shape is `meal → [provision] → anchor-block → meal`. The block is
 * permitted to DOMINATE the day and to run through meal windows; the trailing
 * meal seats after it, which is the founder's conditional late dinner.
 * `provision` is inserted ahead of the anchor by `buildSkeleton` when the
 * spec declares it, so it is not written here.
 */
export const EXPERIENCE_TEMPLATES: readonly ArcTemplate[] = [
  {
    id: "experience-a",
    structure: "scheduler",
    pace: "relaxed",
    steps: ["meal", "anchor", "meal"],
  },
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
  /**
   * A scheduler template carries at least two meal steps — **AMENDED**
   * (XXX-38, Session 14 Step 3 ruling 2, cited here because invariants are
   * rulings and this one now has its vote).
   *
   * The amendment: **a composite block whose `ExperienceSpec` declares
   * `absorbsMeals` counts as one meal step.** The picnic is lunch, and the
   * provisioning stop is its evidence — so an experience day that eats
   * brunch, spends eight hours on a beach with a grocery bag, and offers a
   * conditional late dinner has three meals, not two, even though only two
   * are seated as stops.
   *
   * The original reasoning is untouched and still holds for city days: a
   * scheduler with ONE meal step strands its whole non-meal arc on one side
   * of a single meal window, which is how the first draft produced days that
   * started at 19:00. An absorbed meal does not strand anything — it is
   * happening inside the block.
   */
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
export function pickTemplate(
  persona: Persona,
  seed: number,
  /**
   * Restricts the draw to templates that can hold this shape (XXX-40).
   *
   * A THREAD needs at least two discretionary positions, because its spine is
   * 2–3 same-family stops and `THREAD_INVARIANTS.threadMinStops` says a
   * one-stop spine is a venue day with extra words. Measured before it was
   * added: `relaxed-a` has no `contrast` step, so `day-3-winter` and
   * `persona-scenic` drew a history-thread day whose whole "tour" was a
   * single historic site — precisely the shape the founder ruled cannot
   * carry a day.
   *
   * Returns null rather than throwing when nothing matches, so the caller
   * decides whether a themeless fallback or an honest failure is right.
   */
  requires?: (template: ArcTemplate) => boolean,
): ArcTemplate {
  const draw = {
    identity: personaIdentity(persona),
    structure: persona.structure,
    pace: persona.pace,
  };
  if (requires === undefined) return templateForDraw(draw, seed);
  const options = templatesForDraw(draw).filter(requires);
  if (options.length === 0) return templateForDraw(draw, seed);
  const key = (draw.identity ^ (Math.abs(seed) >>> 0)) >>> 0;
  return options[key % options.length];
}

/**
 * Templates that can hold a THREAD.
 *
 * Two requirements, and the second was found by measuring rather than by
 * reasoning:
 *
 *  1. a `contrast` step, so the spine has its second stop. Without it the
 *     "tour" is one historic site, which is exactly the shape the founder
 *     ruled cannot carry a day.
 *  2. a `warmup` or a `close`, so the day has a THIRD TEXTURE. A spine is
 *     same-family by construction and meals are all `table`, so a template
 *     of `[meal, anchor, contrast, meal]` — `relaxed-d` — produces a
 *     two-family day and trips `pacing.minTextureFamilies`. Measured:
 *     `persona-scenic` drew exactly that and came back at 2.
 *
 * A thread breaks anti-alternation ON PURPOSE at its spine; it does not get
 * to break the texture floor as a side effect.
 */
export function holdsAThread(template: ArcTemplate): boolean {
  return (
    template.steps.includes("contrast") &&
    (template.steps.includes("warmup") || template.steps.includes("close"))
  );
}

/**
 * Can this traveller's template set hold this shape at all?
 *
 * **Wanderers cannot hold a thread**, and that is a real answer rather than
 * a gap to paper over: no wanderer template carries a `contrast` step,
 * because the CP1 ruling gave wanderers three intents and negative space.
 * A 2–3 stop scheduled spine is in tension with that shape by design.
 *
 * Returned as a feasibility fact so theme SELECTION can filter on it — the
 * funnel rule, filter first then roll — and so a REQUESTED thread for a
 * wanderer fails honestly instead of silently degrading to a one-stop
 * "tour". Adding a wanderer-thread template is a founder call about what a
 * drifting history day even is, not something to invent here.
 */
export function templatesHolding(
  persona: Persona,
  requires: (template: ArcTemplate) => boolean,
): ArcTemplate[] {
  return templatesFor(persona).filter(requires);
}

/**
 * Templates that can hold a multi-hour composite block without the day
 * collapsing around it. A template already carrying two contrast steps has
 * committed its afternoon to variety, which is the opposite of what an
 * experience day wants.
 */
export function holdsAnExperience(template: ArcTemplate): boolean {
  return template.steps.filter((s) => s === "contrast").length <= 1;
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

/**
 * Which categories a stop seated in the EVENING may draw from — the single
 * owner of the question (XXX-40, Session 14 CP0 census).
 *
 * This existed TWICE and the two copies had drifted. Session 13 found
 * `compose.ts`'s copy silently deleting `scenic_viewpoints` from every close
 * — a hardcoded three written when the vocabulary had seven — fixed it, and
 * recorded the lesson in CLAUDE.md as the fourth load-bearing constant. It
 * did not know there was a second copy in `pickContrast`, which still read
 * `["nightlife_bars", "historic_sites"]`. So for a whole session an evening
 * CONTRAST could not be a viewpoint while an evening CLOSE could, and
 * nothing said so.
 *
 * Two things fix that, and only the second one is durable:
 *
 *  1. one owner, so the copies cannot disagree; and
 *  2. **an EXHAUSTIVE map rather than an admit-list.** `satisfies
 *     Record<PlaceCategory, boolean>` means adding a category to the
 *     vocabulary does not compile until someone rules on its evening. An
 *     admit-list defaults a new category to "no" in silence, which is
 *     precisely how `scenic_viewpoints` was deleted from every evening close
 *     — and a single owner alone would have kept that failure mode intact,
 *     just in one file instead of two.
 *
 * `historic_sites` is TRUE and inherited: many are open-air and lit, and the
 * hours filter is what stops the ones that are not.
 *
 * **`shopping` is TRUE by founder ruling (Session 14 CP0), and it is a
 * BEHAVIOUR CHANGE recorded as one.** It was carried in at `false` — today's
 * behaviour — as an open question, on the ground that Eaton Centre trades
 * until 21:00. The founder's ruling names the better principle:
 *
 *   *the coarse category gate should stop encoding what per-venue,
 *   per-weekday hours already know.*
 *
 * That is the honest division of labour. A boutique that shuts at 18:00 dies
 * on its own verified hours in `hardFilter`, where the decision belongs and
 * where it is a FACT. Refusing the whole category here instead makes the
 * grammar guess on behalf of every venue in it — and guesses badly, because
 * the mall class it was accidentally excluding is precisely the class that IS
 * open. This list's job is "could a stop of this kind plausibly be an evening
 * at all", not "is this particular door open", and `museums_galleries`
 * remains false because the answer to the first question is genuinely no.
 *
 * Proven by an offline A/B ($0) at the ruling, and due the founder's eye at
 * CP4 rather than treated as settled by the argument alone.
 */
export const EVENING_VIABLE = {
  restaurants: true,
  cafes: false,
  museums_galleries: false,
  historic_sites: true,
  markets: false,
  nightlife_bars: true,
  parks: false,
  shopping: true,
  scenic_viewpoints: true,
  grocery: false,
} as const satisfies Record<PlaceCategory, boolean>;

/** Is a stop of this category plausibly worth seating after ~19:00? */
export function isEveningViable(category: PlaceCategory): boolean {
  return EVENING_VIABLE[category];
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
     * Categories the TRAVELLER refused (XXX-43) — a different fact from
     * `exclude`, and kept separate deliberately.
     *
     * The first build folded these into `exclude` on the reasoning that both
     * mean "do not elect this". They do — but `exclude` also STAMPS A REASON,
     * and the reason it stamps is *"re-elected after X could not be seated"*.
     * Routed through it, a day for someone who does not drink recorded that
     * we had TRIED to seat a bar and failed. That is a lie in the trace, and
     * a trace that lies about why is worse than one that says nothing:
     * "the pool failed us" and "the traveller said no" are different facts
     * and a later reader mining either would draw the wrong conclusion.
     *
     * So: same filtering, no narrative. A refusal needs no explanation
     * beyond itself.
     */
    refused?: readonly PlaceCategory[];
    /**
     * The seeded stream for site "anchor". Required — an un-diced elector is
     * how `historic_sites` won every tie against `museums_galleries` for
     * every persona forever (the alphabet was the tie-break).
     */
    dice: () => number;
  },
): ElectedAnchor | null {
  const exclude = options.exclude ?? [];
  const refused = options.refused ?? [];
  const eligible = PLACE_CATEGORIES.filter(
    (c) =>
      !GRAMMAR_PARAMS.pacing.foodCategories.includes(c) &&
      // Vocabulary v2 (XXX-37): `grocery` is mapped and usable, and nobody
      // plans a day around a supermarket. Kept separate from the food
      // categories because a provisioning stop is not a meal — folding it in
      // would trip `pacing.food-stops-exceeded` on a day that bought bread.
      !NON_ANCHOR_CATEGORIES.includes(c) &&
      !exclude.includes(c) &&
      !refused.includes(c),
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
  const evening = options.eveningOnly === true;
  const eligible = PLACE_CATEGORIES.filter((c) => {
    if (GRAMMAR_PARAMS.pacing.foodCategories.includes(c)) return false;
    if (CATEGORY_FAMILY[c] === anchorFamily) return false;
    if (used.has(CATEGORY_FAMILY[c])) return false;
    // `EVENING_VIABLE`, not a local list. This line held its own copy —
    // `["nightlife_bars", "historic_sites"]` — which Session 13's fix to the
    // OTHER copy never reached, so an evening contrast could not be a
    // viewpoint while an evening close could.
    if (evening && !isEveningViable(c)) return false;
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
  // `shopping` joins the warmup list (XXX-37): a morning wander through a
  // shopping street is low-commitment, early and easy, which is exactly what
  // this step is for. `scenic_viewpoints` deliberately does NOT — a lookout
  // is a payoff, and putting the day's best view first spends it before the
  // day has earned it.
  const preferred: PlaceCategory[] = ["cafes", "markets", "parks", "shopping"];
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
  /**
   * Is the step immediately before the close already a FOOD stop? (XXX-43,
   * Session 15 CP4 defect 3.)
   *
   * THE DEFECT, from the founder's own day: dinner at Simpl Things 18:45,
   * then Tibet Kitchen 20:25 as the close — food after food, ending the day
   * on the texture it had just served.
   *
   * Nothing caught it, and the reason is a PREDICATE-REACH asymmetry rather
   * than a missing rule. `pickContrast` (below) filters out food categories
   * AND families already used. `closeCategories` did neither: it appended
   * `restaurants` unconditionally as the ranked tail. So the same guard that
   * protects the middle of the day was absent at its end.
   *
   * Why the two grammar rules that might have caught it did not, measured on
   * that day: the food cap counts TOTALS (3 food stops against a `classic`
   * allowance of 4 — under the cap), and the texture rule counts DISTINCT
   * FAMILIES over four consecutive stops (markets, historic_sites,
   * restaurants, restaurants = 3 distinct, meeting `minTextureFamilies`).
   * Neither looks at ADJACENCY, so two table stops back to back are
   * invisible to both. That gap is real and reported separately; this fix
   * stops composition producing the day in the first place.
   *
   * Narrow on purpose: closing on a restaurant is often exactly right — a
   * late dinner IS a landing. The defect is only ever a food close that
   * FOLLOWS food.
   */
  previousIsFood = false,
): PlaceCategory[] {
  /**
   * `scenic_viewpoints` joins the CLOSE list (XXX-37), and it is the most
   * natural fit anything has had here. An ending that lands is an
   * experience, and a viewpoint at golden hour is the ending golden Day 7
   * is built around — *"Hanlan's beach is west-facing, the best sunset spot
   * on the islands"*. The dusk clamp and the daylight rules already govern
   * outdoor slots, so a sunset close is bounded by real ephemeris rather
   * than by hope.
   */
  /**
   * `shopping` joins the CLOSE list (XXX-40, Session 14 CP0, founder ruling).
   *
   * It is offered UNIVERSALLY rather than gated on a shopping persona, and
   * that is the palette philosophy stated plainly: **the palette offers,
   * affinity weights, the die orders.** A category-level `if` for "is this a
   * shopper" would re-import the knife-edge the `night >= 0.35` gate above
   * was deleted for — `categoryAffinity` already returns 0 for a persona with
   * no shopping interest, so the draw sinks it without a threshold to
   * mis-tune.
   *
   * The gate change alone was inert: `EVENING_VIABLE.shopping = true` filters
   * what the palette proposes, and this list was not proposing it. Measured
   * at the ruling — 271 shopping candidates survive `persona-shopper`'s
   * 20:15–22:00 close window, so the category was legal, wanted, and
   * unreachable.
   */
  const experience: PlaceCategory[] = [
    "nightlife_bars",
    "scenic_viewpoints",
    "historic_sites",
    "parks",
    "shopping",
  ];
  const drawn = weightedOrderBy(
    experience,
    (c) => categoryAffinity(persona, c),
    dice,
    COMPOSE_PARAMS.dice.close,
  );
  /**
   * The table tail is offered only when the day did not just eat. Dropping
   * it leaves five experience categories, so the close is never starved —
   * it simply cannot be a second dinner.
   */
  return previousIsFood ? [...drawn] : [...drawn, "restaurants"];
}

export type { CategoryFamily };
