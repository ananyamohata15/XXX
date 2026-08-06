import type { SupabaseClient } from "@supabase/supabase-js";
import { newFactSchema } from "../domain/schemas";
import type { PlaceCategory } from "../domain/schemas";
import {
  newBaseLayerPlaceSchema,
  newIdentityMatchSchema,
  type NewBaseLayerPlace,
  type NewIdentityMatch,
} from "./schemas";
import {
  withCoordsTtlApplied,
  type DiscoveredPlaceRow,
} from "../discovery/repo";

/**
 * Base-layer repository (decision 002). Same conflict-safety posture as the
 * discovery repo: every write is re-runnable; read-then-write protects
 * columns an upsert must never clobber (google_place_id, created_at).
 * Every list read paginates with .range() — the Session 4 pool-report
 * truncation lesson is law here.
 */

const PAGE = 1000;

export interface BaseLayerPlaceRow {
  id: string;
  city: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  google_place_id: string | null;
  fsq_place_id: string | null;
  source: string;
  source_version: string | null;
  tier: number;
  fetched_at: string;
}

const PLACE_COLUMNS =
  "id, city, name, lat, lng, address, google_place_id, fsq_place_id, source, source_version, tier, fetched_at";

export async function upsertBaseLayerPlace(
  client: SupabaseClient,
  input: NewBaseLayerPlace,
): Promise<{ row: BaseLayerPlaceRow; isNew: boolean }> {
  const p = newBaseLayerPlaceSchema.parse(input);
  const identityColumns = {
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    address: p.address,
    source_version: p.datasetVersion,
    fetched_at: p.publicationDate,
  };

  const existing = await client
    .from("places")
    .select("id")
    .eq("fsq_place_id", p.fsqPlaceId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`places lookup failed: ${existing.error.message}`);
  }

  if (existing.data) {
    // Re-ingest refreshes identity fields only. google_place_id (the match
    // link) and created_at are deliberately not in the patch.
    const updated = await client
      .from("places")
      .update(identityColumns)
      .eq("fsq_place_id", p.fsqPlaceId)
      .select(PLACE_COLUMNS)
      .single();
    if (updated.error) {
      throw new Error(`places update failed: ${updated.error.message}`);
    }
    return { row: updated.data as BaseLayerPlaceRow, isNew: false };
  }

  const inserted = await client
    .from("places")
    .insert({
      city: p.city,
      fsq_place_id: p.fsqPlaceId,
      ...identityColumns,
      // The repo pins provenance — callers cannot claim otherwise.
      source: "fsq_os_places",
      tier: 2,
    })
    .select(PLACE_COLUMNS)
    .single();
  if (inserted.error) {
    // Concurrent insert of the same identity collapses to the update path.
    if (inserted.error.message.includes("places_fsq_place_id")) {
      return upsertBaseLayerPlace(client, input);
    }
    throw new Error(`places insert failed: ${inserted.error.message}`);
  }
  return { row: inserted.data as BaseLayerPlaceRow, isNew: true };
}

/** One current categories fact per place; refresh overwrites in full. */
export async function upsertCategoriesFact(
  client: SupabaseClient,
  input: {
    placeId: string;
    mapped: PlaceCategory[];
    sourceLabels: string[];
    publicationDate: string;
  },
): Promise<void> {
  const fact = newFactSchema.parse({
    placeId: input.placeId,
    factKey: "categories",
    status: "present",
    value: { mapped: input.mapped, source_labels: input.sourceLabels },
    source: "fsq_os_places",
    tier: 2,
    fetchedAt: input.publicationDate,
  });
  const { error } = await client.from("facts").upsert(
    {
      place_id: fact.placeId,
      fact_key: fact.factKey,
      status: fact.status,
      value: fact.status === "present" ? fact.value : null,
      source: fact.source,
      tier: fact.tier,
      fetched_at: fact.fetchedAt,
    },
    { onConflict: "place_id,fact_key" },
  );
  if (error) throw new Error(`facts upsert failed: ${error.message}`);
}

/** One current matching outcome per discovered place; re-match overwrites. */
export async function upsertIdentityMatch(
  client: SupabaseClient,
  input: NewIdentityMatch,
): Promise<void> {
  const m = newIdentityMatchSchema.parse(input);
  const { error } = await client.from("identity_matches").upsert(
    {
      discovered_place_id: m.discoveredPlaceId,
      status: m.status,
      place_id: m.placeId,
      best_score: m.bestScore,
      method: m.method,
      candidates: m.candidates,
      matched_at: m.matchedAt,
      trace_id: m.traceId,
    },
    { onConflict: "discovered_place_id" },
  );
  if (error) {
    throw new Error(`identity_matches upsert failed: ${error.message}`);
  }
}

/**
 * Write the operational link on a confirmed match. Collision = this place
 * already carries a DIFFERENT link (two discovered Google places confirming
 * one FSQ identity — duplicate Google listings), surfaced for the ambiguous/
 * link_collision demotion, never an overwrite. The update is conditional on
 * google_place_id IS NULL so a concurrent linker cannot clobber either
 * (found the hard way: the full run's abort on
 * identity_matches_place_matched_unique — the DB caught what the original
 * unconditional update silently overwrote).
 */
export async function setPlaceGoogleLink(
  client: SupabaseClient,
  placeId: string,
  googlePlaceId: string,
): Promise<{ collision: boolean }> {
  const current = await client
    .from("places")
    .select("google_place_id")
    .eq("id", placeId)
    .single();
  if (current.error) {
    throw new Error(`places link lookup failed: ${current.error.message}`);
  }
  const existing = (current.data as { google_place_id: string | null })
    .google_place_id;
  if (existing === googlePlaceId) return { collision: false }; // idempotent
  if (existing !== null) return { collision: true };

  const updated = await client
    .from("places")
    .update({ google_place_id: googlePlaceId })
    .eq("id", placeId)
    .is("google_place_id", null)
    .select("id");
  if (updated.error) {
    if (updated.error.message.includes("places_google_place_id")) {
      return { collision: true };
    }
    throw new Error(`places google link update failed: ${updated.error.message}`);
  }
  // Zero rows updated = a concurrent linker won the race after our read.
  return { collision: (updated.data ?? []).length === 0 };
}

/**
 * Restore a link from match evidence (the repair path for the pre-fix
 * clobber; deliberately unconditional — evidence wins).
 */
export async function repairPlaceGoogleLink(
  client: SupabaseClient,
  placeId: string,
  googlePlaceId: string,
): Promise<void> {
  const { error } = await client
    .from("places")
    .update({ google_place_id: googlePlaceId })
    .eq("id", placeId)
    .select("id");
  if (error) throw new Error(`link repair failed: ${error.message}`);
}

async function listPaginated<Row>(
  fetchPage: (from: number, to: number) => Promise<{
    data: Row[] | null;
    error: { message: string } | null;
  }>,
  label: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`${label} page failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** All FSQ identities for a city (the matching corpus). */
export function listFsqPlaces(
  client: SupabaseClient,
  city: string,
): Promise<BaseLayerPlaceRow[]> {
  return listPaginated<BaseLayerPlaceRow>(
    (from, to) =>
      client
        .from("places")
        .select(PLACE_COLUMNS)
        .eq("city", city)
        .eq("source", "fsq_os_places")
        .order("fsq_place_id")
        .range(from, to) as never,
    "places",
  );
}

/**
 * Discovered places in deterministic order (Checkpoint 2 addition 1:
 * google_place_id ascending — content-derived, so collision winners are
 * reproducible across runs). Coords pass through the read-side TTL guard.
 */
export async function listDiscoveredPlacesOrdered(
  client: SupabaseClient,
  city: string,
  now: Date,
): Promise<DiscoveredPlaceRow[]> {
  const rows = await listPaginated<DiscoveredPlaceRow>(
    (from, to) =>
      client
        .from("discovered_places")
        .select(
          "id, city, google_place_id, lat, lng, coords_status, coords_fetched_at, source, tier, first_discovered_at",
        )
        .eq("city", city)
        .order("google_place_id")
        .range(from, to) as never,
    "discovered_places",
  );
  return rows.map((r) => withCoordsTtlApplied(r, now));
}

/** Existing outcomes, for the skip-terminal-status re-run rule and the
 * link verifier. */
export function listExistingMatches(
  client: SupabaseClient,
): Promise<
  { discovered_place_id: string; status: string; place_id: string | null }[]
> {
  return listPaginated<{
    discovered_place_id: string;
    status: string;
    place_id: string | null;
  }>(
    (from, to) =>
      client
        .from("identity_matches")
        .select("discovered_place_id, status, place_id")
        .order("discovered_place_id")
        .range(from, to) as never,
    "identity_matches",
  );
}
