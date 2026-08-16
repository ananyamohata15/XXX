/**
 * GRAMMAR_PARAMS v1 (XXX-5) — every tunable the day-grammar validator
 * has, in one versioned object. Same pattern and same reasoning as
 * WINDOW_PARAMS in ../scheduling-windows.ts: these are judgment values
 * under active tuning, so they are named, versioned and kept out of the
 * rule bodies. A violation is only ever as good as the number behind it.
 *
 * Unless a row says otherwise every number here is TIER 3 — judgment, not
 * fact. The two exceptions are marked inline: they are founder-verified
 * figures lifted from the golden set.
 *
 * Ratified at Session 7 CHECKPOINT 1.
 */

import type { PlaceCategory, TransportMode } from "../vocabulary";
import type { MealPatternId, OpenInterval } from "./types";

/** Minutes. `typical` is used in messages and by the breather rule only. */
export interface DwellRange {
  min: number;
  typical: number;
  max: number;
}

/**
 * A straight-line travel profile. `detourFactor` converts great-circle
 * distance to plausible path length; `speedKmh` is the effective speed
 * along that path.
 */
export interface TravelProfile {
  speedKmh: number;
  detourFactor: number;
}

export interface ModeFactors {
  urban: TravelProfile;
  /** Fixed cost at the ends: waiting, locking up, parking. Minutes. */
  overheadMinutes: number;
  /**
   * Long legs are not slow city legs (Toronto → Beamsville is not the
   * Kensington walk at scale). Only `drive` has one — walk, cycle and
   * transit do not make interurban trips in this product.
   */
  interurban?: TravelProfile & { thresholdKm: number };
}

export interface MealWindow extends OpenInterval {
  label: string;
}

export interface MealPatternSpec {
  windows: MealWindow[];
  maxFoodStops: number;
}

export const GRAMMAR_PARAMS = {
  /**
   * v2 (XXX-35, Session 11 CP1): adds `pacing.foodCategories` (the
   * food-cap predicate now counts food-category VENUES, not slot kinds)
   * and the `exposure` band table (the first rules that read a travel LEG
   * rather than a slot). `grazing` left the meal patterns in the same
   * change — see SESSION_NOTES §1.3.
   */
  version: "v3",

  /**
   * Plausible time in a place, by category. Applied ONLY to
   * origin='concierge' slots: the user owns their own commitments and we
   * do not tell them their booking is the wrong length (single-owner-
   * per-fact).
   *
   * Anchored on the golden set: cafes on Day 1's 45-minute FIKA; museums
   * on Day 3's 150-minute ROM ("winter museums earn 2.5h"); markets on
   * Day 2's 105-minute St. Lawrence; parks on Day 4's 150-minute
   * Bellwoods amble, which sits exactly at max. historic_sites max is 120
   * on the strength of Day 2's own "(2h dwell ceiling)" and Session 3's
   * "the Distillery is a 90–120 minute experience" — the ceiling that
   * caught golden-set lesson #1, the six-hour Distillery.
   */
  dwellMinutes: {
    cafes: { min: 20, typical: 45, max: 90 },
    restaurants: { min: 45, typical: 90, max: 150 },
    museums_galleries: { min: 45, typical: 120, max: 210 },
    historic_sites: { min: 30, typical: 90, max: 120 },
    markets: { min: 30, typical: 75, max: 150 },
    parks: { min: 20, typical: 60, max: 150 },
    nightlife_bars: { min: 45, typical: 90, max: 180 },
    /**
     * Vocabulary v2 dwells (XXX-37) — all TIER 3 judgment, all new, and all
     * owed the founder's eye. Each is argued rather than assumed.
     *
     * `shopping` 30/75/180. A mall or a shopping district is a browse, and
     * the browse IS the stop — Eaton Centre in half an hour is a transit
     * connection, not a visit. 180 lets a genuine shopping afternoon exist;
     * 30 is the floor below which you did not really go.
     */
    shopping: { min: 30, typical: 75, max: 180 },
    /**
     * `scenic_viewpoints` 15/40/90. You arrive, you look, you photograph,
     * you leave — a lookout is the shortest honest stop in the vocabulary,
     * and 15 minutes at one is a real visit rather than a degradation.
     *
     * The MAX is the load-bearing number here, not the typical. It is 90 so
     * that `anchorDwellFor` can clamp a scenic anchor up to the 75-minute
     * calibre floor: a scenic-leaning persona must be able to have a day
     * centred on a view. CN Tower is a 75-minute centrepiece; a roadside
     * lookout is not, and telling those apart is `anchor-calibre`'s job, not
     * this range's. Had the max been 60 — the number a lookout suggests —
     * every scenic-first day would have degraded its own centre, which is
     * precisely the trap `parks.typical` = 60 set for nature-first days.
     */
    scenic_viewpoints: { min: 15, typical: 40, max: 90 },
    /**
     * `grocery` 10/25/45. A provisioning stop is an errand with a purpose:
     * long enough to pick up a picnic and a bottle of wine, short enough
     * that it never reads as an activity. Never an anchor
     * (`NON_ANCHOR_CATEGORIES`), so no calibre floor applies to it.
     */
    grocery: { min: 10, typical: 25, max: 45 },
  } satisfies Record<PlaceCategory, DwellRange>,

  /**
   * Meal grammar is patterns, not fixed slots (XXX-5 comment 10290): 8:30
   * does not mean breakfast. The pattern is an INPUT — the taste profile
   * selects it, the grammar validates against it.
   */
  mealPatterns: {
    classic: {
      windows: [
        { label: "breakfast", open: "07:00", close: "11:00" },
        { label: "lunch", open: "11:30", close: "14:30" },
        { label: "dinner", open: "17:30", close: "21:30" },
      ],
      maxFoodStops: 4,
    },
    coffee_then_brunch: {
      windows: [
        { label: "coffee", open: "07:00", close: "11:00" },
        { label: "brunch", open: "10:00", close: "14:00" },
        { label: "dinner", open: "17:30", close: "21:30" },
      ],
      maxFoodStops: 4,
    },
  } satisfies Record<MealPatternId, MealPatternSpec>,

  /**
   * XXX-27's meal compression: when a user anchor overlaps a pattern
   * window, the time it took is offered back immediately after it, capped
   * here so a swallowed lunch cannot creep into the evening. Golden Day 1
   * needs this — the 18:30–22:00 game eats the dinner window whole, and
   * the founder's own 22:30 late bite depends on getting it back.
   */
  mealDisplacementMaxMinutes: 120,

  /**
   * Categories with a known-poor window despite being open — hours
   * compliance is not hours wisdom (golden Day 2: "morning = peak
   * vendors; afternoon = picked over"). Advisory only. Markets is the
   * only v1 entry; the shape holds more when a founder verifies one.
   */
  offPeakAfter: {
    markets: "14:00",
  } as Partial<Record<PlaceCategory, string>>,

  travel: {
    /**
     * Straight-line stub factors. Deliberately READ LONG so a false pass
     * is less likely than a false flag — a flagged day gets adjudicated,
     * a passed bad day ships. Calibration against founder-stated legs:
     * Kensington→Graffiti Alley (founder "~12 min walk") → stub 16;
     * St. Lawrence→Distillery (founder "504 ~12") → stub 18.
     */
    modeFactors: {
      walk: { urban: { speedKmh: 4.8, detourFactor: 1.3 }, overheadMinutes: 2 },
      cycle: { urban: { speedKmh: 15, detourFactor: 1.3 }, overheadMinutes: 5 },
      drive: {
        urban: { speedKmh: 24, detourFactor: 1.35 },
        overheadMinutes: 8,
        interurban: { speedKmh: 90, detourFactor: 1.15, thresholdKm: 15 },
      },
      transit: {
        urban: { speedKmh: 16, detourFactor: 1.4 },
        overheadMinutes: 10,
      },
    } satisfies Record<TransportMode, ModeFactors>,

    /**
     * Below this, two slots are the same place in practice — two stalls
     * in Kensington Market, a bar next door to its own patio. Estimating
     * a walk here would manufacture violations out of nothing.
     */
    negligibleDistanceKm: 0.15,

    /**
     * How late an arrival may be before it is a violation, by the tier of
     * the estimate that produced it. THIS is what makes provenance
     * load-bearing rather than decorative: the stub is Tier 3 and earns a
     * 10-minute benefit of the doubt, so a tier-3 guess never hard-rejects
     * a founder-verified day. When XXX-24's Tier-1 provider drops in,
     * tolerance goes to zero and the same day starts failing on the same
     * edge — with no rule change.
     */
    toleranceMinutesByTier: { 1: 0, 2: 5, 3: 10 } as Record<number, number>,
  },

  anchors: {
    /**
     * Travel safety margin before a user commitment. Flat, and NOT raised
     * for crowd-flagged anchors: the ingress lead time is already in the
     * anchor's own start time — golden Day 1's anchor begins 18:30 for a
     * 19:07 first pitch, which is the founder's "arrive 30 early". Adding
     * a crowd buffer on top would double-count the user's own judgment,
     * which single-owner-per-fact forbids. Crowd flags drive EGRESS.
     */
    arrivalBufferMinutes: 15,
    /**
     * Getting out of a stadium. Founder-verified shape: golden Day 1
     * leaves 22:00–22:30 deliberately empty and calls it "egress crush".
     */
    crowdEgressBufferMinutes: 30,
  },

  pacing: {
    /** Minimum air between two at-or-above-typical-dwell stops. */
    breatherMinutes: 20,
    /** Longer than this between food stops earns an advisory. */
    maxFoodGapMinutes: 300,
    /**
     * What counts as a FOOD STOP for the pattern's ceiling — by the
     * venue's category, not by the slot's kind (XXX-35 comment 10299
     * item 3). The Session-10 defect: a `restaurants` venue seated as an
     * evening activity (Scotland Yard Pub, off the nightlife menu) was
     * invisible to the rule whose whole job is bounding food stops.
     *
     * `markets` is a place you walk through and `nightlife_bars` is a
     * drink; neither is definitionally a meal, so both are excluded ON
     * PURPOSE rather than by oversight. The founder's own fourth stop is
     * categorised `restaurants` in our pool, so it is caught.
     */
    foodCategories: ["restaurants", "cafes"] as readonly PlaceCategory[],
    /**
     * An ending that lands (XXX-35 §1.1): a day whose last stop is a
     * table after a gap this long reads as giving up rather than as a
     * finale. The founder's second day ended "2hrs free → meal".
     * ADVISORY only — "dinner last" is usually right, and a violation
     * here would threaten loop termination on thin evenings.
     */
    endingGapMinutes: 60,
    /**
     * How many distinct texture families a day needs before an A-B-A-B run
     * inside it stops reading as monotony.
     *
     * THREE, and the number was corrected by the golden set rather than
     * chosen: the rule as ratified at CP1 was "an A-B-A-B run is a
     * violation", and it immediately rejected golden **day-2-old-town** —
     * table · market · culture · table · culture · table — which the
     * founder authored and verified. Measured across the whole set:
     *
     *   day-1  5 families / 8 stops   no run
     *   day-2  3 / 6                  HAS a run   ← founder-approved
     *   day-3  3 / 6                  no run
     *   day-4  3 / 7                  no run
     *   day-5  2 / 3                  no run (A-B-A is a sandwich, not a rhythm)
     *   day-6  3 / 5                  no run
     *
     * And the two shapes the founder REJECTED in the tasting room:
     *
     *   "meal gallery meal gallery meal"   2 families   HAS a run
     *   "Food Park Food Park Food Food"    2 families   HAS a run
     *
     * So the discriminator is not the run — it is the run in a day that
     * has nothing else in it. A third texture somewhere earns the
     * tolerance; two families alternating is the complaint.
     */
    minTextureFamilies: 3,
    /**
     * A wanderer's day must be mostly unscheduled — golden Day 5: "A
     * fully-scheduled output for this persona is a FAILURE."
     */
    wandererMinUnstructuredFraction: 0.35,
  },

  structure: {
    /** A gap this long reads as a hotel reset — only valid near lodging. */
    resetGapMinutes: 90,
    /** A day still running at this hour has a late-night tail. */
    lateNightTail: "23:30",
  },

  /**
   * XXX-29's stated threshold (">20 min or >25% of total travel — tune
   * later"). v1 takes the absolute half only; the percentage arm arrives
   * with the optimizer that needs it.
   */
  route: { detourThresholdMinutes: 20 },

  /**
   * Leg exposure (XXX-35 item 1) — the first rules in this file that read
   * a travel LEG rather than a slot. Every weather and daylight rule
   * before this one checked slot spans, so a 35-minute walk at -8 °C
   * between two indoor venues passed everything. It is the founder's
   * "Winter days with 30+ mins of walking is illogical", as a number.
   *
   * These bands are the GRAMMAR's judgment, deliberately NOT
   * WINDOW_PARAMS': that file classifies an HOUR ("is this a bad hour to
   * stand outdoors"), this one bounds a WALK. One number cannot answer
   * two questions. `WINDOW_PARAMS.coldApparentC` (-12) is untouched by
   * this session's ruling — see SESSION_NOTES §1.4 for the blast radius
   * if it ever moves.
   *
   * All Tier 3, all founder-calibrated at CP3 from felt experience. The
   * -2 °C row is the one that answers the recorded complaint: -8 °C lands
   * in it, capping the walk at 20 minutes.
   */
  exposure: {
    /** A pleasant day has no effective cap; 45 minutes is a long walk anyway. */
    baseWalkCapMinutes: 45,
    /**
     * RECALIBRATED by golden day-3 (Session 11 Step 2), and the correction
     * is worth keeping: the caps ruled at CP1 were 10 min at ≤-10 °C and
     * 20 min at ≤-2 °C, and the ≤-10 row **flagged the founder's own
     * winter day** — Nathan Phillips Square rink to the PATH is a
     * ~16-minute walk at -10 °C apparent, authored and verified by the
     * founder as a good day.
     *
     * So the fixture set the floor and the corpus set the ceiling:
     *   16 min at -10 °C must PASS  (golden day-3, founder-authored)
     *   35 min at  -8 °C must FAIL  ("Winter days with 30+ mins of
     *                                 walking is illogical")
     * 20 / 25 satisfies both with headroom at each end.
     */
    cold: {
      severeApparentC: -10,
      severeCapMinutes: 20,
      briskApparentC: -2,
      briskCapMinutes: 25,
    },
    /**
     * UNCALIBRATED by any founder-authored day — Toronto's golden set has
     * no 32 °C afternoon in it. These are the CP1 numbers, and they are
     * the first thing Delhi will correct.
     */
    heat: {
      severeApparentC: 32,
      severeCapMinutes: 10,
      warmApparentC: 28,
      warmCapMinutes: 20,
    },
    /**
     * Delhi-ready from day one: AQI binds walks, not just outdoor slots.
     * Also uncalibrated — Toronto AQI never approaches these bands, so no
     * fixture exercises them and no founder has felt them.
     */
    air: {
      unhealthyUsAqi: 100,
      unhealthyCapMinutes: 15,
      severeUsAqi: 150,
      severeCapMinutes: 8,
    },
    precipitation: {
      probPct: 50,
      mm: 0.5,
      capMinutes: 15,
    },
  },

  budget: {
    /**
     * Toronto transit, founder-confirmed and recorded in XXX-5 comment
     * 10293. TIER 1 — a published fare, not a judgment.
     *
     * The real fare model is EVENTS, not rides: a single tap is $3.30
     * with a two-hour free-transfer window, so the day pass breaks even
     * around five events. v1 uses the day-pass figure because a day of
     * city-wide wandering clears breakeven; a per-city FareModel is the
     * v2 refinement, noted for E3 metadata.
     */
    transitDayPassCad: 13.5,
  },
} as const;

export type GrammarParams = typeof GRAMMAR_PARAMS;
