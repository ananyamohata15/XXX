/**
 * Deterministic scoring + the seeded exploration term (CP1 §1.1 stage 5,
 * §1.6). Pure: same candidates + same seed → same scores, always. No LLM
 * touches a number here.
 *
 * The exploration term is the engine's ONLY source of run-to-run variety
 * (Sonnet 5 has no sampling knobs — API fact, CP1), so it is designed to
 * be argued with: a bounded ±8% jitter from a named PRNG, keyed by
 * (seed, placeId), reproducible from the trace's logged seed.
 */

import { fnv1a, mulberry32, personaIdentity } from "@/shared/dice";
import { categoryAffinity, type Persona } from "@/shared/persona";
import type { PriceRange } from "@/shared/timeline";
import type { Candidate } from "./types";

// Re-exported so this module's many existing importers keep working after the
// primitives moved to `@/shared/dice` on their third occurrence (CLAUDE.md:
// extract on the third, not the first).
export { fnv1a, mulberry32 };

export const SCORE_WEIGHTS = {
  /** Slightly under lens+affinity: rating volume partly double-counts
   * fame, and fame must not drown the persona axes. */
  ratingQuality: 0.3,
  personaAffinity: 0.25,
  priceFit: 0.15,
  /** The icons-vs-corners identity axis — 10294 demands it materially
   * reorders, so its ceiling must exceed the jitter's maximum swing. */
  lensFit: 0.2,
  freshness: 0.1,
} as const;

/**
 * Exploration bound (CP1 §1.6, recalibrated at CP3): ±4%, so the
 * maximum pairwise swing (0.08) stays below a strong lens signal
 * (~0.12 on a famous-vs-hidden pair) — jitter breaks long-tail ties,
 * it never inverts a preference the persona actually expressed.
 */
export const JITTER_BOUND = 0.04;

/** Bayesian shrinkage prior: a place with few ratings drifts to 4.0. */
const PRIOR_COUNT = 25;
const PRIOR_MEAN = 4.0;


function ratingQuality(candidate: Candidate): number {
  if (candidate.rating === null) return 0.35; // unrated: below-average prior
  const v = candidate.userRatingCount ?? 0;
  const shrunk =
    (v / (v + PRIOR_COUNT)) * candidate.rating +
    (PRIOR_COUNT / (v + PRIOR_COUNT)) * PRIOR_MEAN;
  return Math.min(1, Math.max(0, (shrunk - 3) / 2)); // 3.0→0, 5.0→1
}

function priceFit(candidate: Candidate, band: PriceRange | null): number {
  if (band === null) return 0.5;
  const fact = candidate.place.priceRange;
  if (fact === undefined || fact.status !== "present") return 0.5;
  const mid = (fact.value.min + fact.value.max) / 2;
  // A single stop should not eat the band; comfortable is ≤ a third of it.
  const comfortable = band.max / 3;
  if (mid <= comfortable) return 1;
  if (mid >= band.max) return 0;
  return 1 - (mid - comfortable) / (band.max - comfortable);
}

/**
 * icons-vs-corners must materially reorder (10294): icons reads rating
 * volume as fame and wants it; corners wants the hidden gem and inverts
 * it. log10 scale: 10 ratings ≈ 0.25, 10K ≈ 1.
 */
function lensFit(candidate: Candidate, persona: Persona): number {
  const count = candidate.userRatingCount ?? 0;
  const fame = Math.min(1, Math.log10(count + 1) / 4);
  if (persona.lens === "icons") return fame;
  if (persona.lens === "corners") return 1 - fame;
  return 0.5 + (fame - 0.5) * 0.3; // icons_with_corners: mild fame lean
}

/**
 * Verified facts beat honest absence — this is where (c)'s fallback
 * bites. The middle rung is the discovery-era link: a place Google
 * surfaced in Session 4's ranked searches is a real, findable business,
 * which is the only pre-fetch quality signal the pool carries (recorded
 * CP2 finding: E3 owes the pool a popularity signal; until then the
 * long-tail ties inside a category are broken by jitter alone).
 */
const freshness = (c: Candidate): number =>
  c.detailsFetched ? 1 : c.googlePlaceId !== null ? 0.6 : 0.4;

/**
 * The exploration term is persona-local (10294 point 3: users who start
 * identical should diverge): the jitter PRNG is keyed by persona as well
 * as seed and venue, so two similar personas on the same date break
 * their long-tail ties differently instead of in lockstep. Found the
 * hard way — the first CP3 matrix ran a fixed exam seed and two
 * corners personas collapsed to 0.67 venue overlap.
 *
 * Now `personaIdentity` (Session 12 CP1): this file and `arc.ts` each
 * maintained their own identity hash over overlapping-but-unequal field sets,
 * so "the same persona" meant two different things depending on which
 * selector you were standing in. One hash, all five interview dimensions.
 * Re-baselines every seeded outcome — ruled acceptable at CP1, because this
 * session's matrix stands on the standing gates rather than on deltas against
 * prior matrices.
 */
export const personaFingerprint = personaIdentity;

export function scoreCandidate(
  candidate: Candidate,
  persona: Persona,
  budgetBand: PriceRange | null,
  seed: number,
): number {
  const w = SCORE_WEIGHTS;
  const base =
    w.ratingQuality * ratingQuality(candidate) +
    w.personaAffinity * categoryAffinity(persona, candidate.category) +
    w.priceFit * priceFit(candidate, budgetBand) +
    w.lensFit * lensFit(candidate, persona) +
    w.freshness * freshness(candidate);
  const jitter =
    (mulberry32(seed ^ fnv1a(candidate.place.id) ^ personaFingerprint(persona))() *
      2 -
      1) *
    JITTER_BOUND;
  return base + jitter;
}

/**
 * One Candidate per place — the highest-scoring of its categories wins.
 *
 * `retrieveCandidates` emits one Candidate per (place, CATEGORY), because a
 * place legitimately maps to several: Brazen Head Irish Pub is a real
 * `restaurants` row AND a real `nightlife_bars` row. 79 Toronto places carry
 * more than one, 45 of them straddling the food boundary. Composition needs
 * exactly one answer to "what is this place", so the duplicates collapse —
 * and WHICH one survives decides what role the place can ever play in a day.
 *
 * This used to be `new Map(scored.map(...))` at `engine.ts:292`. Because
 * `scored` is score-DESCENDING, last-wins handed every multi-category place
 * to its **worst**-fitting category: for a food-first persona, Brazen Head
 * entered composition as a bar and was unreachable by any meal. Nothing was
 * wrong with the facts — Session 11 filed this as the pool's facts
 * disagreeing, and they do not. It was a collision rule nobody chose on
 * purpose (Session 12 CP2 ruling 3).
 *
 * Highest-score-wins is the rule that means something: a place competes in
 * the category it best fits THIS persona, which is what the score already
 * encodes.
 */
export function collapseByPlace(scored: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const c of scored) {
    const held = best.get(c.place.id);
    if (held === undefined || c.score > held.score) best.set(c.place.id, c);
  }
  return [...best.values()];
}

export function scoreAll(
  candidates: Candidate[],
  persona: Persona,
  budgetBand: PriceRange | null,
  seed: number,
): Candidate[] {
  return candidates
    .map((c) => ({ ...c, score: scoreCandidate(c, persona, budgetBand, seed) }))
    .sort(
      (a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id),
    );
}
