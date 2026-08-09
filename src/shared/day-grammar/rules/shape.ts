/**
 * Day shape: the midnight boundary and the lodging-shaped hole.
 *
 * Both rules here exist because of a limit somewhere else in the system,
 * and both say so rather than pretending the limit is a preference.
 *
 * Midnight: the core-domain migration constrains slots with
 * `slots_time_interval_valid (end_time > start_time)`, deferred in Session
 * 2 "until E4 meets late-night itineraries". This is that meeting. The
 * validator refuses to certify what the database cannot store, and names
 * the days that press against the boundary so late-night itineraries are
 * visible rather than silently truncated.
 *
 * Lodging: trip circumstance the schema does not carry yet (trap class 5).
 * A "hotel reset" gap is only valid if the hotel is near, and we cannot
 * know that. So we report the absence — we do not invent a column, and we
 * do not quietly bless the gap.
 */

import { timeToMinutes } from "../../time";
import {
  advisory,
  describePlace,
  orderedSlots,
  placeOf,
  slotLabel,
  violation,
} from "../internal";
import type { GrammarContext, GrammarDay, Violation } from "../types";

export function checkShape(day: GrammarDay, ctx: GrammarContext): Violation[] {
  const found: Violation[] = [];
  const slots = orderedSlots(day);

  // --- midnight ------------------------------------------------------------
  for (const slot of slots) {
    if (timeToMinutes(slot.endTime) > timeToMinutes(slot.startTime)) continue;
    found.push(
      violation(
        "midnight.slot-inverted",
        [slot.id],
        `${slotLabel(day, slot.id)} runs ${slot.startTime}–${slot.endTime}, which ends at or before it starts. Slots cannot cross midnight — the schema will not store it.`,
        {
          slotId: slot.id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          constraint: "slots_time_interval_valid",
        },
      ),
    );
  }

  const last = slots[slots.length - 1];
  if (last !== undefined) {
    const tail = ctx.params.structure.lateNightTail;
    const endsLate = last.endTime >= tail;
    const dayEndsLate = day.dayEnd >= tail;
    if (endsLate || dayEndsLate) {
      found.push(
        advisory(
          "midnight.late-night-tail",
          endsLate ? [last.id] : [],
          `This day is still running at ${endsLate ? last.endTime : day.dayEnd}. Anything past midnight cannot be stored as a slot today — the day would have to be split.`,
          {
            lastSlotEnd: last.endTime,
            dayEnd: day.dayEnd,
            lateNightTail: tail,
          },
        ),
      );
    }
  }

  // --- lodging-dependent reset gaps ---------------------------------------
  if (ctx.lodging === null) {
    const required = ctx.params.structure.resetGapMinutes;
    for (let i = 1; i < slots.length; i += 1) {
      const clock =
        timeToMinutes(slots[i].startTime) - timeToMinutes(slots[i - 1].endTime);
      // Time spent travelling is not time spent resting. A two-hour drive
      // to Niagara is a leg, not a hotel reset, and reading it as one
      // produced an advisory on every excursion.
      const from = placeOf(day, slots[i - 1]);
      const to = placeOf(day, slots[i]);
      const travelMinutes =
        from?.coords && to?.coords
          ? (ctx.travel.estimate({
              origin: from.coords,
              destination: to.coords,
              mode: slots[i].arriveBy,
              departureLocal: slots[i - 1].endTime,
            })?.minutes ?? 0)
          : 0;
      const gap = clock - travelMinutes;
      if (gap < required) continue;
      found.push(
        advisory(
          "structure.reset-gap-without-lodging",
          [slots[i - 1].id, slots[i].id],
          `There is a ${Math.round((gap / 60) * 10) / 10}-hour gap after ${describePlace(from, slots[i - 1].placeId)} with nothing in it. That reads as a hotel reset, but no lodging location is known for this trip, so it cannot be confirmed as one.`,
          {
            gapMinutes: gap,
            clockMinutes: clock,
            travelMinutes,
            resetGapMinutes: required,
            afterSlotId: slots[i - 1].id,
            beforeSlotId: slots[i].id,
          },
        ),
      );
    }
  }

  return found;
}
