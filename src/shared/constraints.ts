/**
 * Hard constraints (XXX-43, Session 15) — the ONE owner of the question
 * "may this traveller be sent here?"
 *
 * The founder's *"I don't drink"* has to reach nine places: the close
 * palette, the skeleton's slot intents, the contrast picker, the theme
 * palettes, the family licence, retrieval, the selection menu, every repair
 * pass, and the validator. Nine call sites answering the same question
 * independently is precisely the shape this codebase has been bitten by four
 * times — `eveningOk` existed twice and disagreed with itself for a whole
 * session, and `PlaceTags.outdoor` disagreed with the family it was supposed
 * to mirror.
 *
 * So the question has exactly one implementation, here, and every seam calls
 * it. `src/shared/` because both the engine and the client need the same
 * answer — a UI that offers a bar to a traveller who excluded bars is the
 * same defect as an engine that seats one.
 *
 * PERMISSION IS NOT VIABILITY. `EVENING_VIABLE` answers "could a stop of this
 * kind plausibly be an evening at all" and stays untouched (CP0 ruling 6).
 * This answers "is this traveller willing to go". Two questions, two owners,
 * neither allowed to stand in for the other.
 */

import type { PlaceCategory } from "./vocabulary";

/**
 * May this traveller be sent to a stop of this category?
 *
 * The empty exclusion list is the overwhelmingly common case and returns
 * `true` for everything, which is what makes a constraint-free request
 * byte-identical to one from before this file existed.
 */
export function isCategoryPermitted(
  category: PlaceCategory,
  excluded: readonly PlaceCategory[],
): boolean {
  return !excluded.includes(category);
}

/**
 * The permitted subset, order preserved.
 *
 * Order matters at every call site: the close palette is a weighted draw
 * whose sequence is the die's, and menu allocation round-robins in list
 * order. Filtering must remove without reordering, or a constraint would
 * silently change the shape of a day beyond the removal itself.
 */
export function permittedCategories(
  categories: readonly PlaceCategory[],
  excluded: readonly PlaceCategory[],
): PlaceCategory[] {
  if (excluded.length === 0) return [...categories];
  return categories.filter((c) => isCategoryPermitted(c, excluded));
}

/**
 * Does this set of categories still offer anything?
 *
 * A step whose whole palette was excluded cannot be filled, and the honest
 * response is to say so rather than to seat something the traveller refused.
 * Callers use this to choose between "narrow the palette" and "this cannot be
 * built" — the distinction between a thinner day and a dishonest one.
 */
export function isFullyExcluded(
  categories: readonly PlaceCategory[],
  excluded: readonly PlaceCategory[],
): boolean {
  return (
    categories.length > 0 &&
    categories.every((c) => !isCategoryPermitted(c, excluded))
  );
}

/**
 * The v1 limitation a hard category constraint owes the traveller (XXX-44).
 *
 * WHY THIS STRING EXISTS. `excludedCategories` filters by our ten-category
 * vocabulary, and category is a coarse proxy for an ATTRIBUTE like "serves
 * alcohol". Session 15's live proof seated Clandestino Wine Bar on a
 * no-alcohol day — no constraint was violated, because the venue is mapped
 * `restaurants`, and every seam did its job. Measured afterwards: 742 of
 * 19,286 pooled restaurants (3.85%) carry a `Dining and Drinking > Bar`
 * label despite mapping to `restaurants`.
 *
 * The founder's ruling: say so in-product rather than let him discover it.
 * **Honest limits beat silent ones.** A traveller who knows the edge of a
 * promise can work around it; one who finds it by sitting down in a wine bar
 * has been told something untrue by omission.
 *
 * It is a CONSTANT in `shared/` so the sentence has one owner and one
 * wording, and so deleting it is a deliberate act — it comes out only when
 * XXX-44 lands a per-venue drink fact that actually backs the constraint.
 */
export const CATEGORY_CONSTRAINT_LIMITATION =
  "I filter bars and drinking-focused venues by category. A restaurant that also serves wine can slip through until we have per-venue drink facts.";

/**
 * Should the limitation be shown? Only when a hard constraint is actually
 * set — an unconstrained traveller does not need a caveat about a promise
 * nobody made them.
 */
export function owesLimitationNotice(
  excluded: readonly PlaceCategory[],
): boolean {
  return excluded.length > 0;
}
