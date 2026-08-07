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

    const range = ctx.params.dwellMinutes[category.value];
    const minutes = durationOf(spanOf(slot));

    if (minutes > range.max) {
      found.push(
        violation(
          "dwell.overstay",
          [slot.id],
          `${label} gives ${name} ${minutes} minutes; ${minutes - range.max} more than the ${range.max}-minute ceiling for ${category.value.replace("_", " ")} (typical stay ${range.typical}).`,
          {
            placeId: place.id,
            category: category.value,
            minutes,
            maxMinutes: range.max,
            typicalMinutes: range.typical,
          },
        ),
      );
    } else if (minutes < range.min) {
      found.push(
        violation(
          "dwell.understay",
          [slot.id],
          `${label} gives ${name} only ${minutes} minutes; ${category.value.replace("_", " ")} need at least ${range.min} (typical stay ${range.typical}).`,
          {
            placeId: place.id,
            category: category.value,
            minutes,
            minMinutes: range.min,
            typicalMinutes: range.typical,
          },
        ),
      );
    }
  }

  return found;
}
