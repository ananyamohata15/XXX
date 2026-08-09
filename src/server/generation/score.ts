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

import { categoryAffinity, type Persona } from "@/shared/persona";
import type { PriceRange } from "@/shared/timeline";
import type { Candidate } from "./types";

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

/** mulberry32 — tiny, seedable, good enough for jitter. Deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string — stable placeId → int for per-candidate seeds. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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
 */
export function personaFingerprint(persona: Persona): number {
  return fnv1a(
    `${persona.pace}|${persona.gravity.join(",")}|${persona.foodCourage}|${persona.structure}|${persona.lens}`,
  );
}

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
