import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ChainTravelProvider,
  HaversineStubProvider,
  MatrixTravelProvider,
} from "@/shared/day-grammar/travel";
import type {
  LatLng,
  TravelEstimate,
  TravelTimeProvider,
} from "@/shared/day-grammar/types";
import { fetchTransitEstimate } from "./google-transit";
import { buildMatrixRecord, readCityTravelRows } from "./store";

/**
 * Context assembly for the validator's travel seam (XXX-24).
 *
 * The validator stays pure and synchronous (Session 7's contract), so
 * everything networked happens here, up front: stored walk/cycle/drive
 * rows are read into the matrix record, the day's transit legs are
 * fetched request-scoped from Google Routes and merged into the same
 * in-memory record (never written anywhere — doc 003), and the stub
 * closes the chain so every pair gets an answer or an honest null.
 * Provenance downgrades honestly along the chain: stored row (tier 1/2)
 * → live transit (tier 2) → stub (tier 3).
 */

export interface TransitLeg {
  label: string;
  origin: LatLng;
  dest: LatLng;
  /** Absolute departure instant, ISO 8601 (Routes API requirement). */
  departureTimeIso: string;
}

export interface TransitCall {
  label: string;
  estimate: TravelEstimate | null;
  distanceKm: number | null;
  durationMs: number;
}

export interface AssembledTravel {
  provider: TravelTimeProvider;
  /** One entry per Google call — the caller traces these. */
  transitCalls: TransitCall[];
}

export async function assembleTravelProvider(
  client: SupabaseClient,
  googleApiKey: string,
  city: string,
  transitLegs: readonly TransitLeg[],
): Promise<AssembledTravel> {
  const rows = await readCityTravelRows(client, city);
  const record = buildMatrixRecord(rows);

  const transitCalls: TransitCall[] = [];
  for (const leg of transitLegs) {
    const answer = await fetchTransitEstimate(
      googleApiKey,
      leg.origin,
      leg.dest,
      leg.departureTimeIso,
    );
    transitCalls.push({
      label: leg.label,
      estimate: answer.estimate,
      distanceKm: answer.distanceKm,
      durationMs: answer.durationMs,
    });
    if (answer.estimate !== null) {
      const key = MatrixTravelProvider.key({
        origin: leg.origin,
        destination: leg.dest,
        mode: "transit",
      });
      // A founder-measured transit row (tier 1) outranks the live
      // answer (tier 2) — same shadowing rule as the stored matrix.
      const stored = record[key];
      if (stored === undefined || stored.provenance.tier > 2) {
        record[key] = answer.estimate;
      }
    }
  }

  return {
    provider: new ChainTravelProvider([
      new MatrixTravelProvider(record),
      new HaversineStubProvider(),
    ]),
    transitCalls,
  };
}
