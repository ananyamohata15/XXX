import type { SupabaseClient } from "@supabase/supabase-js";
import type { Instrumentation } from "../instrumentation";
import type { DetailsClient } from "./details-client";
import {
  CONFIRM_FIELD_MASK,
  PLACE_DETAILS_PRO_USD_PER_CALL,
} from "./details-client";
import { buildGrid, MATCH_RADIUS_M, type ProximityGrid } from "./geo";
import {
  MARGIN,
  nameSimilarity,
  SIMILARITY_METHOD,
  T_HIGH,
  T_LOW,
} from "./similarity";
import {
  listDiscoveredPlacesOrdered,
  listExistingMatches,
  listFsqPlaces,
  setPlaceGoogleLink,
  upsertIdentityMatch,
} from "./repo";
import type { NewIdentityMatch } from "./schemas";

/**
 * Identity matching (decision 002, SESSION_NOTES 2.3). Two phases:
 *
 *  PLAN (free): deterministic order (google_place_id asc), shortlist by
 *  100 m proximity, count who needs a confirm call. The plan is printed and
 *  checked against --max-calls BEFORE any money moves.
 *
 *  EXECUTE: one Place Details (id,displayName — Pro) call per shortlisted
 *  place; displayName compared in process memory, then gone. Only the link
 *  + our confidence metadata persist. Terminal-status places are skipped —
 *  a re-run re-spends nothing.
 */

export interface MatchCandidate {
  placeUuid: string;
  fsqName: string;
  distanceM: number;
}

export type MatchDecision =
  | {
      status: "matched_confirmed";
      placeUuid: string;
      bestScore: number;
      scores: { place_id: string; score: number }[];
    }
  | {
      status: "ambiguous" | "name_mismatch";
      note: "mid_band" | "low_margin" | null;
      bestScore: number;
      scores: { place_id: string; score: number }[];
    };

/**
 * Pure decision core. googleName is request-scoped Google content — this
 * function returns scores and ids only; the name goes no further.
 */
export function decideMatch(
  googleName: string,
  candidates: MatchCandidate[],
): MatchDecision {
  if (candidates.length === 0) {
    throw new Error("decideMatch requires at least one candidate");
  }
  const scores = candidates
    .map((c) => ({
      place_id: c.placeUuid,
      score: nameSimilarity(googleName, c.fsqName),
    }))
    .sort((a, b) => b.score - a.score || a.place_id.localeCompare(b.place_id));
  const best = scores[0];
  const runnerUp = scores[1];

  if (best.score < T_LOW) {
    return { status: "name_mismatch", note: null, bestScore: best.score, scores };
  }
  if (best.score < T_HIGH) {
    return { status: "ambiguous", note: "mid_band", bestScore: best.score, scores };
  }
  if (runnerUp && best.score - runnerUp.score < MARGIN) {
    return { status: "ambiguous", note: "low_margin", bestScore: best.score, scores };
  }
  return {
    status: "matched_confirmed",
    placeUuid: best.place_id,
    bestScore: best.score,
    scores,
  };
}

export interface MatchPlanEntry {
  discoveredPlaceId: string;
  googlePlaceId: string;
  candidates: MatchCandidate[];
}

export interface MatchPlan {
  /** Places needing a confirm call, in deterministic processing order. */
  toConfirm: MatchPlanEntry[];
  /** Places with no shortlist — written as no_candidates, zero spend. */
  noCandidates: { discoveredPlaceId: string }[];
  skippedTerminal: number;
  skippedNoCoords: number;
  fsqCorpusSize: number;
}

export async function buildMatchPlan(
  supabase: SupabaseClient,
  city: string,
  now: Date,
  options?: {
    rematch?: boolean;
    /** Restrict to discovered places inside a bbox (dry run). */
    within?: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  },
): Promise<MatchPlan> {
  const fsqPlaces = await listFsqPlaces(supabase, city);
  const grid: ProximityGrid = buildGrid(
    fsqPlaces.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })),
  );
  const terminal = options?.rematch
    ? new Set<string>()
    : new Set(
        (await listExistingMatches(supabase)).map(
          (m) => m.discovered_place_id,
        ),
      );

  const discovered = await listDiscoveredPlacesOrdered(supabase, city, now);
  const plan: MatchPlan = {
    toConfirm: [],
    noCandidates: [],
    skippedTerminal: 0,
    skippedNoCoords: 0,
    fsqCorpusSize: fsqPlaces.length,
  };

  for (const d of discovered) {
    if (terminal.has(d.id)) {
      plan.skippedTerminal++;
      continue;
    }
    if (d.coords_status !== "present" || d.lat === null || d.lng === null) {
      // Expired/absent coords cannot shortlist — recorded, never guessed.
      plan.skippedNoCoords++;
      continue;
    }
    if (
      options?.within &&
      (d.lat < options.within.latMin ||
        d.lat > options.within.latMax ||
        d.lng < options.within.lngMin ||
        d.lng > options.within.lngMax)
    ) {
      continue;
    }
    const nearby = grid.near(d.lat, d.lng, MATCH_RADIUS_M);
    if (nearby.length === 0) {
      plan.noCandidates.push({ discoveredPlaceId: d.id });
    } else {
      plan.toConfirm.push({
        discoveredPlaceId: d.id,
        googlePlaceId: d.google_place_id,
        candidates: nearby.map((n) => ({
          placeUuid: n.id,
          fsqName: n.name,
          distanceM: n.distanceM,
        })),
      });
    }
  }
  return plan;
}

export interface MatchingReport {
  traceId: string;
  confirmCalls: number;
  totalEstCostUsd: number;
  outcomes: Record<string, number>;
  collisions: number;
  /** Every comparison's best score — Checkpoint 2 addition 3 (histogram). */
  scoreDistribution: number[];
  startedAt: string;
  finishedAt: string;
}

const FREE_TIER_NOTE =
  "est_cost_usd is Place Details Pro list price; Pro tier includes 5,000 free calls/month (billing offset, not zero cost)";

export async function runMatching(options: {
  supabase: SupabaseClient;
  details: DetailsClient;
  instrumentation: Instrumentation;
  plan: MatchPlan;
  now?: () => Date;
}): Promise<MatchingReport> {
  const { supabase, details, instrumentation, plan } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const traceId = await instrumentation.startTrace("identity_matching");

  const outcomes: Record<string, number> = {};
  const scoreDistribution: number[] = [];
  let confirmCalls = 0;
  let collisions = 0;
  const bump = (status: string) => {
    outcomes[status] = (outcomes[status] ?? 0) + 1;
  };

  try {
    for (const { discoveredPlaceId } of plan.noCandidates) {
      await upsertIdentityMatch(supabase, {
        discoveredPlaceId,
        status: "no_candidates",
        placeId: null,
        bestScore: null,
        method: null,
        candidates: null,
        matchedAt: now().toISOString(),
        traceId,
      });
      bump("no_candidates");
    }

    for (const entry of plan.toConfirm) {
      const callStart = now().getTime();
      const response = await details.getPlace(entry.googlePlaceId);
      const durationMs = now().getTime() - callStart;
      confirmCalls++;

      // The Google name lives exactly as long as this block.
      const googleName = response.displayName?.text ?? "";
      const decision =
        googleName.length === 0
          ? // No name at source: cannot confirm anything by name.
            ({
              status: "name_mismatch",
              note: null,
              bestScore: 0,
              scores: entry.candidates.map((c) => ({
                place_id: c.placeUuid,
                score: 0,
              })),
            } as const)
          : decideMatch(googleName, entry.candidates);
      scoreDistribution.push(decision.bestScore);

      let match: NewIdentityMatch;
      if (decision.status === "matched_confirmed") {
        const { collision } = await setPlaceGoogleLink(
          supabase,
          decision.placeUuid,
          entry.googlePlaceId,
        );
        if (collision) {
          collisions++;
          match = {
            discoveredPlaceId: entry.discoveredPlaceId,
            status: "ambiguous",
            placeId: null,
            bestScore: decision.bestScore,
            method: SIMILARITY_METHOD,
            candidates: { entries: decision.scores, note: "link_collision" },
            matchedAt: now().toISOString(),
            traceId,
          };
        } else {
          match = {
            discoveredPlaceId: entry.discoveredPlaceId,
            status: "matched_confirmed",
            placeId: decision.placeUuid,
            bestScore: decision.bestScore,
            method: SIMILARITY_METHOD,
            candidates: null,
            matchedAt: now().toISOString(),
            traceId,
          };
        }
      } else {
        match = {
          discoveredPlaceId: entry.discoveredPlaceId,
          status: decision.status,
          placeId: null,
          bestScore: decision.bestScore,
          method: SIMILARITY_METHOD,
          candidates: {
            entries: decision.scores,
            ...(decision.note ? { note: decision.note } : {}),
          },
          matchedAt: now().toISOString(),
          traceId,
        };
      }
      await upsertIdentityMatch(supabase, match);
      bump(match.status);

      await instrumentation.logEvent(traceId, {
        provider: "google_places",
        endpoint: "places.get",
        estCostUsd: PLACE_DETAILS_PRO_USD_PER_CALL,
        durationMs,
        metadata: {
          discovered_place_id: entry.discoveredPlaceId,
          google_place_id: entry.googlePlaceId,
          field_mask: CONFIRM_FIELD_MASK,
          n_candidates: entry.candidates.length,
          status: match.status,
          best_score: decision.bestScore,
          method: SIMILARITY_METHOD,
          pricing_basis: "list",
        },
      });
    }
  } catch (err) {
    await instrumentation.endTrace(traceId, {
      totalCostUsd: confirmCalls * PLACE_DETAILS_PRO_USD_PER_CALL,
      metadata: {
        outcome: "aborted",
        error: err instanceof Error ? err.message : String(err),
        confirm_calls: confirmCalls,
        outcomes,
        free_tier_note: FREE_TIER_NOTE,
      },
    });
    throw err;
  }

  const finishedAt = now().toISOString();
  const totalEstCostUsd = confirmCalls * PLACE_DETAILS_PRO_USD_PER_CALL;
  await instrumentation.endTrace(traceId, {
    totalCostUsd: totalEstCostUsd,
    metadata: {
      outcome: "completed",
      field_mask: CONFIRM_FIELD_MASK,
      confirm_calls: confirmCalls,
      outcomes,
      collisions,
      method: SIMILARITY_METHOD,
      thresholds: { t_high: T_HIGH, t_low: T_LOW, margin: MARGIN },
      pricing_basis: "list",
      free_tier_note: FREE_TIER_NOTE,
    },
  });

  return {
    traceId,
    confirmCalls,
    totalEstCostUsd,
    outcomes,
    collisions,
    scoreDistribution,
    startedAt,
    finishedAt,
  };
}
