/**
 * Candidate-level predicates for the generation engine (XXX-5 Session 9,
 * CP1 ruling 6: re-export preferred over probe-day fallback).
 *
 * These are the validator's own hour/validity readings, re-expressed as
 * pure per-place questions the engine's hard filters can ask BEFORE a day
 * exists. Nothing here is new logic: `contains`/`spanOfInterval` are the
 * exact helpers rules/facts.ts judges slots with, so a candidate passing
 * these predicates cannot fail the corresponding rule for the same
 * window. The validator remains the gate; these prevent composing days
 * that would obviously die there.
 */

import { contains, readFact, spanOfInterval, type Span } from "./internal";
import type {
  BusinessStatus,
  GrammarFact,
  HoursByWeekday,
  OpenInterval,
  SeasonalRange,
} from "./types";
import type { Weekday } from "../vocabulary";

export type { Span } from "./internal";
export { readFact } from "./internal";

/**
 * Trap 1 as a predicate. `unknown` is honest absence — the caller decides
 * whether unverified candidates stay eligible (they do, carrying the
 * validity.status-unverified advisory) — only a *known* non-operational
 * status is a hard no.
 */
export function businessStatusVerdict(
  fact: GrammarFact<BusinessStatus> | undefined,
): "operational" | "closed" | "unknown" {
  const status = readFact(fact);
  if (status.state !== "present") return "unknown";
  return status.value === "operational" ? "operational" : "closed";
}

/** Trap 2: the open intervals for one weekday; null = hours unknown. */
export function openIntervalsOn(
  fact: GrammarFact<HoursByWeekday> | undefined,
  weekday: Weekday,
): OpenInterval[] | null {
  const hours = readFact(fact);
  if (hours.state !== "present") return null;
  return hours.value[weekday] ?? [];
}

/**
 * Can this place hold a `dwellMinutes` visit inside `window` on this
 * weekday? The containment test is the validator's own (inclusive close),
 * so passing here means rule hours.outside-open-window cannot fire for a
 * slot placed accordingly. Unknown hours return null (honest tri-state).
 */
export function canHoldVisit(
  fact: GrammarFact<HoursByWeekday> | undefined,
  weekday: Weekday,
  window: Span,
  dwellMinutes: number,
): boolean | null {
  const intervals = openIntervalsOn(fact, weekday);
  if (intervals === null) return null;
  return intervals.some((interval) => {
    const open = spanOfInterval(interval);
    const start = Math.max(open.start, window.start);
    const end = Math.min(open.end, window.end);
    return (
      end - start >= dwellMinutes &&
      contains(open, { start, end: start + dwellMinutes })
    );
  });
}

/**
 * The earliest minute a `dwellMinutes` visit can begin at or after
 * `earliest`, honoring hours on that weekday and an outer window.
 * null = impossible (or hours unknown — callers separate via canHoldVisit).
 */
export function earliestVisitStart(
  fact: GrammarFact<HoursByWeekday> | undefined,
  weekday: Weekday,
  earliest: number,
  windowEnd: number,
  dwellMinutes: number,
): number | null {
  const intervals = openIntervalsOn(fact, weekday);
  if (intervals === null || intervals.length === 0) return null;
  let best: number | null = null;
  for (const interval of intervals) {
    const open = spanOfInterval(interval);
    const start = Math.max(open.start, earliest);
    if (start + dwellMinutes <= Math.min(open.end, windowEnd)) {
      best = best === null ? start : Math.min(best, start);
    }
  }
  return best;
}

/** Trap 4 as a predicate: is `date` inside the seasonal range (if any)? */
export function seasonallyValidOn(
  fact: GrammarFact<SeasonalRange> | undefined,
  date: string,
): boolean {
  const seasonal = readFact(fact);
  if (seasonal.state !== "present") return true;
  return date >= seasonal.value.startDate && date <= seasonal.value.endDate;
}
