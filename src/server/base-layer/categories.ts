import type { PlaceCategory } from "../domain/schemas";

/**
 * FSQ taxonomy → our seven categories, by breadcrumb prefix (decision 002 /
 * SESSION_NOTES 2.1). These are INTENT rules; the binding artifact is the
 * generated ID map (category-ids.generated.ts) that scripts/pin-categories.ts
 * materializes from the pinned release's own categories table. The pin run
 * prints every matched label for reviewer eyeballing, and a rule that matches
 * zero labels fails the pin loudly — a silent no-op rule is a bug.
 *
 * Matching is plain startsWith, deliberately: "Dining and Drinking > Cafe"
 * must catch "… > Cafes, Coffee, and Tea Houses". The pin report is the
 * guard against prefix over-capture, not a cleverer matcher.
 *
 * Events are not venues (recorded divergence): the FSQ "Event" top-level
 * branch (festivals, temporary marketplaces) brushes our `markets`
 * category semantically, but our vocabulary maps durable schedulable
 * venues only — no rule touches the Event branch, so event rows land in
 * category_unmapped by construction. An "Event > …" label in the pin
 * report's matched output would be a rule bug.
 */
export const CATEGORY_BREADCRUMB_RULES: Record<PlaceCategory, string[]> = {
  restaurants: ["Dining and Drinking > Restaurant"],
  cafes: [
    // The comma is load-bearing: the release taxonomy's label family is
    // "Cafe, Coffee, and Tea House"; a bare "Cafe" prefix over-captured
    // "Cafeteria" (found in the 2026-07-09 pin review, excluded on purpose).
    "Dining and Drinking > Cafe,",
    "Dining and Drinking > Coffee",
    "Dining and Drinking > Bakery",
  ],
  nightlife_bars: [
    "Dining and Drinking > Bar",
    "Dining and Drinking > Night Club",
    "Arts and Entertainment > Night Club",
    "Nightlife",
  ],
  museums_galleries: [
    "Arts and Entertainment > Museum",
    "Arts and Entertainment > Art Gallery",
    "Arts and Entertainment > Gallery",
  ],
  historic_sites: [
    "Landmarks and Outdoors > Historic and Protected Site",
    "Landmarks and Outdoors > Historic Site",
    "Landmarks and Outdoors > Monument",
  ],
  markets: [
    "Retail > Farmers Market",
    "Retail > Flea Market",
    "Retail > Market",
  ],
  parks: [
    "Landmarks and Outdoors > Park",
    "Landmarks and Outdoors > Garden",
    "Landmarks and Outdoors > Beach",
  ],
};

/**
 * Which of our categories (if any) a full FSQ breadcrumb label maps to.
 * First rule wins in PLACE_CATEGORIES declaration order — deterministic.
 */
export function matchBreadcrumb(label: string): PlaceCategory | null {
  for (const [category, prefixes] of Object.entries(
    CATEGORY_BREADCRUMB_RULES,
  ) as [PlaceCategory, string[]][]) {
    if (prefixes.some((p) => label.startsWith(p))) return category;
  }
  return null;
}
