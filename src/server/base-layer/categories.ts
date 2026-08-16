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
    "Dining and Drinking > Bakery",
  ],
  nightlife_bars: [
    "Dining and Drinking > Bar",
    "Arts and Entertainment > Night Club",
    "Nightlife",
  ],
  museums_galleries: [
    "Arts and Entertainment > Museum",
    "Arts and Entertainment > Art Gallery",
  ],
  historic_sites: [
    "Landmarks and Outdoors > Historic and Protected Site",
    "Landmarks and Outdoors > Monument",
  ],
  markets: [
    // "Retail > Farmers Market" was here and matched NOTHING — the pinned
    // taxonomy files farmers markets under the food-retail branch, and the
    // pin's zero-match guard is per CATEGORY, so two live sibling rules hid
    // a dead one for three sessions. Replaced with the label that exists.
    "Retail > Food and Beverage Retail > Farmers Market",
    "Retail > Food and Beverage Retail > Fish Market",
    "Retail > Flea Market",
    "Retail > Floating Market",
    "Retail > Market",
  ],
  parks: [
    "Landmarks and Outdoors > Park",
    "Landmarks and Outdoors > Garden",
    "Landmarks and Outdoors > Beach",
  ],
  /**
   * Shopping as a DESTINATION, not retail as a census (XXX-37).
   *
   * Session 5 dropped the whole Retail branch and counted 722 unmapped rows
   * in Kensington alone. Most of that is right to drop: a pharmacy, a phone
   * store and a tyre shop are things a resident needs, not things a
   * traveller plans a day around. The test applied to every rule below is
   * the founder's own bar for the category — would someone spend an hour
   * here BROWSING, as the point of the stop?
   *
   * IN, and why:
   *  - Shopping Mall / Shopping Plaza / Outlet Mall / Department Store — the
   *    districts and halls. This is what makes Eaton Centre, Yorkdale and
   *    Sherway electable, which is the ticket's own example list.
   *  - Boutique / Vintage and Thrift Store — the character end, and how a
   *    corners persona reaches Queen West rather than a mall.
   *  - Bookstore / Record Store / Antique Store / Arts and Crafts Store —
   *    browsing venues in their own right, and the ones a traveller
   *    remembers.
   *
   * OUT, deliberately — the noise-exclusion argument:
   *  - The entire `Fashion Retail` branch. It is chain clothing stores, and
   *    including it would put a Foot Locker in a shopper's day with the same
   *    authority as Yorkville. `Boutique` covers the end that has character.
   *    This is the single biggest exclusion and the most likely to be
   *    overturned by a founder who wants Bloor Street proper.
   *  - Errand and service retail: Pharmacy, Drugstore, Hardware, Convenience,
   *    Office Supply, Pet Supplies, Medical Supply, Mobility, Eyecare,
   *    Financial or Legal Service, Print, Packaging, Construction Supplies.
   *  - The whole `Automotive Retail` branch, plus Auto Workshop.
   *  - Age/vice-gated and low-signal retail: Adult Store, Cannabis Store,
   *    Marijuana Dispensary, Smoke Shop, Vape Store, Tobacco, Betting Shop,
   *    Pawn Shop, Fireworks.
   *  - Volume retail with no browse value: Big Box, Warehouse or Wholesale,
   *    Discount Store, Outlet Store (the single store, as distinct from
   *    Outlet Mall), Vending Machine.
   *  - `Food and Beverage Retail` — that is `grocery`, below.
   */
  shopping: [
    "Retail > Shopping Mall",
    "Retail > Shopping Plaza",
    "Retail > Outlet Mall",
    "Retail > Department Store",
    "Retail > Boutique",
    "Retail > Vintage and Thrift Store",
    "Retail > Bookstore",
    "Retail > Record Store",
    "Retail > Antique Store",
    "Retail > Arts and Crafts Store",
  ],
  /**
   * Places whose point is the VIEW (XXX-37).
   *
   * The ticket names "Scenic Lookout / Observation Deck". Only the first
   * exists in the pinned release — there is no `Observation Deck` label
   * anywhere in the taxonomy, which is recorded rather than worked around.
   * The rest are the ticket's sanctioned "landmark-with-view judgment", and
   * each is a place whose reason to exist is standing and looking:
   *
   *  - Roof Deck and Tower — the Observation Deck substitute. CN Tower's
   *    class of thing.
   *  - Waterfront and Boardwalk — the founder's own word ("waterfront") in
   *    the anchor-fill list.
   *  - Lighthouse — golden Day 7's Gibraltar Point drift.
   *
   * OUT: `Bridge` and `Hill` (every overpass and rise in the city),
   * `Pedestrian Plaza` and `Plaza` (public space, not a viewpoint), and the
   * `States and Municipalities` branch, which is administrative geography
   * and not a venue at all.
   */
  scenic_viewpoints: [
    "Landmarks and Outdoors > Scenic Lookout",
    "Landmarks and Outdoors > Roof Deck",
    "Landmarks and Outdoors > Tower",
    "Landmarks and Outdoors > Waterfront",
    "Landmarks and Outdoors > Boardwalk",
    "Landmarks and Outdoors > Lighthouse",
  ],
  /**
   * Provisioning (XXX-37, for XXX-38's need).
   *
   * The whole food-retail branch in one rule: grocers, supermarkets,
   * butchers, cheese, bakeries-as-retail, wine, beer and liquor. Golden Day
   * 7 needs exactly this — the picnic supplies exist BECAUSE of the picnic —
   * and the day could not name a single shop to buy them at.
   *
   * Mapped but NON-ELECTABLE as an anchor (`NON_ANCHOR_CATEGORIES`): nobody
   * plans a day around a supermarket. It is also NOT a food category for the
   * pacing rules — a wine-shop stop is not a meal, and counting it as one
   * would trip `pacing.food-stops-exceeded` on a day that just bought bread.
   *
   * `markets` is declared BEFORE this and claims Farmers Market and Fish
   * Market off the same branch, which is the intended precedence: those are
   * experiences, the rest is shopping for food.
   */
  grocery: ["Retail > Food and Beverage Retail"],
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
