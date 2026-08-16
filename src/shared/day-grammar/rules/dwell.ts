/**
 * Dwell plausibility — golden-set lesson #1, the day that put six hours
 * in a ninety-minute venue and was still perfectly time-valid.
 *
 * Applied only to origin='concierge' slots. The user owns their own
 * commitments; we do not tell someone their dinner booking is too long.
 */

import {
  advisory,
  describePlace,
  durationOf,
  orderedSlots,
  placeOf,
  readFact,
  slotLabel,
  spanOf,
  violation,
} from "../internal";
import type { GrammarContext, GrammarDay, Violation } from "../types";

export function checkDwell(day: GrammarDay, ctx: GrammarContext): Violation[] {
  const found: Violation[] = [];

  for (const slot of orderedSlots(day)) {
    if (slot.origin === "user") continue;
    const place = placeOf(day, slot);
    if (!place) continue;

    const label = slotLabel(day, slot.id);
    const name = describePlace(place, slot.placeId);
    const category = readFact(place.category);

    if (category.state !== "present") {
      found.push(
        advisory(
          "dwell.category-unknown",
          [slot.id],
          `${label} is ${name}, which has no mapped category, so its ${durationOf(spanOf(slot))}-minute stay could not be checked for plausibility.`,
          { placeId: place.id, factState: category.state },
        ),
      );
      continue;
    }

    /**
     * A COMPOSITE BLOCK is governed by its own curated range, not by the
     * category table (XXX-38, Session 14 CP1 — a ruled OWNER SWAP).
     *
     * `parks.max` is 150 minutes, written for an afternoon in a park. Golden
     * Day 7's centre is eight hours on the Toronto Islands, containing named
     * micro-activities — so the founder's own verified day would be REJECTED
     * by a ceiling that was never about it. The category table is not wrong;
     * it is answering a different question.
     *
     * The swap is not an exemption. `dwell.overstay` still fires, against the
     * `ExperienceSpec`'s own max: a composite anchor is bounded by CURATION
     * rather than unbounded. And it is recorded as a ruling because an
     * unrecorded LOOSENING is the same offence as an unrecorded tightening —
     * the standard `TEMPLATE_INVARIANTS.lastStep` cost this codebase once.
     */
    const categoryRange = ctx.params.dwellMinutes[category.value];
    const composite = slot.compositeDwell !== undefined;
    const range: { min: number; max: number } =
      slot.compositeDwell ?? categoryRange;
    const minutes = durationOf(spanOf(slot));

    if (minutes > range.max) {
      found.push(
        violation(
          "dwell.overstay",
          [slot.id],
          composite
            ? `${label} gives ${name} ${minutes} minutes; ${minutes - range.max} more than the ${range.max}-minute ceiling this experience declares for its composite block.`
            : `${label} gives ${name} ${minutes} minutes; ${minutes - range.max} more than the ${range.max}-minute ceiling for ${category.value.replace("_", " ")} (typical stay ${categoryRange.typical}).`,
          {
            placeId: place.id,
            category: category.value,
            minutes,
            maxMinutes: range.max,
            // The bound's OWNER, so a reader of the finding knows which
            // number was consulted rather than assuming the category table.
            boundedBy: composite ? "composite_block" : "category",
            ...(composite ? {} : { typicalMinutes: categoryRange.typical }),
          },
        ),
      );
    } else if (minutes < range.min) {
      found.push(
        violation(
          "dwell.understay",
          [slot.id],
          composite
            ? `${label} gives ${name} only ${minutes} minutes; this experience's composite block needs at least ${range.min}.`
            : `${label} gives ${name} only ${minutes} minutes; ${category.value.replace("_", " ")} need at least ${range.min} (typical stay ${categoryRange.typical}).`,
          {
            placeId: place.id,
            category: category.value,
            minutes,
            minMinutes: range.min,
            boundedBy: composite ? "composite_block" : "category",
            ...(composite ? {} : { typicalMinutes: categoryRange.typical }),
          },
        ),
      );
    }
  }

  return found;
}
