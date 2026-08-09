import { createClient } from "@supabase/supabase-js";
import { createInstrumentation } from "../src/server/instrumentation";
import {
  ORS_LICENSE,
  ORS_SOURCE,
  fetchOrsMatrix,
  type OrsMatrixResult,
  type OrsMode,
} from "../src/server/travel/ors";
import {
  upsertTravelTimes,
  type TravelTimeUpsert,
} from "../src/server/travel/store";
import { TIERS } from "../src/shared/vocabulary";
import {
  CITY,
  CITY_MATRIX_KEYS,
  CORRIDOR_MATRIX_KEYS,
  FOUNDER_FETCHED_AT,
  FOUNDER_SEEDS,
  PLACES,
  STORED_PAIRS,
} from "./travel-pairs";

/**
 * The bounded matrix build (XXX-24 Step 3, decision doc 003 posture
 * (b)+(c)): ORS walk/cycle/drive for the golden directed pairs, stored
 * with CC-BY-SA-4.0 license marks, plus the founder's lived estimates
 * as tier-1 seed rows. Idempotent — re-runs upsert with fresher
 * fetched_at. Every ORS call is traced (est_cost_usd 0: free tier, and
 * the trace makes quota consumption visible).
 *
 * Spend: 4 ORS Matrix requests against a 500/day free quota. $0.
 * Transit is deliberately absent here — Google Routes durations are
 * unstorable (doc 003 §1), and the travel_times constraints would
 * reject them anyway.
 *
 * Usage: npx tsx --env-file .env.local scripts/build-travel-matrix.ts
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const orsKey = requireEnv("ORS_API_KEY");
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const instrumentation = createInstrumentation(supabase);
  const traceId = await instrumentation.startTrace("travel_matrix");
  const fetchedAt = new Date().toISOString();

  const cityLocations = CITY_MATRIX_KEYS.map((k) => PLACES[k].coords);
  const corridorLocations = CORRIDOR_MATRIX_KEYS.map((k) => PLACES[k].coords);

  // One Matrix call per (location set × profile) we store from.
  const matrices: Record<"city" | "corridor", Partial<Record<OrsMode, OrsMatrixResult>>> = {
    city: {},
    corridor: {},
  };
  const calls: Array<{ set: "city" | "corridor"; mode: OrsMode }> = [
    { set: "city", mode: "walk" },
    { set: "city", mode: "cycle" },
    { set: "city", mode: "drive" },
    { set: "corridor", mode: "drive" },
  ];
  for (const call of calls) {
    const locations = call.set === "city" ? cityLocations : corridorLocations;
    const result = await fetchOrsMatrix(orsKey, call.mode, locations);
    matrices[call.set][call.mode] = result;
    await instrumentation.logEvent(traceId, {
      provider: "ors",
      endpoint: `matrix.${result.profile}`,
      estCostUsd: 0,
      durationMs: result.durationMs,
      metadata: {
        set: call.set,
        locations: locations.length,
        cells: result.cells.length,
        unroutable: result.unroutable.length,
      },
    });
  }

  const indexOf = (set: "city" | "corridor", key: string): number =>
    set === "city"
      ? CITY_MATRIX_KEYS.indexOf(key as (typeof CITY_MATRIX_KEYS)[number])
      : CORRIDOR_MATRIX_KEYS.indexOf(key as (typeof CORRIDOR_MATRIX_KEYS)[number]);

  const rows: TravelTimeUpsert[] = [];
  const skipped: string[] = [];
  for (const pair of STORED_PAIRS) {
    const originIndex = indexOf(pair.set, pair.origin);
    const destIndex = indexOf(pair.set, pair.dest);
    for (const mode of pair.modes) {
      const matrix = matrices[pair.set][mode];
      const cell = matrix?.cells.find(
        (c) => c.originIndex === originIndex && c.destIndex === destIndex,
      );
      if (!cell) {
        // Honest absence: an unroutable pair is reported, never zeroed.
        skipped.push(`${pair.origin}→${pair.dest} (${mode})`);
        continue;
      }
      rows.push({
        city: CITY,
        originLabel: PLACES[pair.origin].label,
        origin: PLACES[pair.origin].coords,
        destLabel: PLACES[pair.dest].label,
        dest: PLACES[pair.dest].coords,
        mode,
        durationMinutes: cell.durationMinutes,
        distanceKm: cell.distanceKm,
        source: ORS_SOURCE,
        tier: TIERS.observed,
        license: ORS_LICENSE,
        fetchedAt,
        traceId,
      });
    }
  }

  const seedRows: TravelTimeUpsert[] = FOUNDER_SEEDS.map((seed) => ({
    city: CITY,
    originLabel: PLACES[seed.origin].label,
    origin: PLACES[seed.origin].coords,
    destLabel: PLACES[seed.dest].label,
    dest: PLACES[seed.dest].coords,
    mode: seed.mode,
    durationMinutes: seed.minutes,
    distanceKm: null,
    source: "founder_measured",
    tier: TIERS.verified,
    license: null,
    fetchedAt: seed.fetchedAt ?? FOUNDER_FETCHED_AT,
    traceId,
  }));

  await upsertTravelTimes(supabase, [...rows, ...seedRows]);

  // Reconcile: FOUNDER_SEEDS is the declared truth for tier-1 rows. A
  // seed removed from the list (a disproven recollection — the
  // Beamsville→NOL doctrine ruling) is deleted here, so the engine's
  // row governs again. Only founder rows are reconciled; ORS rows are
  // refreshed by upsert.
  const declaredKeys = new Set(
    seedRows.map(
      (s) =>
        `${s.origin.lat},${s.origin.lng}|${s.dest.lat},${s.dest.lng}|${s.mode}`,
    ),
  );
  const { data: founderRows, error: founderReadError } = await supabase
    .from("travel_times")
    .select("id, origin_lat, origin_lng, dest_lat, dest_lng, mode")
    .eq("city", CITY)
    .eq("source", "founder_measured");
  if (founderReadError) {
    throw new Error(`founder reconcile read failed: ${founderReadError.message}`);
  }
  const staleIds = (founderRows ?? [])
    .filter(
      (r) =>
        !declaredKeys.has(
          `${r.origin_lat},${r.origin_lng}|${r.dest_lat},${r.dest_lng}|${r.mode}`,
        ),
    )
    .map((r) => r.id);
  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("travel_times")
      .delete()
      .in("id", staleIds);
    if (deleteError) {
      throw new Error(`founder reconcile delete failed: ${deleteError.message}`);
    }
  }

  await instrumentation.endTrace(traceId, {
    totalCostUsd: 0,
    metadata: {
      orsRows: rows.length,
      founderRows: seedRows.length,
      reconciledStaleFounderRows: staleIds.length,
      skippedUnroutable: skipped,
    },
  });

  console.log(
    JSON.stringify(
      {
        traceId,
        orsCalls: calls.length,
        orsRows: rows.length,
        founderRows: seedRows.length,
        reconciledStaleFounderRows: staleIds.length,
        skippedUnroutable: skipped,
        estCostUsd: 0,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
