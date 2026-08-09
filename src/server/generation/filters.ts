/**
 * Hard filters (CP1 §1.1 stage 4) — facts only, judgment nowhere.
 *
 * Every predicate here is the day-grammar's own logic re-exported
 * (predicates.ts), so a candidate that survives cannot fail the matching
 * rule for the same window. Honest-absence discipline: unknown facts do
 * NOT eliminate a candidate — the validator reports absence as
 * advisories, and scoring prefers verified candidates — only a known-bad
 * fact is a hard no.
 */

import {
  businessStatusVerdict,
  canHoldVisit,
  seasonallyValidOn,
  type Span,
} from "@/shared/day-grammar/predicates";
import { weekdayOf } from "@/shared/vocabulary";
import type { Candidate } from "./types";

export interface FilterOutcome {
  kept: Candidate[];
  dropped: { placeId: string; reason: string }[];
}

/**
 * `window` is the outermost span a visit could occupy (the day span at
 * shortlist time; an intent's window at menu time); `dwellMinutes` the
 * shortest visit worth making (the category minimum).
 */
export function hardFilter(
  candidates: Candidate[],
  date: string,
  window: Span,
  dwellFor: (c: Candidate) => number,
): FilterOutcome {
  const weekday = weekdayOf(date);
  const kept: Candidate[] = [];
  const dropped: { placeId: string; reason: string }[] = [];

  for (const candidate of candidates) {
    if (businessStatusVerdict(candidate.place.businessStatus) === "closed") {
      dropped.push({ placeId: candidate.place.id, reason: "not operational" });
      continue;
    }
    if (!seasonallyValidOn(candidate.place.seasonal, date)) {
      dropped.push({ placeId: candidate.place.id, reason: "out of season" });
      continue;
    }
    const holds = canHoldVisit(
      candidate.place.hours,
      weekday,
      window,
      dwellFor(candidate),
    );
    if (holds === false) {
      dropped.push({
        placeId: candidate.place.id,
        reason: "hours cannot hold the visit",
      });
      continue;
    }
    kept.push(candidate); // true, or null = hours unknown (honest absence)
  }
  return { kept, dropped };
}
