/**
 * The Toronto discovery run plan (XXX-22, SESSION_NOTES Step 2.2).
 *
 * The GEOGRAPHY moved to `@/shared/districts` at Session 16 CP3, when a
 * district became something a traveller can name as a day's theme and the
 * client needed to read the same list. What stays here is everything about a
 * discovery RUN: which categories were searched, the query fragments, and the
 * parks radius floor. Where a district is, and what we once searched inside
 * it, are different questions with different owners.
 *
 * `Anchor` and `ANCHORS` are re-exported so every existing caller keeps
 * working and there is still exactly one list behind them.
 */

import { DISTRICTS, type District } from "@/shared/districts";

/** The discovery vocabulary's name for a district. One list, two words. */
export type Anchor = District;
export const ANCHORS: readonly Anchor[] = DISTRICTS;

export interface Category {
  key: string;
  /** Query fragment; cells search `${query} in ${anchor label}, Toronto`. */
  query: string;
}


export interface RunCell {
  category: string;
  anchor: string;
  textQuery: string;
  locationBias: {
    circle: { center: { latitude: number; longitude: number }; radius: number };
  };
}

export const CATEGORIES: readonly Category[] = [
  { key: "restaurants", query: "restaurants" },
  { key: "cafes", query: "cafes" },
  { key: "museums_galleries", query: "museums and art galleries" },
  { key: "historic_sites", query: "historic sites and landmarks" },
  { key: "markets", query: "markets" },
  { key: "nightlife_bars", query: "bars and live music venues" },
  { key: "parks", query: "parks and gardens" },
] as const;

/** Parks need reach: green space clusters away from commercial anchors. */
const PARKS_MIN_RADIUS_M = 2000;

export function buildRunPlan(): RunCell[] {
  return CATEGORIES.flatMap((category) =>
    ANCHORS.map((anchor) => ({
      category: category.key,
      anchor: anchor.slug,
      textQuery: `${category.query} in ${anchor.label}, Toronto`,
      locationBias: {
        circle: {
          center: { latitude: anchor.lat, longitude: anchor.lng },
          radius:
            category.key === "parks"
              ? Math.max(anchor.radiusM, PARKS_MIN_RADIUS_M)
              : anchor.radiusM,
        },
      },
    })),
  );
}
