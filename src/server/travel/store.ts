import type { SupabaseClient } from "@supabase/supabase-js";
import { MatrixTravelProvider } from "@/shared/day-grammar/travel";
import type { LatLng, TravelEstimate } from "@/shared/day-grammar/types";
import type { Tier, TransportMode } from "@/shared/vocabulary";

/**
 * travel_times read/write (XXX-24, decision doc 003).
 *
 * The write path re-checks the doc's rulings before the database trigger
 * does — same law, friendlier error. There is deliberately no parameter
 * that raises PAIR_CEILING and no source value for Google: both are
 * Checkpoint 1 rulings, changeable only by a new decision pass.
 */

/** Doc 003 hard ceiling: distinct directed pairs per city. No override. */
export const PAIR_CEILING = 1000;

export type StorableSource = "ors_hosted" | "founder_measured";

export interface TravelTimeUpsert {
  city: string;
  originLabel: string;
  origin: LatLng;
  destLabel: string;
  dest: LatLng;
  mode: TransportMode;
  durationMinutes: number;
  distanceKm: number | null;
  source: StorableSource;
  tier: Tier;
  license: string | null;
  fetchedAt: string;
  traceId: string | null;
}

const pairKey = (city: string, origin: LatLng, dest: LatLng): string =>
  `${city}|${origin.lat},${origin.lng}|${dest.lat},${dest.lng}`;

/**
 * Pure ceiling check, exported for tests: the set of stored pairs plus
 * the incoming rows' pairs must stay within PAIR_CEILING per city.
 * Returns the offending city or null.
 */
export function ceilingBreach(
  existingPairKeys: ReadonlySet<string>,
  rows: readonly TravelTimeUpsert[],
): string | null {
  const perCity = new Map<string, Set<string>>();
  for (const key of existingPairKeys) {
    const city = key.slice(0, key.indexOf("|"));
    (perCity.get(city) ?? perCity.set(city, new Set()).get(city)!).add(key);
  }
  for (const row of rows) {
    const key = pairKey(row.city, row.origin, row.dest);
    const set =
      perCity.get(row.city) ?? perCity.set(row.city, new Set()).get(row.city)!;
    set.add(key);
    if (set.size > PAIR_CEILING) return row.city;
  }
  return null;
}

export async function upsertTravelTimes(
  client: SupabaseClient,
  rows: readonly TravelTimeUpsert[],
): Promise<void> {
  if (rows.length === 0) return;

  const cities = [...new Set(rows.map((r) => r.city))];
  const { data: existing, error: readError } = await client
    .from("travel_times")
    .select("city, origin_lat, origin_lng, dest_lat, dest_lng")
    .in("city", cities);
  if (readError) {
    throw new Error(`travel_times pre-read failed: ${readError.message}`);
  }

  const existingKeys = new Set(
    (existing ?? []).map((r) =>
      pairKey(
        r.city,
        { lat: r.origin_lat, lng: r.origin_lng },
        { lat: r.dest_lat, lng: r.dest_lng },
      ),
    ),
  );
  const breached = ceilingBreach(existingKeys, rows);
  if (breached !== null) {
    throw new Error(
      `travel_times: write would exceed the ${PAIR_CEILING} distinct-pair ceiling for ${breached} — decision doc 003 requires a new decision pass; no override exists`,
    );
  }

  const { error } = await client.from("travel_times").upsert(
    rows.map((r) => ({
      city: r.city,
      origin_label: r.originLabel,
      origin_lat: r.origin.lat,
      origin_lng: r.origin.lng,
      dest_label: r.destLabel,
      dest_lat: r.dest.lat,
      dest_lng: r.dest.lng,
      mode: r.mode,
      duration_minutes: r.durationMinutes,
      distance_km: r.distanceKm,
      source: r.source,
      tier: r.tier,
      license: r.license,
      fetched_at: r.fetchedAt,
      trace_id: r.traceId,
      updated_at: new Date().toISOString(),
    })),
    {
      onConflict:
        "city,origin_lat,origin_lng,dest_lat,dest_lng,mode,source",
    },
  );
  if (error) {
    throw new Error(`travel_times upsert failed: ${error.message}`);
  }
}

export interface TravelTimeRow {
  originLabel: string;
  origin: LatLng;
  destLabel: string;
  dest: LatLng;
  mode: TransportMode;
  durationMinutes: number;
  source: string;
  tier: Tier;
  license: string | null;
  fetchedAt: string;
}

export async function readCityTravelRows(
  client: SupabaseClient,
  city: string,
): Promise<TravelTimeRow[]> {
  const { data, error } = await client
    .from("travel_times")
    .select(
      "origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng, mode, duration_minutes, source, tier, license, fetched_at",
    )
    .eq("city", city);
  if (error) {
    throw new Error(`travel_times read failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    originLabel: r.origin_label,
    origin: { lat: r.origin_lat, lng: r.origin_lng },
    destLabel: r.dest_label,
    dest: { lat: r.dest_lat, lng: r.dest_lng },
    mode: r.mode,
    durationMinutes: r.duration_minutes,
    source: r.source,
    tier: r.tier,
    license: r.license,
    fetchedAt: r.fetched_at,
  }));
}

/**
 * Rows → the synchronous matrix record the validator reads
 * (MatrixTravelProvider keys: directional, coordinate-exact, per mode).
 * Where a founder row and an ORS row cover the same pair+mode, the
 * lower tier number wins — founder shadows engine (Checkpoint 2
 * ruling). Pure, exported for tests.
 */
export function buildMatrixRecord(
  rows: readonly TravelTimeRow[],
): Record<string, TravelEstimate> {
  const record: Record<string, TravelEstimate> = {};
  const winningTier: Record<string, Tier> = {};
  for (const row of rows) {
    const key = MatrixTravelProvider.key({
      origin: row.origin,
      destination: row.dest,
      mode: row.mode,
    });
    const incumbent = winningTier[key];
    if (incumbent !== undefined && incumbent <= row.tier) continue;
    winningTier[key] = row.tier;
    record[key] = {
      minutes: row.durationMinutes,
      provenance: { source: row.source, tier: row.tier },
    };
  }
  return record;
}
