/**
 * Travel-time providers (XXX-5; XXX-24 drops in behind this interface).
 *
 * The stub is honest about being a guess: great-circle distance times a
 * detour factor over a mode speed, stamped source `stub_haversine`, tier
 * 3. It is not pretending to be a routing engine, and the validator's
 * tolerance policy reads that tier and treats its output accordingly.
 */

import { TIERS } from "../vocabulary";
import { GRAMMAR_PARAMS, type GrammarParams, type ModeFactors } from "./params";
import type { LatLng, TravelEstimate, TravelQuery, TravelTimeProvider } from "./types";

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. Pure; no trig library needed. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line travel estimates with generous factors (XXX-5 Step 1).
 *
 * Known limitation, stated rather than papered over: one distance-tiered
 * formula cannot be simultaneously generous about downtown car egress and
 * accurate about rural highway running. Long urban drives (a 20 km
 * cross-city hop) read pessimistically, and that is the safe direction —
 * the tier-3 tolerance absorbs it, and XXX-24 replaces the whole thing.
 */
export class HaversineStubProvider implements TravelTimeProvider {
  static readonly SOURCE = "stub_haversine";

  private readonly params: GrammarParams["travel"];

  constructor(params: GrammarParams["travel"] = GRAMMAR_PARAMS.travel) {
    this.params = params;
  }

  estimate(query: TravelQuery): TravelEstimate | null {
    const km = haversineKm(query.origin, query.destination);
    const provenance = {
      source: HaversineStubProvider.SOURCE,
      tier: TIERS.judgment,
    };

    // Same place in practice — estimating a walk here would manufacture
    // violations between two stalls in the same market.
    if (km < this.params.negligibleDistanceKm) {
      return { minutes: 0, provenance };
    }

    // Widened from the `as const` literal: only `drive` carries an
    // interurban profile, so the narrow union has no common property.
    const factors: ModeFactors = this.params.modeFactors[query.mode];
    const profile =
      factors.interurban && km > factors.interurban.thresholdKm
        ? factors.interurban
        : factors.urban;

    const hours = (km * profile.detourFactor) / profile.speedKmh;
    return {
      minutes: Math.ceil(hours * 60 + factors.overheadMinutes),
      provenance,
    };
  }
}

/**
 * Reads pre-fetched travel times. This is the shape XXX-24 takes: its
 * provider is networked and async, so context assembly fetches the day's
 * pairs up front and hands the validator this synchronous reader. Not
 * used this session beyond proving the seam holds — the fixtures run on
 * the stub — but it is nine lines, and writing it now is what makes
 * "zero validator changes" a claim rather than a hope.
 */
export class MatrixTravelProvider implements TravelTimeProvider {
  constructor(
    private readonly matrix: Readonly<Record<string, TravelEstimate>>,
  ) {}

  /** Directional and mode-specific — real travel is not symmetric. */
  static key(q: Pick<TravelQuery, "origin" | "destination" | "mode">): string {
    return `${q.origin.lat},${q.origin.lng}|${q.destination.lat},${q.destination.lng}|${q.mode}`;
  }

  estimate(query: TravelQuery): TravelEstimate | null {
    return this.matrix[MatrixTravelProvider.key(query)] ?? null;
  }
}

/**
 * First non-null estimate wins (XXX-24 fallback chain: stored matrix →
 * stub, with provenance downgrading honestly at each step — the answer
 * carries whichever provider's source/tier actually produced it, and the
 * validator's tolerance policy reads that tier). Pure composition; an
 * empty chain answers null, which the validator already treats as
 * honest absence.
 */
export class ChainTravelProvider implements TravelTimeProvider {
  constructor(private readonly providers: readonly TravelTimeProvider[]) {}

  estimate(query: TravelQuery): TravelEstimate | null {
    for (const provider of this.providers) {
      const estimate = provider.estimate(query);
      if (estimate !== null) return estimate;
    }
    return null;
  }
}
