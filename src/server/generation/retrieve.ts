/**
 * Retrieval — candidate pull from the base-layer pool (CP1 §1.1 stage 1).
 *
 * Query shape (per category, run concurrently): `places` rows for the
 * city joined through the `categories` fact, bounded by the day-zone
 * bbox, deterministic `fsq_place_id` order, capped per category. The cap
 * is a coverage trade recorded honestly: within a zone bbox it favors a
 * stable arbitrary subset over an unbounded scan; determinism (same
 * request → same candidates) is worth more to this engine than tail
 * coverage, and the cap is generous relative to shortlist size.
 *
 * Zone vocabulary is Session 4's nine hand-set neighborhood anchors. A
 * candidate's `neighborhood` label is the nearest zone anchor measured
 * from FSQ coordinates — our Apache-licensed data, not Google's, so the
 * point-in-polygon prohibition (001 §3.2.3(c)(iv)) is not in play.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineKm } from "@/shared/day-grammar/travel";
import type { GrammarFact, LatLng } from "@/shared/day-grammar/types";
import type { Lens } from "@/shared/persona";
import { isOutdoorCategory, type PlaceCategory } from "@/shared/vocabulary";
import { weightedOrderBy } from "@/shared/dice";
import { ANCHORS, type Anchor } from "../discovery/plan";
import { COMPOSE_PARAMS } from "./compose-params";
import type { Candidate } from "./types";

const PER_CATEGORY_CAP = 400;
/** How far past a zone anchor's own radius a candidate may sit. */
const ZONE_SLACK_KM = 1.0;

/**
 * The smallest zone set a day is still composed from. Below this the bbox
 * stops holding enough venues to seat a full arc — found by losing a close
 * (XXX-35, Session 12 CP2).
 */
const MIN_ZONES_FOR_A_DAY = 4;

const ICON_ZONES = new Set([
  "downtown_core",
  "st_lawrence",
  "distillery",
  "waterfront",
  "yorkville",
]);
const CORNER_ZONES = new Set([
  "kensington_chinatown",
  "queen_west_ossington",
  "annex",
  "leslieville",
]);

/**
 * The zone anchors a day draws from — lens-driven, anchor-overridden, and
 * (Session 12) diced WITHIN the lens's bucket.
 *
 * The lens still decides which bucket: an icons persona never draws a corners
 * zone. What the dice decides is the day's EMPHASIS inside it, because
 * keying zone choice on `lens` alone meant every icons persona on every date
 * searched the same five neighbourhoods — a variety ceiling upstream of every
 * selector below it.
 *
 * Cost-neutral by construction, not by discipline: zone choice only sets the
 * bbox, and `retrieveCandidates` issues one query per CATEGORY regardless of
 * how wide that box is. Passing no `dice` keeps the full bucket, which is
 * what a user-anchored day and the fixture tests want.
 */
export function zonesFor(
  lens: Lens,
  anchorCoords: LatLng[],
  dice?: () => number,
): Anchor[] {
  if (anchorCoords.length > 0) {
    // A committed day is a geographic fact: draw from every zone within
    // reach of any user anchor, whatever the lens says.
    return ANCHORS.filter((zone) =>
      anchorCoords.some(
        (a) => haversineKm(a, { lat: zone.lat, lng: zone.lng }) <= 3.0,
      ),
    );
  }
  const bucket =
    lens === "icons"
      ? ANCHORS.filter((z) => ICON_ZONES.has(z.slug))
      : lens === "corners"
        ? ANCHORS.filter((z) => CORNER_ZONES.has(z.slug))
        : [...ANCHORS];
  if (dice === undefined) return bucket;

  // Every zone in the bucket is equally on-lens, so this is a flat draw
  // rather than a weighted one — dressing it as weighted would be false
  // precision.
  //
  // Exactly ONE zone is dropped, and only from a bucket that can spare it.
  // The first cut took a fraction of the bucket, which read fine against the
  // 5-zone `icons` list and quietly broke `corners`: at 4 zones it dropped a
  // quarter of the day's geography, and `day-4-budget` lost its close because
  // the bars that could seat it lived in the dropped zone. Measured, not
  // reasoned — restoring the full bucket restored the close.
  //
  // The trade is stated rather than hidden: a `corners` persona gets no zone
  // variety at all. Its distinctiveness comes from the category dice and the
  // pool-window rotation instead, and a day that cannot be composed is worth
  // less than a day that searched the same four neighbourhoods as its twin.
  if (bucket.length <= MIN_ZONES_FOR_A_DAY) return bucket;
  const keep = bucket.length - 1;
  const drawn = weightedOrderBy(
    bucket,
    () => 0,
    dice,
    COMPOSE_PARAMS.dice.zone,
  ).slice(0, keep);
  // Restored to the canonical ANCHORS order so the bbox and every downstream
  // `nearestZone` read the same list regardless of what the dice returned.
  return ANCHORS.filter((z) => drawn.includes(z));
}

/**
 * The stable orderings a pool page may be taken in.
 *
 * `.order(fsq_place_id).limit(400)` returned the SAME 400 rows for every
 * persona on every run — a fixed slice of a pool that is often far larger, so
 * the tail was structurally unreachable no matter how well the dice below it
 * worked. Rotating the order key gives eight deterministic windows at
 * identical cost: same query count, same volume, different 400 rows.
 *
 * Labelled honestly, per the CP1 ruling: this is ROTATION, not uniform
 * coverage. Eight reachable slices is eight, not a sample. The real fix is
 * the pre-fetch popularity signal XXX-31 owes the pool, and it is explicitly
 * not this ticket.
 */
export const POOL_WINDOWS: readonly { column: string; ascending: boolean }[] = [
  { column: "fsq_place_id", ascending: true },
  { column: "fsq_place_id", ascending: false },
  { column: "id", ascending: true },
  { column: "id", ascending: false },
  { column: "lat", ascending: true },
  { column: "lat", ascending: false },
  { column: "lng", ascending: true },
  { column: "lng", ascending: false },
];

function bboxOf(zones: Anchor[]): {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
} {
  const kmPerDegLat = 110.574;
  let latMin = 90;
  let latMax = -90;
  let lngMin = 180;
  let lngMax = -180;
  for (const z of zones) {
    const reachKm = z.radiusM / 1000 + ZONE_SLACK_KM;
    const dLat = reachKm / kmPerDegLat;
    const dLng = reachKm / (111.32 * Math.cos((z.lat * Math.PI) / 180));
    latMin = Math.min(latMin, z.lat - dLat);
    latMax = Math.max(latMax, z.lat + dLat);
    lngMin = Math.min(lngMin, z.lng - dLng);
    lngMax = Math.max(lngMax, z.lng + dLng);
  }
  return { latMin, latMax, lngMin, lngMax };
}

interface PoolRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  google_place_id: string | null;
  fsq_place_id: string | null;
  source: string;
  tier: number;
  fetched_at: string;
}

function nearestZone(zones: Anchor[], coords: LatLng): Anchor | null {
  let best: Anchor | null = null;
  let bestKm = Infinity;
  for (const z of zones) {
    const km = haversineKm(coords, { lat: z.lat, lng: z.lng });
    if (km < bestKm) {
      best = z;
      bestKm = km;
    }
  }
  return best !== null && bestKm <= best.radiusM / 1000 + ZONE_SLACK_KM
    ? best
    : null;
}

export async function retrieveCandidates(
  client: SupabaseClient,
  city: string,
  categories: PlaceCategory[],
  zones: Anchor[],
  /**
   * Picks which of `POOL_WINDOWS` this request pages by. Omit for the
   * canonical `fsq_place_id` ascending window — what the fixtures and any
   * caller wanting the historical slice should use.
   */
  window?: (category: PlaceCategory) => number,
): Promise<Candidate[]> {
  const box = bboxOf(zones);

  const perCategory = await Promise.all(
    categories.map(async (category) => {
      const order =
        POOL_WINDOWS[
          window === undefined ? 0 : window(category) % POOL_WINDOWS.length
        ];
      const { data, error } = await client
        .from("places")
        .select(
          "id, name, lat, lng, google_place_id, fsq_place_id, source, tier, fetched_at, facts!inner(fact_key, value)",
        )
        .eq("city", city)
        .eq("source", "fsq_os_places")
        .eq("facts.fact_key", "categories")
        .filter("facts.value->mapped", "cs", JSON.stringify([category]))
        .gte("lat", box.latMin)
        .lte("lat", box.latMax)
        .gte("lng", box.lngMin)
        .lte("lng", box.lngMax)
        .order(order.column, { ascending: order.ascending })
        .limit(PER_CATEGORY_CAP);
      if (error) {
        throw new Error(`candidate retrieval failed: ${error.message}`);
      }
      return { category, rows: (data ?? []) as unknown as PoolRow[] };
    }),
  );

  const candidates: Candidate[] = [];
  for (const { category, rows } of perCategory) {
    for (const row of rows) {
      const coords = { lat: row.lat, lng: row.lng };
      const zone = nearestZone(zones, coords);
      if (zone === null) continue; // inside the bbox but outside every circle
      const categoryFact: GrammarFact<PlaceCategory> = {
        status: "present",
        value: category,
        source: row.source,
        tier: 2,
        fetchedAt: row.fetched_at,
      };
      candidates.push({
        place: {
          id: row.id,
          name: row.name,
          neighborhood: zone.label,
          coords,
          /**
           * `outdoor` derives from the FAMILY, never from a category literal
           * (XXX-40, Session 14 CP0). It read `category === "parks"` — true
           * when `parks` was the only outdoor category, wrong the moment
           * `scenic_viewpoints` joined the family in Session 13, and silent
           * about it because a `false` here does not fail anything: it just
           * removes the place from every daylight and weather rule's sight.
           */
          tags: {
            outdoor: isOutdoorCategory(category),
            goldenHourAffine: false,
            highCrowd: false,
          },
          category: categoryFact,
        },
        category,
        googlePlaceId: row.google_place_id,
        rating: null,
        userRatingCount: null,
        detailsFetched: false,
        score: 0,
      });
    }
  }
  return candidates;
}
