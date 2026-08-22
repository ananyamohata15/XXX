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
 *
 * **`window` may be PER-CANDIDATE** (XXX-40, Session 14 CP0). A single span
 * for a whole menu is wrong whenever the span depends on the candidate, and
 * the dusk clamp is exactly that case: `buildMenus` used to narrow the WHOLE
 * intent to dusk if ANY of its categories was outdoor, which quietly deleted
 * every indoor option from the menu.
 *
 * Measured, on `persona-shopper` at seed 42: the close intent's window was
 * 20:15–22:00 over `[scenic_viewpoints, nightlife_bars, historic_sites,
 * restaurants]`. Clamped whole, it became 20:15–**20:30** — fifteen minutes,
 * which only `scenic_viewpoints` (min dwell 15) can hold. Bars (45), historic
 * sites (30) and restaurants (45) were all filtered out by an outdoor rule
 * that has no business applying to them, so the menu came back **four
 * viewpoints and nothing else**. A 21:00 bar close was legal and structurally
 * unreachable.
 *
 * Same shape as the dead `Retail > Farmers Market` rule: a constraint applied
 * to a SET when it is a property of each MEMBER.
 */
export function hardFilter(
  candidates: Candidate[],
  date: string,
  window: Span | ((c: Candidate) => Span),
  dwellFor: (c: Candidate) => number,
): FilterOutcome {
  const weekday = weekdayOf(date);
  const kept: Candidate[] = [];
  const dropped: { placeId: string; reason: string }[] = [];
  const windowFor =
    typeof window === "function" ? window : (): Span => window;

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
      windowFor(candidate),
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
