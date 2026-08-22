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
 * How far this traveller's first interest outranks everything unlike it.
 *
 * ONE mechanism with TWO clients (XXX-40, Session 14 CP1 ruling on the family
 * licence). Session 13 §5.4c left *"persona intensity as a licence"* open
 * after the founder's curation ruling — *"this happens only if someone is a
 * die hard museum fan"* — and Session 14 CP0 produced a second client from a
 * different direction. Designing one predicate for both is the ruling.
 *
 *   client 1 (built here): the day's CLOSE may share the ANCHOR's texture
 *     family. Today `demoteRatherThanDrop` pushes any category whose family
 *     the anchor already spent to the back of the close's list — which means
 *     a persona's single strongest interest is structurally barred from the
 *     day's ENDING. Measured at CP0: `persona-shopper`'s die put `shopping`
 *     first for the close and freshness demoted it to third, because the
 *     anchor was also `shopping`. The founder's own example is Yorkville by
 *     day and the Eaton Centre class in the evening.
 *
 *   client 2 (NOT built — the call site is named, not wired): a single
 *     museum, historic site or market may carry a day's anchor for a
 *     traveller of this intensity. It needs the composite/theme anchor to
 *     exist first, which is what Session 14 builds.
 *
 * The margin is measured against the best affinity in ANY OTHER TEXTURE
 * FAMILY, not simply the second-best category. Second-best-category would be
 * the wrong question: `markets` and `shopping` are one family, so a shopper's
 * two top categories are the same texture and the margin would read ~0 for
 * exactly the traveller the licence exists for.
 */
export interface GravityDominance {
  /** The dominant category, or null when nothing dominates. */
  category: PlaceCategory | null;
  /**
   * How many of the traveller's stated interests point INTO that category's
   * texture family. See below for why this replaced an affinity margin.
   */
  positionsInFamily: number;
  dominant: boolean;
}

/**
 * **Why this counts positions instead of measuring a margin.**
 *
 * CP1 proposed, and the PO ruled, "top-affinity margin over second, versioned
 * param" at 0.4. Built and measured across the eight exam personas, that
 * threshold is a KNIFE-EDGE sitting on the single most common value in the
 * lattice:
 *
 *     day-1-jays        margin 0.500
 *     day-2-old-town    margin 0.400   <-- exactly on it
 *     day-3-winter      margin 0.400   <-- exactly on it
 *     day-4-budget      margin 0.200
 *     day-5-wanderer    margin 0.400   <-- exactly on it
 *     day-6-excursion   margin 0.400   <-- exactly on it
 *     persona-shopper   margin 0.400   <-- exactly on it
 *     persona-scenic    margin 0.650
 *
 * Five of eight. The cause is structural, not coincidental:
 * `GRAVITY_WEIGHTS[1]` is **0.6** and most second interests map at full
 * strength into a different family, so the margin is 1.0 − 0.6 = 0.4 for
 * anyone ordinarily-shaped. At `>=` the licence fires for seven of eight
 * personas — which is not a licence, it is a repeal of family-freshness — and
 * at `>` it fires for two. The behaviour of the whole feature turned on one
 * character.
 *
 * That is Session 12's `night >= 0.35` defect exactly, and Session 12's
 * ruling was **delete the comparison, do not retune it**. So the question is
 * asked structurally instead: *how many of this traveller's three stated
 * interests point into one texture?* One means their day has other textures
 * in it. Two or more means they are concentrated, which is what "die hard
 * museum fan" and the founder's Yorkville-plus-Eaton-Centre shopper both
 * describe.
 *
 *     day-1-jays 1 · day-2-old-town 1 · day-3-winter 2 · day-4-budget 1
 *     day-5-wanderer 1 · day-6-excursion 1 · persona-shopper 2 · persona-scenic 2
 *
 * Three of eight, and the three are the concentrated travellers. An integer
 * over a domain of 0..3 cannot sit on a knife-edge.
 *
 * Recorded as a DEVIATION from the CP1 ruling, with the measurement that
 * forced it, rather than shipped quietly.
 */
export function gravityDominance(
  persona: Persona,
  categories: readonly PlaceCategory[],
  familyOf: (category: PlaceCategory) => string,
  /**
   * How many stated interests must point into one texture family before the
   * traveller counts as dominated by it.
   *
   * Passed in rather than imported: `COMPOSE_PARAMS` is the composer's
   * versioned judgment and lives under `src/server`, which `src/shared` may
   * never import. The caller supplies its own tunable and this stays pure.
   */
  minPositionsInFamily: number,
): GravityDominance {
  let best: PlaceCategory | null = null;
  let bestAffinity = -1;
  for (const category of categories) {
    const affinity = categoryAffinity(persona, category);
    if (affinity > bestAffinity) {
      bestAffinity = affinity;
      best = category;
    }
  }
  if (best === null || bestAffinity <= 0) {
    return { category: null, positionsInFamily: 0, dominant: false };
  }
  const bestFamily = familyOf(best);

  // One position may map to several categories; it counts once, for the
  // family its STRONGEST category sits in. Counting every category would
  // score a family by how many members it happens to have, which is a fact
  // about the vocabulary rather than about the traveller.
  let positionsInFamily = 0;
  for (const interest of persona.gravity) {
    let top: PlaceCategory | null = null;
    let topWeight = 0;
    for (const category of categories) {
      const weight = INTEREST_CATEGORY_AFFINITY[interest][category] ?? 0;
      if (weight > topWeight) {
        topWeight = weight;
        top = category;
      }
    }
    if (top !== null && familyOf(top) === bestFamily) positionsInFamily += 1;
  }

  return {
    category: best,
    positionsInFamily,
    dominant: positionsInFamily >= minPositionsInFamily,
  };
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
