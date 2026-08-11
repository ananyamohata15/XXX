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

/** The product's category vocabulary — deliberately small (seven). */
export const PLACE_CATEGORIES = [
  "restaurants",
  "cafes",
  "museums_galleries",
  "historic_sites",
  "markets",
  "nightlife_bars",
  "parks",
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

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
};

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
