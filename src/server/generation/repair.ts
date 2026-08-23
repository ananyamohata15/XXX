/**
 * The grammar loop (CP1 §1.1 stage 8). validateDay is the gate; this
 * file is the bounded path back through it. Three validation passes
 * (initial + two repairs), then honest failure — a day that cannot be
 * made legal is surfaced with its violations narrated, never shipped.
 *
 * Repair routes violations by what caused them:
 *  - place-caused (closed, wrong hours, out of season, bad dwell,
 *    weather/daylight conflicts on that venue) → the candidate is STRUCK
 *    from its menu and selection re-runs without it; the violation
 *    messages are the feedback channel (`regenerationFeedback` feeds the
 *    Step 3 LLM the same strings).
 *  - time-caused (infeasible travel, late anchor arrival, meal window
 *    misses) → recompose with the day's global slack raised, shifting
 *    starts later and shrinking dwell toward minima.
 */

import type { RuleId, Violation } from "@/shared/day-grammar/types";

/** Rules whose fix is "different venue", keyed for the strike router. */
const PLACE_CAUSED: ReadonlySet<RuleId> = new Set<RuleId>([
  "validity.permanently-closed",
  "validity.seasonal-expired",
  "validity.recurrence-unmet",
  "hours.closed-day",
  "hours.outside-open-window",
  "dwell.overstay",
  "dwell.understay",
  "weather.outdoor-in-adverse-window",
  "daylight.outdoor-after-dark",
  /**
   * XXX-43. A day seating a category the traveller refused is fixed by
   * choosing a DIFFERENT VENUE, so it belongs in this set.
   *
   * Adding it here is not optional bookkeeping. `planRepair` routes anything
   * not listed to `plan.unroutable`, which burns all three validation passes
   * without progress and FAILS the day. The rule would be perfectly correct
   * and the generation would still die — the constraint would read as "your
   * day cannot be built" rather than "not that bar, this one".
   *
   * This set is a closed `ReadonlySet<RuleId>`: the fifth instance of the
   * pattern that has cost this project four sessions — a list that enumerates
   * part of a vocabulary and goes stale when the vocabulary grows.
   */
  "constraint.excluded-category",
]);

export interface RepairPlan {
  /** slotId → struck placeIds accumulate across passes. */
  strikes: Map<string, Set<string>>;
  /** Extra minutes of travel slack the next composition adds per leg. */
  slackMinutes: number;
  /** Violations neither router understands — exhaustion comes early. */
  unroutable: Violation[];
}

export function planRepair(
  violations: Violation[],
  slotPlace: (slotId: string) => string | null,
  /** budget.over-band is day-level: the fix is a cheaper venue, and the
   * priciest concierge pick is the one to strike. */
  priciestConcierge: () => { slotId: string; placeId: string } | null,
  previous?: RepairPlan,
): RepairPlan {
  const plan: RepairPlan = {
    strikes: new Map(previous?.strikes ?? []),
    slackMinutes: previous?.slackMinutes ?? 0,
    unroutable: [],
  };
  for (const violation of violations) {
    if (violation.ruleId === "budget.over-band") {
      const target = priciestConcierge();
      if (target === null) {
        plan.unroutable.push(violation);
        continue;
      }
      const struck = plan.strikes.get(target.slotId) ?? new Set<string>();
      struck.add(target.placeId);
      plan.strikes.set(target.slotId, struck);
    } else if (PLACE_CAUSED.has(violation.ruleId)) {
      for (const slotId of violation.slotIds) {
        const placeId = slotPlace(slotId);
        if (placeId === null) continue;
        const struck = plan.strikes.get(slotId) ?? new Set<string>();
        struck.add(placeId);
        plan.strikes.set(slotId, struck);
      }
    } else if (
      violation.ruleId === "travel.infeasible" ||
      violation.ruleId === "anchor.arrival-late" ||
      violation.ruleId === "anchor.egress-buffer-short" ||
      violation.ruleId === "meal.outside-pattern-window" ||
      violation.ruleId === "pacing.food-stops-exceeded"
    ) {
      // Deterministic time repair: raise slack. The composer places
      // slots at the earliest legal minute, so added slack absorbs the
      // shortfall the violation measured (data.shortfallMinutes when
      // present, else a 10-minute step).
      const shortfall =
        typeof violation.data.shortfallMinutes === "number"
          ? violation.data.shortfallMinutes
          : 10;
      plan.slackMinutes = Math.max(plan.slackMinutes + shortfall, 10);
    } else {
      plan.unroutable.push(violation);
    }
  }
  return plan;
}

export const MAX_VALIDATION_PASSES = 3;
