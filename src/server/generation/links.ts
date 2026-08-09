/**
 * Link-on-demand (CP1 ruling 2). A shortlisted candidate without a
 * `google_place_id` gets one minted at generation time: a free IDs-only
 * text search proposes an id, the Details call we were making anyway
 * returns a display name, and Session 5's ratified matching machinery —
 * `decideMatch` with T_HIGH/T_LOW/MARGIN (0.75/0.45/0.15), method "ns1" —
 * decides in process memory whether the name confirms the identity. The
 * Google name is compared and discarded, verbatim the doc-002 §3
 * discipline.
 *
 * Confidence states persist identically to the batch pipeline: a
 * `discovered_places` row (id indefinitely storable; coords under the
 * 30-day regime that repo owns), an `identity_matches` row with the same
 * statuses, and — only on `matched_confirmed` — the collision-safe
 * `places.google_place_id` link. The pool permanently enriches past 395.
 * On anything short of confirmed, no link is written and the candidate
 * stays eligible as honest-absence (its facts remain unfetched).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decideMatch, type MatchDecision } from "../base-layer/match";
import { SIMILARITY_METHOD } from "../base-layer/similarity";
import { setPlaceGoogleLink, upsertIdentityMatch } from "../base-layer/repo";
import { upsertDiscoveredPlace } from "../discovery/repo";
import type { NewDiscoveredPlace } from "../discovery/schemas";
import type { City } from "@/shared/vocabulary";
import type { Candidate } from "./types";

/** Bias radius for the identity search — tight, the FSQ coords are good. */
const LINK_SEARCH_RADIUS_M = 250;

export interface LinkVerdict {
  status: MatchDecision["status"];
  googlePlaceId: string;
  bestScore: number;
}

export function linkSearchQuery(candidate: Candidate): string {
  return `${candidate.place.name}, ${candidate.place.neighborhood}, Toronto`;
}

export function linkSearchBias(candidate: Candidate): {
  lat: number;
  lng: number;
  radiusM: number;
} {
  // Retrieval guarantees coords on every pool candidate.
  const coords = candidate.place.coords!;
  return { lat: coords.lat, lng: coords.lng, radiusM: LINK_SEARCH_RADIUS_M };
}

/**
 * Judge and persist one proposed link. `googleName` is request-scoped:
 * it is scored here and goes no further (the decision carries scores and
 * ids only). Returns the verdict; the caller applies it to the
 * candidate. Persistence failures are loud — a broken pipeline must
 * alert, not skip.
 */
export async function judgeAndPersistLink(
  supabase: SupabaseClient,
  city: City,
  candidate: Candidate,
  googlePlaceId: string,
  googleName: string | null,
  location: { lat: number; lng: number } | null,
  traceId: string,
  now: () => Date,
): Promise<LinkVerdict> {
  const decision: MatchDecision =
    googleName === null || googleName.length === 0
      ? {
          status: "name_mismatch",
          note: null,
          bestScore: 0,
          scores: [{ place_id: candidate.place.id, score: 0 }],
        }
      : decideMatch(googleName, [
          {
            placeUuid: candidate.place.id,
            fsqName: candidate.place.name,
            distanceM: 0,
          },
        ]);

  // The discovery schema is single-city today; a non-Toronto request
  // fails its parse loudly rather than silently skipping persistence.
  const { row: discovered } = await upsertDiscoveredPlace(supabase, {
    city: city as NewDiscoveredPlace["city"],
    googlePlaceId,
    coords: location,
    fetchedAt: now().toISOString(),
  });

  if (decision.status === "matched_confirmed") {
    const { collision } = await setPlaceGoogleLink(
      supabase,
      candidate.place.id,
      googlePlaceId,
    );
    await upsertIdentityMatch(supabase, {
      discoveredPlaceId: discovered.id,
      status: collision ? "ambiguous" : "matched_confirmed",
      placeId: collision ? null : candidate.place.id,
      bestScore: decision.bestScore,
      method: SIMILARITY_METHOD,
      candidates: collision
        ? { entries: decision.scores, note: "link_collision" }
        : null,
      matchedAt: now().toISOString(),
      traceId,
    });
    return {
      status: collision ? "ambiguous" : "matched_confirmed",
      googlePlaceId,
      bestScore: decision.bestScore,
    };
  }

  await upsertIdentityMatch(supabase, {
    discoveredPlaceId: discovered.id,
    status: decision.status,
    placeId: null,
    bestScore: decision.bestScore,
    method: SIMILARITY_METHOD,
    candidates: {
      entries: decision.scores,
      ...(decision.status === "ambiguous" && decision.note
        ? { note: decision.note }
        : {}),
    },
    matchedAt: now().toISOString(),
    traceId,
  });
  return {
    status: decision.status,
    googlePlaceId,
    bestScore: decision.bestScore,
  };
}
