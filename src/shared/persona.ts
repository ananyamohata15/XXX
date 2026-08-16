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
  /**
   * Vocabulary v2 (XXX-37). `shopping` was ALREADY in the taste interview's
   * five-question interest grid — a traveller could declare it and the pool
   * structurally could not serve it, because Session 5's mapping dropped the
   * whole Retail branch. This closes that gap rather than opening a new one.
   *
   * `views` is the founder's "likes scenic views", which had no interest tag
   * and no category to point at.
   */
  "shopping",
  "views",
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
  local_life: {
    markets: 0.8,
    cafes: 0.6,
    parks: 0.5,
    nightlife_bars: 0.3,
    // A neighbourhood's independent shops are local life; a mall is not,
    // and the lens is what separates them (corners pulls to the boutique).
    shopping: 0.4,
  },
  history: { historic_sites: 1.0, museums_galleries: 0.6 },
  art: { museums_galleries: 1.0, historic_sites: 0.3 },
  markets: { markets: 1.0, shopping: 0.5 },
  // A viewpoint is outdoor time with a reason. Secondary to parks, because
  // "likes nature" means green space first and a lookout second.
  nature: { parks: 1.0, scenic_viewpoints: 0.5 },
  nightlife: { nightlife_bars: 1.0 },
  sports: { parks: 0.3 },
  wine: { nightlife_bars: 0.6, restaurants: 0.4 },
  shopping: { shopping: 1.0, markets: 0.5 },
  /**
   * `views` leans hard on the new category and lightly on parks — a lookout
   * is usually IN a park in Toronto, so a views-first persona should still
   * reach the waterfront green space rather than only the towers.
   *
   * Deliberately NO affinity to `historic_sites` despite CN-Tower-shaped
   * landmarks often being filed there: that would be laundering a mapping
   * guess through the gravity table, and the mapping is where it belongs.
   */
  views: { scenic_viewpoints: 1.0, parks: 0.4 },
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
 * The engine's exam personas — the distinctiveness matrix's rows.
 *
 * **Two naming conventions, on purpose (XXX-40, Session 14 CP0 ruling 3).**
 *
 * `day-1-…` … `day-6-…` are translations of golden-set v2.2's own persona
 * lines, so they carry the golden day's number honestly: `day-3-winter` IS
 * the persona of Golden Day 3.
 *
 * `persona-…` entries have no golden day behind them. They were added in
 * Session 13 for vocabulary v2 and were originally called `day-7-shopper`
 * and `day-8-scenic` — which collided the moment the golden set gained its
 * own **Golden Day 7 (The Islands Day)** and was promised a Golden Day 8.
 * "Day 7" then meant two unrelated things in one codebase, and Session 14's
 * founder vet asks for the shopper day and the islands day in one sitting.
 *
 * Golden days are founder-verified documents of record with stable
 * identities; persona keys are code labels. So the labels moved.
 *
 * Every consumer derives its key list from this object (`PERSONA_KEYS` in
 * the tasting room, the generate route's Zod enum, every script), so the
 * rename needed no call-site edits. One consequence, stated rather than
 * discovered: a trace persisted under an OLD key no longer resolves — and
 * `seed-fidelity.ts` / `generation-report.ts` already fail loudly on an
 * unknown persona rather than guessing, which is the behaviour we want.
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
  /**
   * Vocabulary v2's two new lines (XXX-37), for the founder vet and the
   * widened distinctiveness matrix. Neither could exist before: `shopping`
   * and `views` had no interest tag and no category to elect.
   *
   * Neither has a golden day behind it, which is why neither is named for
   * one — see the module note above.
   *
   * `persona-shopper` is `icons` on purpose — the ticket's own examples are
   * Yorkville, Eaton Centre, Yorkdale and Sherway, which is the icons end of
   * the lens. A corners shopper is a different day (Queen West, Kensington)
   * and would be another line, not a variant of this one.
   */
  "persona-shopper": {
    pace: "moderate",
    gravity: ["shopping", "food", "local_life"],
    foodCourage: "comfort",
    structure: "scheduler",
    lens: "icons",
  },
  /**
   * `persona-scenic` leans on `views` first with nature behind it, which is
   * the founder's "likes scenic views" as a whole traveller rather than a
   * single stop. Relaxed, because a day built around looking at things is
   * not a packed day.
   */
  "persona-scenic": {
    pace: "relaxed",
    gravity: ["views", "nature", "food"],
    foodCourage: "classic",
    structure: "scheduler",
    lens: "icons_with_corners",
  },
};
