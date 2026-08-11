/**
 * validateDay — the day-grammar gate (XXX-5, epic layer 2).
 *
 * Pure and deterministic: same input, identical output, every time. No
 * clock, no locale, no randomness, no I/O. A generated day that returns
 * any `severity: "violation"` is rejected and regenerated before a user
 * sees it; advisories ride along and become concierge notes, prep-kit
 * lines, and XXX-29 offers.
 *
 * The rule families run in a fixed order and the result is sorted, so the
 * output is a stable document rather than an incidental one — the
 * regeneration prompt and the fixture assertions both depend on that.
 */

import { timeToMinutes } from "../time";
import { orderedSlots } from "./internal";
import { checkDwell } from "./rules/dwell";
import { checkEnvironment } from "./rules/environment";
import { checkExposure } from "./rules/exposure";
import { checkFacts } from "./rules/facts";
import { checkMoney } from "./rules/money";
import { checkMovement } from "./rules/movement";
import { checkRhythm } from "./rules/rhythm";
import { checkShape } from "./rules/shape";
import type { GrammarContext, GrammarDay, Violation } from "./types";

type RuleFamily = (day: GrammarDay, ctx: GrammarContext) => Violation[];

/** Fixed order. Sorting makes it cosmetic, but determinism starts here. */
const FAMILIES: RuleFamily[] = [
  checkShape,
  checkFacts,
  checkDwell,
  checkEnvironment,
  checkExposure,
  checkMovement,
  checkRhythm,
  checkMoney,
];

export function validateDay(
  day: GrammarDay,
  ctx: GrammarContext,
): Violation[] {
  const slotOrder = new Map(
    orderedSlots(day).map((slot, index) => [slot.id, index]),
  );
  /** Day-level findings sort last — slot findings read top-down first. */
  const anchorIndex = (v: Violation): number =>
    v.slotIds.length === 0
      ? Number.MAX_SAFE_INTEGER
      : Math.min(...v.slotIds.map((id) => slotOrder.get(id) ?? Number.MAX_SAFE_INTEGER));

  const found = FAMILIES.flatMap((family) => family(day, ctx));

  return found.sort(
    (a, b) =>
      anchorIndex(a) - anchorIndex(b) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.slotIds.join(",").localeCompare(b.slotIds.join(",")) ||
      a.message.localeCompare(b.message),
  );
}

/** Convenience for callers that only need the gate's yes/no. */
export const hasViolations = (found: readonly Violation[]): boolean =>
  found.some((v) => v.severity === "violation");

export const violationsOnly = (found: readonly Violation[]): Violation[] =>
  found.filter((v) => v.severity === "violation");

export const advisoriesOnly = (found: readonly Violation[]): Violation[] =>
  found.filter((v) => v.severity === "advisory");

/**
 * Structural sanity a day must pass before the rules mean anything.
 * Deliberately separate from validateDay: these are malformed-input
 * conditions (a slot pointing at a place that is not in the day), not
 * grammar findings, and they should fail loudly at the boundary.
 */
export function assertWellFormed(day: GrammarDay): void {
  for (const slot of day.slots) {
    if (!day.places[slot.placeId]) {
      throw new Error(
        `day ${day.id}: slot ${slot.id} references unknown place "${slot.placeId}"`,
      );
    }
  }
  if (timeToMinutes(day.dayEnd) <= timeToMinutes(day.dayStart)) {
    throw new Error(
      `day ${day.id}: dayEnd ${day.dayEnd} must be after dayStart ${day.dayStart}`,
    );
  }
  const ids = new Set(day.slots.map((s) => s.id));
  if (ids.size !== day.slots.length) {
    throw new Error(`day ${day.id}: slot ids must be unique`);
  }
}
