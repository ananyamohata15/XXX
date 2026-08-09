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
import type { PlaceCategory } from "@/shared/vocabulary";
import { ANCHORS, type Anchor } from "../discovery/plan";
import type { Candidate } from "./types";

const PER_CATEGORY_CAP = 400;
/** How far past a zone anchor's own radius a candidate may sit. */
const ZONE_SLACK_KM = 1.0;

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

/** The zone anchors a day draws from — lens-driven, anchor-overridden. */
export function zonesFor(lens: Lens, anchorCoords: LatLng[]): Anchor[] {
  if (anchorCoords.length > 0) {
    // A committed day is a geographic fact: draw from every zone within
    // reach of any user anchor, whatever the lens says.
    return ANCHORS.filter((zone) =>
      anchorCoords.some(
        (a) => haversineKm(a, { lat: zone.lat, lng: zone.lng }) <= 3.0,
      ),
    );
  }
  if (lens === "icons") return ANCHORS.filter((z) => ICON_ZONES.has(z.slug));
  if (lens === "corners") return ANCHORS.filter((z) => CORNER_ZONES.has(z.slug));
  return [...ANCHORS];
}

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
): Promise<Candidate[]> {
  const box = bboxOf(zones);

  const perCategory = await Promise.all(
    categories.map(async (category) => {
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
        .order("fsq_place_id")
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
          tags: { outdoor: category === "parks", goldenHourAffine: false, highCrowd: false },
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
