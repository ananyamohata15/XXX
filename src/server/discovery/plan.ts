/**
 * The Toronto discovery run plan (XXX-22, SESSION_NOTES Step 2.2).
 *
 * Anchor coordinates are hand-set founder knowledge — deliberately not
 * geocoded via Google (Geocoding output carries its own 30-day cap) and
 * never used for point-in-polygon against returned coordinates
 * (ToS §3.2.3(c)(iv)). A place's neighborhood label is the anchor we
 * SEARCHED, not a computation over where Google says it sits.
 */

export interface Category {
  key: string;
  /** Query fragment; cells search `${query} in ${anchor label}, Toronto`. */
  query: string;
}

export interface Anchor {
  slug: string;
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
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

export const ANCHORS: readonly Anchor[] = [
  { slug: "downtown_core", label: "Downtown", lat: 43.6517, lng: -79.3817, radiusM: 1200 },
  { slug: "distillery", label: "Distillery District", lat: 43.6503, lng: -79.3596, radiusM: 800 },
  { slug: "kensington_chinatown", label: "Kensington Market", lat: 43.6547, lng: -79.4005, radiusM: 900 },
  { slug: "queen_west_ossington", label: "Queen West", lat: 43.6448, lng: -79.42, radiusM: 1200 },
  { slug: "annex", label: "The Annex", lat: 43.6672, lng: -79.4036, radiusM: 1000 },
  { slug: "st_lawrence", label: "St. Lawrence Market", lat: 43.6487, lng: -79.3716, radiusM: 800 },
  { slug: "waterfront", label: "Harbourfront", lat: 43.6389, lng: -79.3817, radiusM: 1500 },
  { slug: "leslieville", label: "Leslieville", lat: 43.6626, lng: -79.3357, radiusM: 1200 },
  { slug: "yorkville", label: "Yorkville", lat: 43.6709, lng: -79.3933, radiusM: 800 },
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
