import { z } from "zod";
import type { LatLng } from "@/shared/day-grammar/types";
import type { TransportMode } from "@/shared/vocabulary";

/**
 * Hosted openrouteservice Matrix client (XXX-24, decision doc 003 §2).
 *
 * Results are CC-BY-SA-4.0 licensed content (HeiGIT ToS: "Results
 * obtained from openrouteservice in any context are licensed under
 * CC-BY-SA 4.0") — every stored value carries ORS_LICENSE and displays
 * with ORS_ATTRIBUTION. Free-tier quotas (Matrix 500 req/day, 40/min)
 * are access terms accepted per the doc; callers batch pairs into few
 * requests and trace each one at est_cost_usd 0.
 */

export const ORS_SOURCE = "ors_hosted";
export const ORS_LICENSE = "CC-BY-SA-4.0";
export const ORS_ATTRIBUTION =
  "© openrouteservice by HeiGIT | Data from OpenStreetMap";

const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix";

/** ORS has no transit profile — enforced again by the DB constraint. */
export type OrsMode = Exclude<TransportMode, "transit">;

const ORS_PROFILES: Record<OrsMode, string> = {
  walk: "foot-walking",
  cycle: "cycling-regular",
  drive: "driving-car",
};

// Durations in seconds, distances in metres; null = ORS could not route
// the pair (honest absence — the caller skips the cell, never zeroes it).
const orsMatrixResponse = z.object({
  durations: z.array(z.array(z.number().nullable())),
  distances: z.array(z.array(z.number().nullable())).optional(),
});

export interface OrsMatrixCell {
  originIndex: number;
  destIndex: number;
  /** Whole minutes, ceiling — partial minutes are real travel time. */
  durationMinutes: number;
  distanceKm: number | null;
}

export interface OrsMatrixResult {
  mode: OrsMode;
  profile: string;
  cells: OrsMatrixCell[];
  /** Cells ORS answered null for — reported, never silently dropped. */
  unroutable: Array<{ originIndex: number; destIndex: number }>;
  durationMs: number;
}

/**
 * One Matrix request for one profile over a shared location list.
 * `locations` are [lng, lat] per the ORS API convention — the flip
 * happens here, at the boundary, and nowhere else.
 */
export async function fetchOrsMatrix(
  apiKey: string,
  mode: OrsMode,
  locations: LatLng[],
): Promise<OrsMatrixResult> {
  const profile = ORS_PROFILES[mode];
  const startedAt = Date.now();
  const response = await fetch(`${ORS_MATRIX_URL}/${profile}`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locations: locations.map((p) => [p.lng, p.lat]),
      metrics: ["duration", "distance"],
    }),
  });
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `ORS matrix (${profile}) failed: HTTP ${response.status} — ${body.slice(0, 300)}`,
    );
  }

  const parsed = orsMatrixResponse.parse(await response.json());

  const cells: OrsMatrixCell[] = [];
  const unroutable: Array<{ originIndex: number; destIndex: number }> = [];
  parsed.durations.forEach((row, originIndex) => {
    row.forEach((seconds, destIndex) => {
      if (originIndex === destIndex) return;
      if (seconds === null) {
        unroutable.push({ originIndex, destIndex });
        return;
      }
      const metres = parsed.distances?.[originIndex]?.[destIndex] ?? null;
      cells.push({
        originIndex,
        destIndex,
        durationMinutes: Math.ceil(seconds / 60),
        distanceKm: metres === null ? null : metres / 1000,
      });
    });
  });

  return { mode, profile, cells, unroutable, durationMs };
}
