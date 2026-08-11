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
import { categoryAffinity, type Persona } from "@/shared/persona";
import {
  CATEGORY_FAMILY,
  PLACE_CATEGORIES,
  type CategoryFamily,
  type PlaceCategory,
  type SlotRole,
} from "@/shared/vocabulary";

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
 * inheritance. Two rules govern every row and both are asserted in tests:
 * exactly one `anchor`, and the last step is never a bare `meal` sitting
 * behind an `open` (the "2hrs free → meal" ending the founder rejected).
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
  // --- scheduler · moderate ------------------------------------------------
  { id: "moderate-a", structure: "scheduler", pace: "moderate", steps: ["warmup", "meal", "anchor", "contrast", "meal", "close"] },
  { id: "moderate-b", structure: "scheduler", pace: "moderate", steps: ["meal", "anchor", "open", "contrast", "meal", "close"] },
  { id: "moderate-c", structure: "scheduler", pace: "moderate", steps: ["warmup", "anchor", "meal", "contrast", "open", "meal", "close"] },
  // --- scheduler · packed --------------------------------------------------
  { id: "packed-a", structure: "scheduler", pace: "packed", steps: ["warmup", "meal", "anchor", "contrast", "contrast", "meal", "close"] },
  { id: "packed-b", structure: "scheduler", pace: "packed", steps: ["meal", "warmup", "anchor", "contrast", "open", "meal", "close"] },
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
 *  2. the last step is `close` — a day ends on purpose
 *  3. the step before `close` is never `open` — "2hrs free → meal" is the
 *     ending the founder rejected, and no template may express it
 *  4. a SCHEDULER template carries at least two `meal` steps. Wanderers
 *     carry one on purpose (three intents, per the CP1 ruling); a
 *     scheduler with one strands its whole non-meal arc on one side of a
 *     single meal window, which is how the first draft produced days that
 *     started at 19:00.
 */
export const TEMPLATE_INVARIANTS = {
  anchorCount: 1,
  lastStep: "close" as ArcStep,
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
  const matching = ARC_TEMPLATES.filter(
    (t) =>
      t.structure === persona.structure &&
      (persona.structure === "wanderer" || t.pace === persona.pace),
  );
  return matching.length > 0 ? matching : [ARC_TEMPLATES[3]];
}

/** Deterministic template choice — the seed is the variety axis. */
export function pickTemplate(persona: Persona, seed: number): ArcTemplate {
  const options = templatesFor(persona);
  // Mixed with the persona so two personas on one seed rarely agree, and
  // Math.abs because a negative seed is a caller's business, not a crash.
  const key = Math.abs(seed + persona.gravity.join(",").length * 31);
  return options[key % options.length];
}

export interface ElectedAnchor {
  category: PlaceCategory;
  /** Minutes. The centrepiece earns its category's full typical dwell. */
  dwellMinutes: number;
  /** Why this category — the trace and the narration both read it. */
  reason: string;
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

export function electAnchor(persona: Persona): ElectedAnchor {
  const ranked = PLACE_CATEGORIES.filter(
    (c) => !GRAMMAR_PARAMS.pacing.foodCategories.includes(c),
  ).sort(
    (a, b) =>
      categoryAffinity(persona, b) - categoryAffinity(persona, a) ||
      a.localeCompare(b),
  );
  const category = ranked[0];
  const affinity = categoryAffinity(persona, category);
  return {
    category,
    dwellMinutes: GRAMMAR_PARAMS.dwellMinutes[category].typical,
    reason:
      affinity > 0
        ? `${persona.gravity[0]} is this traveller's first interest`
        : `no interest maps to a category, so the day is centred on ${category} by name order`,
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
  options: { eveningOnly?: boolean } = {},
): PlaceCategory | null {
  const anchorFamily = CATEGORY_FAMILY[anchor];
  const eveningOk: readonly PlaceCategory[] = ["nightlife_bars", "historic_sites"];
  const evening = options.eveningOnly === true;
  const ranked = PLACE_CATEGORIES.filter((c) => {
    if (GRAMMAR_PARAMS.pacing.foodCategories.includes(c)) return false;
    if (CATEGORY_FAMILY[c] === anchorFamily) return false;
    if (used.has(CATEGORY_FAMILY[c])) return false;
    if (evening && !eveningOk.includes(c)) return false;
    return true;
  }).sort((a, b) => {
    // A bar is an evening contrast. When two categories tie on affinity —
    // which they do often, since a persona has three interests and there
    // are seven categories — alphabetical order was handing 14:20 slots to
    // `nightlife_bars`. Daytime windows rank `night` last instead.
    if (!evening) {
      const aNight = CATEGORY_FAMILY[a] === "night" ? 1 : 0;
      const bNight = CATEGORY_FAMILY[b] === "night" ? 1 : 0;
      if (aNight !== bNight) return aNight - bNight;
    }
    return (
      categoryAffinity(persona, b) - categoryAffinity(persona, a) ||
      a.localeCompare(b)
    );
  });
  return ranked[0] ?? null;
}

/** Categories a `warmup` may draw from — low commitment, early, easy. */
export function warmupCategories(persona: Persona): PlaceCategory[] {
  const preferred: PlaceCategory[] = ["cafes", "markets", "parks"];
  return [...preferred].sort(
    (a, b) => categoryAffinity(persona, b) - categoryAffinity(persona, a),
  );
}

/**
 * Categories a `close` may draw from. An ending that lands is an
 * EXPERIENCE, not a table you arrive at because the day ran out — so a
 * close prefers night and outdoor-at-golden-hour, and only falls back to a
 * table when the persona genuinely wants one.
 */
export function closeCategories(persona: Persona): PlaceCategory[] {
  const night = categoryAffinity(persona, "nightlife_bars");
  const experience: PlaceCategory[] = ["nightlife_bars", "historic_sites", "parks"];
  const ranked = [...experience].sort(
    (a, b) => categoryAffinity(persona, b) - categoryAffinity(persona, a),
  );
  // A table close is legitimate — dinner IS how most good days end. It
  // just must not be the FIRST answer, or every day ends the same way.
  return night >= 0.35 ? ranked : [...ranked, "restaurants"];
}

export type { CategoryFamily };
