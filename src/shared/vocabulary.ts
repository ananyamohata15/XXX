/**
 * E1 vocabulary — the single home for domain constant sets (XXX-18).
 *
 * src/shared/ holds dependency-light vocabulary, view-model types, and pure
 * functions usable from both client and server. Import rule: server and
 * client may import shared; shared imports nothing from src/server/** or
 * src/app/** — ever. The server Zod boundary (src/server/domain/schemas.ts)
 * builds its enums from these constants; neither side redeclares them.
 */

export const CITIES = ["toronto", "london", "new_delhi"] as const;
export type City = (typeof CITIES)[number];

/** Display names for cities — UI vocabulary, owned here once. */
export const CITY_LABELS: Record<City, string> = {
  toronto: "Toronto",
  london: "London",
  new_delhi: "New Delhi",
};

/**
 * City reference geometry — founder-set civic reference points (Toronto:
 * City Hall) and IANA timezones. OUR vocabulary: hand-set like Session 4's
 * anchors, never geocoded via Google (Geocoding output is 30-day-capped
 * content). Weather fetches and ephemeris computation key off these.
 */
export const CITY_GEO: Record<
  City,
  { lat: number; lng: number; timezone: string }
> = {
  toronto: { lat: 43.6532, lng: -79.3832, timezone: "America/Toronto" },
  london: { lat: 51.5074, lng: -0.1278, timezone: "Europe/London" },
  new_delhi: { lat: 28.6139, lng: 77.209, timezone: "Asia/Kolkata" },
};

/** Provenance tiers: 1 Verified / 2 Observed / 3 Judgment. */
export const TIERS = { verified: 1, observed: 2, judgment: 3 } as const;
export type Tier = (typeof TIERS)[keyof typeof TIERS];
export const TIER_VALUES = [1, 2, 3] as const satisfies readonly Tier[];

/** Display names for tier badges — UI vocabulary, owned here once. */
export const TIER_LABELS: Record<Tier, string> = {
  1: "Verified",
  2: "Observed",
  3: "Judgment",
};

/**
 * Honest absence: "absent" means we looked and it is not published — a
 * distinct state from never-fetched (which is no fact at all).
 */
export const FACT_STATUSES = ["present", "absent"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

/**
 * The product's category vocabulary — v2, ten categories (XXX-37).
 *
 * Deliberately small is still the rule; it was also too small. Session 11
 * found traveller identities the seven could not express, one of which is in
 * the taste interview's own interest grid: a persona could declare "likes to
 * shop" and the pool structurally could not serve it, because Session 5's
 * mapping dropped the entire FSQ Retail branch. Yorkville, Eaton Centre,
 * Yorkdale and Sherway were unelectable. So were CN Tower and every sunset
 * lookout.
 *
 * ORDER IS LOAD-BEARING. `matchBreadcrumb` takes the first category whose
 * breadcrumb rules match, and `mapped` is emitted in this declaration order.
 * `markets` therefore precedes `grocery` on purpose: a farmers market is an
 * experience, and it must win over the food-retail branch that also contains
 * it.
 */
export const PLACE_CATEGORIES = [
  "restaurants",
  "cafes",
  "museums_galleries",
  "historic_sites",
  "markets",
  "nightlife_bars",
  "parks",
  "shopping",
  "scenic_viewpoints",
  "grocery",
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

/**
 * Categories that may never be a day's CENTREPIECE (XXX-37).
 *
 * Distinct from the food categories the pacing rules count. `grocery` is not
 * a meal — counting it as one would make a wine-shop stop trip
 * `pacing.food-stops-exceeded` — but nobody plans a day around a
 * supermarket. It exists so XXX-38's provision role has a vocabulary to draw
 * on: the picnic supplies exist BECAUSE of the picnic, which makes it a
 * supporting stop by construction.
 *
 * `scenic_viewpoints` is deliberately NOT here. A roadside lookout is not a
 * centrepiece and CN Tower is; that is a CALIBRE question about the venue,
 * not a category question, and `anchor-calibre` is where it belongs.
 */
export const NON_ANCHOR_CATEGORIES: readonly PlaceCategory[] = ["grocery"];

/** Who placed a slot: the concierge proposed it, or the user pinned it. */
export const SLOT_ORIGINS = ["concierge", "user"] as const;
export type SlotOrigin = (typeof SLOT_ORIGINS)[number];

export const SLOT_KINDS = ["meal", "activity"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/**
 * What a stop is FOR in the day's arc (XXX-35 §1.1). Distinct from
 * `SlotKind` (what you do there) and from `SlotOrigin` (who put it there):
 * a role is the concierge's judgment about the day's shape, so it is
 * Tier 3 and only ever carried by concierge slots. `anchor` is the elected
 * centrepiece — the answer to the founder's "the day isnt anchored on
 * anything", recorded twice in the corpus.
 */
export const SLOT_ROLES = [
  "anchor",
  "warmup",
  "contrast",
  "close",
  "meal",
] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];

/**
 * Texture families. Anti-alternation is measured in FAMILIES rather than
 * categories because a traveller does not feel the difference between two
 * galleries and a gallery-then-historic-house: both read as "more of the
 * same". "meal, gallery, meal, gallery" and "Food Park Food Park" — the
 * founder's own two verdicts — are the same defect in this vocabulary.
 */
export const CATEGORY_FAMILIES = [
  "table",
  "culture",
  "outdoor",
  "market",
  "night",
] as const;
export type CategoryFamily = (typeof CATEGORY_FAMILIES)[number];

export const CATEGORY_FAMILY: Record<PlaceCategory, CategoryFamily> = {
  restaurants: "table",
  cafes: "table",
  museums_galleries: "culture",
  historic_sites: "culture",
  parks: "outdoor",
  markets: "market",
  nightlife_bars: "night",
  /**
   * `shopping` joins the MARKET family rather than getting its own (XXX-37).
   *
   * Families measure felt sameness, not taxonomy — that is the whole reason
   * they exist rather than anti-alternation running on categories. A day
   * that goes St. Lawrence Market → Eaton Centre has done the same thing
   * twice: browsing among stalls and shops, choosing, carrying. It reads the
   * way "meal, gallery, meal, gallery" reads.
   *
   * The counter-argument is real — a mall and a farmers market are not the
   * same experience — but the conservative direction is obvious. Grouping
   * them can only cost a day one repetition it might have gotten away with;
   * splitting them lets A-B-A-B back in through a door we just closed.
   */
  shopping: "market",
  /**
   * `scenic_viewpoints` joins OUTDOOR. A lookout and a park are both time
   * spent outside, weather-exposed and daylight-bound, and the exposure and
   * dusk rules already treat them alike. A separate family would claim a
   * traveller feels a park and a waterfront lookout as different textures,
   * which is not defensible.
   */
  scenic_viewpoints: "outdoor",
  /**
   * `grocery` joins MARKET as the nearest honest home. It is really an
   * errand rather than a texture, and the anti-alternation rules should
   * treat a provisioning stop as market-ish rather than invent a family for
   * something that is never a day's texture.
   */
  grocery: "market",
};

/**
 * Is a stop of this category spent OUTSIDE? — the single owner of the
 * question (XXX-40, Session 14 CP0; the fifth load-bearing constant).
 *
 * Four places need this answer and they used to derive it two different
 * ways. `buildMenus` clamps an outdoor intent's window to dusk and asks the
 * FAMILY (Session 13 fixed it to, having found it asking `c === "parks"`).
 * `retrieveCandidates` sets `PlaceTags.outdoor`, which is what `composeDay`'s
 * own dusk clamp and every daylight and weather rule read — and it was still
 * asking `category === "parks"`.
 *
 * So `scenic_viewpoints`, added to the outdoor FAMILY in Session 13 on the
 * stated grounds that *"the exposure and dusk rules already treat them
 * alike"*, arrived in every retrieved day with `outdoor: false`. It was
 * invisible to `daylight.outdoor-after-dark`, to
 * `daylight.outdoor-in-twilight`, and to every `weather.*` rule. A lookout
 * could be seated in the dark and the validator had nothing to say about it.
 *
 * The Session 13 fix was written as *"the two changes are one change"* — the
 * menu clamp and the evening list. There was a third half: a family a
 * category BELONGS to, and a tag a retrieved place CARRIES, must not be able
 * to disagree. One function, so they cannot.
 *
 * Golden Day 7 is why this is not a rider. Its closing beat is a sunset from
 * a west-facing beach — the one day in the set whose entire point is an
 * outdoor slot timed against the ephemeris.
 */
export function isOutdoorCategory(category: PlaceCategory): boolean {
  return CATEGORY_FAMILY[category] === "outdoor";
}

export const TRANSPORT_MODES = ["walk", "cycle", "drive", "transit"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/**
 * Weekdays, indexed to match `Date.prototype.getUTCDay()` so
 * `weekdayOf()` is a lookup rather than arithmetic. Hours facts are
 * per-weekday structures (XXX-5 trap class 2) — never a single string.
 */
export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Weekday of a "YYYY-MM-DD" calendar date. Parsed as UTC midnight so the
 * answer never depends on the machine's timezone — a city-local calendar
 * date names the same weekday everywhere.
 */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}
