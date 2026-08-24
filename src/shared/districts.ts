/**
 * Toronto's districts — the single owner of WHERE a neighbourhood is
 * (XXX-22 originally; moved into `shared/` at XXX-47, Session 16 CP3).
 *
 * These nine circles are hand-set founder knowledge. Deliberately not
 * geocoded via Google (Geocoding output carries its own 30-day cap) and never
 * used for point-in-polygon against returned coordinates (ToS §3.2.3(c)(iv)).
 * A place's neighbourhood label is the anchor we SEARCHED, not a computation
 * over where Google says it sits.
 *
 * WHY IT MOVED OUT OF `server/discovery/plan.ts`. Session 16 made a district a
 * thing a traveller can NAME — *"a day in Yorkville"* is a day theme now — so
 * the client offers these and the engine retrieves against them. `src/shared`
 * is exactly what that calls for: dependency-free vocabulary usable by both
 * sides, no I/O, no React.
 *
 * The alternative was a second list of slugs in `theme.ts` for the client to
 * read, with the coordinates staying here. That is twin drift with the ink
 * still wet: two places answering *"which districts exist"* and free to
 * disagree the moment one gains a tenth. There is one list, and the day theme
 * points at it.
 *
 * `plan.ts` keeps everything that is about a discovery RUN — the categories,
 * the query fragments, the parks radius floor — and imports the geography
 * from here. Where a district is, and what we once searched inside it, are
 * different questions.
 */

export interface District {
  slug: string;
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export const DISTRICTS: readonly District[] = [
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

/** Every district slug, as a closed vocabulary the type system can police. */
export const DISTRICT_SLUGS = DISTRICTS.map((d) => d.slug);

export function districtBySlug(slug: string): District | null {
  return DISTRICTS.find((d) => d.slug === slug) ?? null;
}

/**
 * How a district is written for a person — the label, never the slug.
 *
 * Unknown returns the slug rather than throwing: a display helper that can
 * fail a render is a worse failure than a slug on screen, and the callers
 * that must not accept an unknown slug validate it with `districtBySlug`.
 */
export function districtLabel(slug: string): string {
  return districtBySlug(slug)?.label ?? slug;
}
