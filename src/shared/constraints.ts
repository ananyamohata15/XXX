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
