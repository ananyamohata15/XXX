import type { SupabaseClient } from "@supabase/supabase-js";
import {
  newDiscoveredPlaceSchema,
  newDiscoveryHitSchema,
  type NewDiscoveredPlace,
  type NewDiscoveryHit,
} from "./schemas";
import { coordsExpired } from "./ttl";

/**
 * Discovery-pool repository (XXX-22). Upserts only — re-running ingestion is
 * the resume strategy, so every write must be conflict-safe.
 *
 * Read side enforces the 30-day coordinate ceiling independently of the
 * XXX-25 sweep: a row whose clock has run out is returned as expired even if
 * the database still holds values.
 */

export interface DiscoveredPlaceRow {
  id: string;
  city: string;
  google_place_id: string;
  lat: number | null;
  lng: number | null;
  coords_status: "present" | "absent_at_source" | "expired";
  coords_fetched_at: string | null;
  source: string;
  tier: number;
  first_discovered_at: string;
}

const DISCOVERED_PLACE_COLUMNS =
  "id, city, google_place_id, lat, lng, coords_status, coords_fetched_at, source, tier, first_discovered_at";

/**
 * Insert or refresh a discovered place. On conflict (google_place_id unique)
 * the coordinate columns and clock are overwritten — re-discovery restarts
 * the 30-day window — while first_discovered_at keeps its original value
 * because the upsert payload's value only lands on insert... which PostgREST
 * upsert does NOT provide (it writes every payload column on update too).
 * So: two-step — try the cheap update-shaped upsert only after reading
 * whether the row exists. One extra read per place, zero lost metadata.
 */
export async function upsertDiscoveredPlace(
  client: SupabaseClient,
  input: NewDiscoveredPlace,
): Promise<{ row: DiscoveredPlaceRow; isNew: boolean }> {
  const p = newDiscoveredPlaceSchema.parse(input);
  const coordColumns = p.coords
    ? {
        lat: p.coords.lat,
        lng: p.coords.lng,
        coords_status: "present" as const,
        coords_fetched_at: p.fetchedAt,
      }
    : {
        lat: null,
        lng: null,
        coords_status: "absent_at_source" as const,
        coords_fetched_at: null,
      };

  const existing = await client
    .from("discovered_places")
    .select("id")
    .eq("google_place_id", p.googlePlaceId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(
      `discovered_places lookup failed: ${existing.error.message}`,
    );
  }

  if (existing.data) {
    // Known place re-surfaced: refresh coords + clock only. A re-discovery
    // returning no location must NOT erase live coords ('absent_at_source'
    // describes first contact, not a downgrade path) — skip the update.
    if (!p.coords) {
      const reread = await client
        .from("discovered_places")
        .select(DISCOVERED_PLACE_COLUMNS)
        .eq("google_place_id", p.googlePlaceId)
        .single();
      if (reread.error) {
        throw new Error(
          `discovered_places reread failed: ${reread.error.message}`,
        );
      }
      return { row: reread.data as DiscoveredPlaceRow, isNew: false };
    }
    const updated = await client
      .from("discovered_places")
      .update(coordColumns)
      .eq("google_place_id", p.googlePlaceId)
      .select(DISCOVERED_PLACE_COLUMNS)
      .single();
    if (updated.error) {
      throw new Error(
        `discovered_places update failed: ${updated.error.message}`,
      );
    }
    return { row: updated.data as DiscoveredPlaceRow, isNew: false };
  }

  const inserted = await client
    .from("discovered_places")
    .insert({
      city: p.city,
      google_place_id: p.googlePlaceId,
      ...coordColumns,
      source: "google_places",
      tier: 1,
      first_discovered_at: p.fetchedAt,
    })
    .select(DISCOVERED_PLACE_COLUMNS)
    .single();
  if (inserted.error) {
    // Concurrent insert of the same place collapses to the update path.
    if (inserted.error.message.includes("discovered_places_google_place_id")) {
      return upsertDiscoveredPlace(client, input);
    }
    throw new Error(
      `discovered_places insert failed: ${inserted.error.message}`,
    );
  }
  return { row: inserted.data as DiscoveredPlaceRow, isNew: true };
}

/** Record which query surfaced the place; duplicate (place, category, anchor) is a no-op. */
export async function recordDiscoveryHit(
  client: SupabaseClient,
  input: NewDiscoveryHit,
): Promise<void> {
  const h = newDiscoveryHitSchema.parse(input);
  const { error } = await client.from("discovery_hits").upsert(
    {
      discovered_place_id: h.discoveredPlaceId,
      category: h.category,
      anchor: h.anchor,
      result_rank: h.resultRank,
      trace_id: h.traceId,
      discovered_at: h.discoveredAt,
    },
    { onConflict: "discovered_place_id,category,anchor", ignoreDuplicates: true },
  );
  if (error) throw new Error(`discovery_hits upsert failed: ${error.message}`);
}

/**
 * Read-side TTL guard: rows past the 30-day ceiling are surfaced as expired
 * with their values withheld, regardless of sweep lag. Never returns coords
 * the ToS no longer permits us to hold.
 */
export function withCoordsTtlApplied(
  row: DiscoveredPlaceRow,
  now: Date,
): DiscoveredPlaceRow {
  if (
    row.coords_status === "present" &&
    row.coords_fetched_at !== null &&
    coordsExpired(row.coords_fetched_at, now)
  ) {
    return { ...row, lat: null, lng: null, coords_status: "expired" };
  }
  return row;
}
