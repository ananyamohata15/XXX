/**
 * Daylight and weather — the two environmental facts that decide whether
 * an outdoor slot is a good idea (XXX-5 comment 10290, refinements 1 and
 * 3).
 *
 * Both inputs are consumed, never recomputed: daylight comes from the
 * computed ephemeris (Tier 1, deterministic, free) and the weather windows
 * come from Session 6's deriveSchedulingWindows(). This file contains no
 * threshold of its own — WINDOW_PARAMS already owns those.
 */

import { timeToMinutes } from "../../time";
import {
  advisory,
  describePlace,
  durationOf,
  orderedSlots,
  overlaps,
  placeOf,
  slotLabel,
  spanOf,
  violation,
  type Span,
} from "../internal";
import type { LocalTimeRange } from "../../scheduling-windows";
import type { GrammarContext, GrammarDay, Violation } from "../types";

const spanOfRange = (r: LocalTimeRange): Span => ({
  start: timeToMinutes(r.startLocal),
  end: timeToMinutes(r.endLocal),
});

export function checkEnvironment(
  day: GrammarDay,
  ctx: GrammarContext,
): Violation[] {
  const found: Violation[] = [];
  const slots = orderedSlots(day);
  const outdoorSlots = slots.filter(
    (s) => placeOf(day, s)?.tags.outdoor === true,
  );

  // --- daylight -----------------------------------------------------------
  if (ctx.daylight === null) {
    if (outdoorSlots.length > 0) {
      found.push(
        advisory(
          "weather.unknown",
          [],
          `This day has ${outdoorSlots.length} outdoor stop${outdoorSlots.length === 1 ? "" : "s"} and no daylight or weather context, so neither could be checked.`,
          { outdoorSlotCount: outdoorSlots.length, missing: "daylight" },
        ),
      );
    }
  } else {
    const dawn = timeToMinutes(ctx.daylight.civilDawnLocal);
    const dusk = timeToMinutes(ctx.daylight.civilDuskLocal);
    const sunrise = timeToMinutes(ctx.daylight.sunriseLocal);
    const sunset = timeToMinutes(ctx.daylight.sunsetLocal);
    const goldenAm: Span = {
      start: sunrise,
      end: timeToMinutes(ctx.daylight.goldenHourAmEndLocal),
    };
    const goldenPm: Span = {
      start: timeToMinutes(ctx.daylight.goldenHourPmStartLocal),
      end: sunset,
    };

    for (const slot of outdoorSlots) {
      const span = spanOf(slot);
      const place = placeOf(day, slot);
      const label = slotLabel(day, slot.id);
      const name = describePlace(place, slot.placeId);

      // Dark is civil dusk, not sunset — twilight is dim, not dark.
      if (span.end > dusk || span.start < dawn) {
        found.push(
          violation(
            "daylight.outdoor-after-dark",
            [slot.id],
            `${label} is outdoors at ${name} until ${slot.endTime}; the light is gone at ${ctx.daylight.civilDuskLocal} on ${day.date} (sunset ${ctx.daylight.sunsetLocal}).`,
            {
              placeId: slot.placeId,
              slotEnd: slot.endTime,
              civilDusk: ctx.daylight.civilDuskLocal,
              sunset: ctx.daylight.sunsetLocal,
            },
          ),
        );
      } else if (span.end > sunset) {
        found.push(
          advisory(
            "daylight.outdoor-in-twilight",
            [slot.id],
            `${label} runs ${Math.round(span.end - sunset)} minutes past sunset (${ctx.daylight.sunsetLocal}) at ${name} — twilight, not darkness, but the views go first.`,
            {
              placeId: slot.placeId,
              minutesPastSunset: span.end - sunset,
              sunset: ctx.daylight.sunsetLocal,
            },
          ),
        );
      }

      if (
        place?.tags.goldenHourAffine === true &&
        !overlaps(span, goldenAm) &&
        !overlaps(span, goldenPm)
      ) {
        found.push(
          advisory(
            "daylight.golden-hour-missed",
            [slot.id],
            `${name} is at its best in golden light (${ctx.daylight.goldenHourPmStartLocal}–${ctx.daylight.sunsetLocal}); ${label} sits at ${slot.startTime}–${slot.endTime}.`,
            {
              placeId: slot.placeId,
              goldenHourPmStart: ctx.daylight.goldenHourPmStartLocal,
              goldenHourAmEnd: ctx.daylight.goldenHourAmEndLocal,
            },
          ),
        );
      }
    }
  }

  // --- weather ------------------------------------------------------------
  if (ctx.windows === null) {
    if (outdoorSlots.length > 0 && ctx.daylight !== null) {
      found.push(
        advisory(
          "weather.unknown",
          [],
          `No weather forecast is stored for ${day.date} — beyond the forecast horizon — so the ${outdoorSlots.length} outdoor stop${outdoorSlots.length === 1 ? "" : "s"} could not be weather-checked.`,
          { date: day.date, outdoorSlotCount: outdoorSlots.length },
        ),
      );
    }
    return found;
  }

  const windows = ctx.windows;
  const adverse: { kind: string; span: Span }[] = [
    ...windows.rainWindows.map((r) => ({ kind: "rain", span: spanOfRange(r) })),
    ...windows.heatAvoidWindows.map((r) => ({ kind: "heat", span: spanOfRange(r) })),
    ...windows.coldAvoidWindows.map((r) => ({ kind: "cold", span: spanOfRange(r) })),
    ...windows.aqiUnhealthyWindows.map((r) => ({
      kind: "unhealthy air",
      span: spanOfRange(r),
    })),
  ];
  const friendly = windows.outdoorFriendlyWindows.map(spanOfRange);

  for (const slot of outdoorSlots) {
    const span = spanOf(slot);
    const hits = adverse.filter((a) => overlaps(span, a.span));
    if (hits.length === 0) continue;

    const kinds = [...new Set(hits.map((h) => h.kind))].sort();
    const label = slotLabel(day, slot.id);
    const name = describePlace(placeOf(day, slot), slot.placeId);
    const needed = durationOf(span);

    // Conditional severity — and this is what keeps regeneration
    // terminating. Rejecting an outdoor slot for rain when it rains all
    // day would loop forever, so it is only a violation when the day has
    // somewhere better to put it.
    const refuge = friendly.find((f) => durationOf(f) >= needed);

    if (refuge) {
      found.push(
        violation(
          "weather.outdoor-in-adverse-window",
          [slot.id],
          `${label} is outdoors at ${name} during ${kinds.join(" and ")} (${slot.startTime}–${slot.endTime}); the day has a clear window at ${minutesLabel(refuge)} long enough to hold it.`,
          {
            placeId: slot.placeId,
            kinds,
            slotStart: slot.startTime,
            slotEnd: slot.endTime,
            alternativeWindow: minutesLabel(refuge),
          },
        ),
      );
    } else {
      found.push(
        advisory(
          "weather.outdoor-unavoidable-adverse",
          [slot.id],
          `${label} meets ${kinds.join(" and ")} at ${name}, and no clear window that long exists on ${day.date} — plan for it rather than around it.`,
          {
            placeId: slot.placeId,
            kinds,
            date: day.date,
            aqiConsidered: windows.aqiConsidered,
          },
        ),
      );
    }
  }

  return found;
}

const pad = (n: number) => String(n).padStart(2, "0");
const minutesLabel = (s: Span): string =>
  `${pad(Math.floor(s.start / 60))}:${pad(s.start % 60)}–${pad(Math.floor(s.end / 60))}:${pad(s.end % 60)}`;
