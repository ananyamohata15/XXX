/**
 * Place-fact rules: can this place be visited at all, is it open on THIS
 * weekday, is it wise to be here now, and does it take bookings.
 *
 * Trap classes 1, 2, 3, 4 and 7 from the founder red-pen (XXX-5 comment
 * 10291) all land in this file. Note what is NOT here: fetching. Business
 * status comes from a request-time Google call that lives in
 * src/server/day-grammar/context.ts. This file reads the resulting fact.
 */

import { WEEKDAYS, weekdayOf, type Weekday } from "../../vocabulary";
import {
  advisory,
  contains,
  describePlace,
  orderedSlots,
  placeOf,
  readFact,
  slotLabel,
  spanOf,
  spanOfInterval,
  violation,
} from "../internal";
import type { GrammarContext, GrammarDay, OpenInterval, Violation } from "../types";

const WEEKDAY_LABEL: Record<Weekday, string> = {
  sunday: "Sundays",
  monday: "Mondays",
  tuesday: "Tuesdays",
  wednesday: "Wednesdays",
  thursday: "Thursdays",
  friday: "Fridays",
  saturday: "Saturdays",
};

const describeIntervals = (intervals: OpenInterval[]): string =>
  intervals.map((i) => `${i.open}–${i.close}`).join(", ");

/** Which occurrence of its weekday within the month a date is: 1 = first. */
function ordinalWeekdayOfMonth(date: string): number {
  const day = Number(date.slice(8, 10));
  return Math.floor((day - 1) / 7) + 1;
}

export function checkFacts(day: GrammarDay, ctx: GrammarContext): Violation[] {
  const found: Violation[] = [];
  const weekday = weekdayOf(day.date);

  for (const slot of orderedSlots(day)) {
    const place = placeOf(day, slot);
    if (!place) continue;
    const label = slotLabel(day, slot.id);
    const name = describePlace(place, slot.placeId);
    const slotSpan = spanOf(slot);

    // --- trap 1: permanently closed --------------------------------------
    const status = readFact(place.businessStatus);
    if (status.state === "present" && status.value !== "operational") {
      found.push(
        violation(
          "validity.permanently-closed",
          [slot.id],
          `${label} is ${name}, which is ${status.value.replace("_", " ")}. Recommending a closed place is a trust failure — choose a different place.`,
          { placeId: place.id, businessStatus: status.value },
        ),
      );
    } else if (status.state !== "present") {
      found.push(
        advisory(
          "validity.status-unverified",
          [slot.id],
          `${label} is ${name}; its business status was ${status.state === "absent" ? "looked up and is not published" : "never fetched"}, so we cannot certify it is still trading.`,
          { placeId: place.id, factState: status.state },
        ),
      );
    }

    // --- trap 4: seasonal end date ---------------------------------------
    const seasonal = readFact(place.seasonal);
    if (
      seasonal.state === "present" &&
      (day.date < seasonal.value.startDate || day.date > seasonal.value.endDate)
    ) {
      found.push(
        violation(
          "validity.seasonal-expired",
          [slot.id],
          `${label} is ${name}, which runs ${seasonal.value.startDate} to ${seasonal.value.endDate}; this day is ${day.date}.`,
          {
            placeId: place.id,
            startDate: seasonal.value.startDate,
            endDate: seasonal.value.endDate,
            date: day.date,
          },
        ),
      );
    }

    // --- trap 3: recurrence-rule offerings -------------------------------
    if (slot.requiresOffering !== undefined) {
      const offerings = readFact(place.offerings);
      const offering =
        offerings.state === "present"
          ? (offerings.value.find((o) => o.label === slot.requiresOffering) ?? null)
          : null;
      const ordinal = ordinalWeekdayOfMonth(day.date);
      const matches =
        offering !== null &&
        offering.weekday === weekday &&
        offering.ordinal === ordinal &&
        contains(spanOfInterval(offering.window), slotSpan);
      if (!matches) {
        const expected = offering
          ? `the ${ordinalWord(offering.ordinal)} ${offering.weekday} of the month, ${offering.window.open}–${offering.window.close}`
          : "an offering this place does not publish";
        found.push(
          violation(
            "validity.recurrence-unmet",
            [slot.id],
            `${label} depends on "${slot.requiresOffering}" at ${name}, which runs ${expected}; ${day.date} is the ${ordinalWord(ordinal)} ${weekday} of its month.`,
            {
              placeId: place.id,
              requiresOffering: slot.requiresOffering,
              date: day.date,
              actualOrdinal: ordinal,
              actualWeekday: weekday,
            },
          ),
        );
      }
    }

    // --- trap 2: per-weekday hours ---------------------------------------
    const hours = readFact(place.hours);
    if (hours.state !== "present") {
      found.push(
        advisory(
          "hours.unknown",
          [slot.id],
          `${label} is ${name}; its opening hours were ${hours.state === "absent" ? "looked up and are not published" : "never fetched"}, so this timing is unverified.`,
          { placeId: place.id, factState: hours.state },
        ),
      );
    } else {
      const todays = hours.value[weekday] ?? [];
      if (todays.length === 0) {
        found.push(
          violation(
            "hours.closed-day",
            [slot.id],
            `${label} is ${name}, which is closed on ${WEEKDAY_LABEL[weekday]}; ${day.date} is a ${weekday}.`,
            { placeId: place.id, weekday, date: day.date },
          ),
        );
      } else if (!todays.some((i) => contains(spanOfInterval(i), slotSpan))) {
        found.push(
          violation(
            "hours.outside-open-window",
            [slot.id],
            `${label} runs ${slot.startTime}–${slot.endTime}; ${name} is open ${describeIntervals(todays)} on ${WEEKDAY_LABEL[weekday]}.`,
            {
              placeId: place.id,
              weekday,
              slotStart: slot.startTime,
              slotEnd: slot.endTime,
              open: todays.map((i) => `${i.open}–${i.close}`),
            },
          ),
        );
      }
    }

    // --- hours-compliance is not hours-wisdom ----------------------------
    const category = readFact(place.category);
    if (category.state === "present") {
      const offPeakAfter = ctx.params.offPeakAfter[category.value];
      if (offPeakAfter !== undefined && slot.startTime >= offPeakAfter) {
        found.push(
          advisory(
            "wisdom.off-peak-window",
            [slot.id],
            `${label} puts ${name} at ${slot.startTime}. It is open, but ${category.value.replace("_", " ")} are picked over after ${offPeakAfter} — mornings are the point.`,
            { placeId: place.id, category: category.value, offPeakAfter },
          ),
        );
      }
    }

    // --- trap 7: reservability changes the advice ------------------------
    const reservability = readFact(place.reservability);
    if (reservability.state === "present" && reservability.value === "walk_in_only") {
      found.push(
        advisory(
          "reservability.walk-in-only",
          [slot.id],
          `${name} takes no bookings at ${label}'s time — put your name in and walk the block.`,
          { placeId: place.id, reservability: reservability.value },
        ),
      );
    }
  }

  return found;
}

const ORDINAL_WORDS = ["", "first", "second", "third", "fourth", "fifth"];
function ordinalWord(n: number): string {
  return ORDINAL_WORDS[n] ?? `${n}th`;
}

/** Exported for the boundary tests — the weekday set must stay exhaustive. */
export const ALL_WEEKDAYS = WEEKDAYS;
