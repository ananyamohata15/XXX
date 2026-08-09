/**
 * Persona — the taste-profile stand-in (XXX-5 Session 9, CP1 §1.4).
 *
 * E6's learned taste profile does not exist yet; the engine cannot wait
 * for it. This object carries exactly the five interview dimensions
 * (XXX-16) the golden-set persona lines are written in, and the engine's
 * contract is this shape — when E6 lands, it derives a Persona from the
 * learned profile and `generateDay` does not change.
 *
 * Dependency-free on purpose (src/shared law): E5 and E6 both consume it.
 */

import type { PlaceCategory } from "./vocabulary";

/** The interests the golden-set persona lines actually use. */
export const INTEREST_TAGS = [
  "food",
  "local_life",
  "history",
  "art",
  "markets",
  "nature",
  "nightlife",
  "sports",
  "wine",
] as const;
export type InterestTag = (typeof INTEREST_TAGS)[number];

export const PACES = ["relaxed", "moderate", "packed"] as const;
export type Pace = (typeof PACES)[number];

export const FOOD_COURAGES = ["classic", "comfort", "adventurous"] as const;
export type FoodCourage = (typeof FOOD_COURAGES)[number];

export const LENSES = ["icons", "corners", "icons_with_corners"] as const;
export type Lens = (typeof LENSES)[number];

export interface Persona {
  pace: Pace;
  /** Gravity ordering — highest interest first. Positional weights apply. */
  gravity: InterestTag[];
  foodCourage: FoodCourage;
  /** Structure tolerance changes the SHAPE of the day (XXX-6 lineage). */
  structure: "scheduler" | "wanderer";
  lens: Lens;
}

/**
 * How much each gravity position weighs. "Materially reorder, not
 * decorate" (comment 10294): first interest dominates, the tail matters.
 */
export const GRAVITY_WEIGHTS = [1.0, 0.6, 0.35] as const;

/**
 * Interest → category affinity. Data, not judgment scattered through
 * scoring: one place to argue with. `sports` expresses mostly through
 * user anchors (a booked game is an anchor, not a category) — its
 * residual weight is deliberately small.
 */
export const INTEREST_CATEGORY_AFFINITY: Record<
  InterestTag,
  Partial<Record<PlaceCategory, number>>
> = {
  food: { restaurants: 1.0, markets: 0.5, cafes: 0.4 },
  local_life: { markets: 0.8, cafes: 0.6, parks: 0.5, nightlife_bars: 0.3 },
  history: { historic_sites: 1.0, museums_galleries: 0.6 },
  art: { museums_galleries: 1.0, historic_sites: 0.3 },
  markets: { markets: 1.0 },
  nature: { parks: 1.0 },
  nightlife: { nightlife_bars: 1.0 },
  sports: { parks: 0.3 },
  wine: { nightlife_bars: 0.6, restaurants: 0.4 },
};

/** Persona-weighted affinity for one category, in [0, ~1]. */
export function categoryAffinity(
  persona: Persona,
  category: PlaceCategory,
): number {
  let affinity = 0;
  persona.gravity.forEach((interest, i) => {
    const weight = GRAVITY_WEIGHTS[i] ?? 0;
    affinity = Math.max(
      affinity,
      weight * (INTEREST_CATEGORY_AFFINITY[interest][category] ?? 0),
    );
  });
  return affinity;
}

/**
 * The six golden persona lines as test instances (golden-set v2.2
 * headers, verbatim translation). These are the distinctiveness matrix's
 * six rows and the engine's exam personas.
 */
export const GOLDEN_PERSONAS: Record<string, Persona> = {
  "day-1-jays": {
    pace: "moderate",
    gravity: ["food", "local_life", "sports"],
    foodCourage: "adventurous",
    structure: "scheduler",
    lens: "corners",
  },
  "day-2-old-town": {
    pace: "packed",
    gravity: ["history", "food", "markets"],
    foodCourage: "classic",
    structure: "scheduler",
    lens: "icons",
  },
  "day-3-winter": {
    pace: "relaxed",
    gravity: ["art", "food", "history"],
    foodCourage: "comfort",
    structure: "scheduler",
    lens: "icons",
  },
  // The document says "wanderer-leaning"; its golden day is a full
  // timeline, so the binary lands on scheduler (recorded, not silent).
  "day-4-budget": {
    pace: "moderate",
    gravity: ["local_life", "art", "nature"],
    foodCourage: "adventurous",
    structure: "scheduler",
    lens: "corners",
  },
  "day-5-wanderer": {
    pace: "relaxed",
    gravity: ["food", "art", "nightlife"],
    foodCourage: "adventurous",
    structure: "wanderer",
    lens: "corners",
  },
  "day-6-excursion": {
    pace: "moderate",
    gravity: ["nature", "food", "wine"],
    foodCourage: "classic",
    structure: "scheduler",
    lens: "icons_with_corners",
  },
};
