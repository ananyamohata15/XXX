import { z } from "zod";
import { TIERS } from "@/shared/vocabulary";
import type { LatLng, TravelEstimate } from "@/shared/day-grammar/types";

/**
 * Request-scoped Google Routes transit client (XXX-24, decision doc 003).
 *
 * Durations from Routes have NO caching grant (SST §19.3 covers lat/lng
 * only) — this module deliberately has no write path. A transit answer
 * lives in memory for one generation, flows through provenance like
 * every fact (source/tier/fetched-at, in-memory), is displayed with the
 * Google Maps mark, and is discarded. The travel_times source whitelist
 * makes storing it a constraint violation as well.
 *
 * Billing: TRANSIT appears in no Pro/Enterprise SKU trigger list →
 * Compute Routes Essentials, $5/1,000, 10K events/month free. The
 * Essentials inference is verified against the first bill containing
 * transit calls (doc 003, Checkpoint 1 ruling 3).
 */

export const GOOGLE_TRANSIT_SOURCE = "google_routes";
/** List price per call at the Essentials rate ($5/1,000). */
export const GOOGLE_TRANSIT_EST_COST_USD = 0.005;

const COMPUTE_ROUTES_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
// Strict field mask: durations only — we do not request polylines,
// legs, or transit details we would not use.
const FIELD_MASK = "routes.duration,routes.distanceMeters";

const computeRoutesResponse = z.object({
  routes: z
    .array(
      z.object({
        duration: z.string().regex(/^\d+(\.\d+)?s$/),
        distanceMeters: z.number().optional(),
      }),
    )
    .optional(),
});

export interface TransitAnswer {
  estimate: TravelEstimate | null;
  distanceKm: number | null;
  durationMs: number;
}

/**
 * One transit duration, request-scoped. Returns a null estimate when
 * Google finds no transit route (honest absence — the fallback chain
 * downgrades to the stub, tier 3).
 */
export async function fetchTransitEstimate(
  apiKey: string,
  origin: LatLng,
  destination: LatLng,
  departureTimeIso: string,
): Promise<TransitAnswer> {
  const startedAt = Date.now();
  const response = await fetch(COMPUTE_ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      origin: {
        location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
      },
      destination: {
        location: {
          latLng: { latitude: destination.lat, longitude: destination.lng },
        },
      },
      travelMode: "TRANSIT",
      departureTime: departureTimeIso,
    }),
  });
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Routes computeRoutes (TRANSIT) failed: HTTP ${response.status} — ${body.slice(0, 300)}`,
    );
  }

  const parsed = computeRoutesResponse.parse(await response.json());
  const route = parsed.routes?.[0];
  if (!route) {
    return { estimate: null, distanceKm: null, durationMs };
  }

  const seconds = Number.parseFloat(route.duration.slice(0, -1));
  return {
    estimate: {
      minutes: Math.ceil(seconds / 60),
      provenance: { source: GOOGLE_TRANSIT_SOURCE, tier: TIERS.observed },
    },
    distanceKm:
      route.distanceMeters === undefined ? null : route.distanceMeters / 1000,
    durationMs,
  };
}
