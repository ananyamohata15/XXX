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

export const TRANSPORT_MODES = ["walk", "cycle", "drive", "transit"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];
