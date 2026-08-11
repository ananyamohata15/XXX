/**
 * Leg exposure — how long the traveller is outside BETWEEN stops
 * (XXX-35 item 1, the gap Session 10's trace audit proved).
 *
 * Every other environmental rule in this folder reads a slot span. None
 * reads a travel leg, so a 35-minute walk at -8 °C between two indoor
 * venues passed the whole grammar, and would have passed with a weather
 * row present. That is the founder's "Winter days with 30+ mins of walking
 * is illogical".
 *
 * Three findings, and the severity split is load-bearing:
 *
 *   exposure.leg-over-cap     VIOLATION — an alternative mode exists and
 *                             can be priced, so the day is fixable.
 *   exposure.leg-unavoidable  advisory  — over the cap with nowhere to go.
 *                             Rejecting what cannot be improved is how a
 *                             regeneration loop fails to terminate; the
 *                             same reasoning already governs
 *                             weather.outdoor-unavoidable-adverse.
 *   exposure.unknown          advisory  — no weather for the date, so the
 *                             cap has no input and the rule CANNOT fire.
 *                             It says so. A leg-level absence that passes
 *                             quietly is Session 1's false-healthy check
 *                             all over again: an answer produced by not
 *                             looking.
 *
 * The cap itself is `walkCapMinutes` below: pure, total, and the only
 * place the band table is read.
 */

import { timeToMinutes } from "../../time";
import type { HourlyExposure } from "../../scheduling-windows";
import type { TransportMode } from "../../vocabulary";
import {
  advisory,
  describePlace,
  orderedSlots,
  placeOf,
  slotLabel,
  violation,
} from "../internal";
import type { GrammarContext, GrammarDay, GrammarParamsExposure, Violation } from "../types";

/** Which mode a leg is walked on. Only walking is exposed to the weather. */
const EXPOSED_MODES: readonly TransportMode[] = ["walk", "cycle"];

/**
 * Modes we would rather use than an over-cap walk, in preference order.
 * Transit first: it is the answer the founder narrated for us ("I put you
 * on the subway — it's -8 out").
 */
export const SHELTERED_MODES: readonly TransportMode[] = [
  "transit",
  "drive",
];

/**
 * How many minutes outside are acceptable in these conditions. The
 * minimum over every band that matches, floored at the most severe: a
 * cold, rainy, smoggy hour is not the average of three caps.
 *
 * Pure and total. Missing inputs (`null`) cannot bind — never treated as
 * a clean reading.
 */
export function walkCapMinutes(
  reading: Pick<
    HourlyExposure,
    "apparentTempC" | "precipProbPct" | "precipMm" | "usAqi"
  >,
  params: GrammarParamsExposure,
): { capMinutes: number; drivers: string[] } {
  let cap: number = params.baseWalkCapMinutes;
  const drivers: string[] = [];
  const bind = (capMinutes: number, driver: string): void => {
    if (capMinutes < cap) cap = capMinutes;
    drivers.push(driver);
  };

  const t = reading.apparentTempC;
  if (t <= params.cold.severeApparentC) {
    bind(params.cold.severeCapMinutes, "severe cold");
  } else if (t <= params.cold.briskApparentC) {
    bind(params.cold.briskCapMinutes, "cold");
  }
  if (t >= params.heat.severeApparentC) {
    bind(params.heat.severeCapMinutes, "severe heat");
  } else if (t >= params.heat.warmApparentC) {
    bind(params.heat.warmCapMinutes, "heat");
  }

  const wet =
    (reading.precipProbPct !== null &&
      reading.precipProbPct >= params.precipitation.probPct) ||
    reading.precipMm >= params.precipitation.mm;
  if (wet) bind(params.precipitation.capMinutes, "precipitation");

  const aqi = reading.usAqi;
  if (aqi !== null) {
    if (aqi >= params.air.severeUsAqi) {
      bind(params.air.severeCapMinutes, "severe air quality");
    } else if (aqi >= params.air.unhealthyUsAqi) {
      bind(params.air.unhealthyCapMinutes, "unhealthy air");
    }
  }

  return { capMinutes: cap, drivers };
}

/** The hour's readings covering a city-local "HH:MM", or null. */
export function exposureAt(
  hourly: readonly HourlyExposure[],
  timeLocal: string,
): HourlyExposure | null {
  const minute = timeToMinutes(timeLocal);
  for (const hour of hourly) {
    if (
      minute >= timeToMinutes(hour.startLocal) &&
      minute < timeToMinutes(hour.endLocal)
    ) {
      return hour;
    }
  }
  return null;
}

/** °C for a message: one decimal at most, and no "-0". */
const degrees = (c: number): string => {
  const rounded = Math.round(c * 10) / 10;
  return `${rounded === 0 ? 0 : rounded}°C`;
};

export function checkExposure(
  day: GrammarDay,
  ctx: GrammarContext,
): Violation[] {
  const found: Violation[] = [];
  const slots = orderedSlots(day);
  const params = ctx.params.exposure;

  interface ExposedLeg {
    fromId: string;
    toId: string;
    mode: TransportMode;
    /** Departure — when the traveller is actually outside. */
    departLocal: string;
    minutes: number;
  }

  const legs: ExposedLeg[] = [];
  for (let i = 1; i < slots.length; i += 1) {
    const from = slots[i - 1];
    const to = slots[i];
    if (!EXPOSED_MODES.includes(to.arriveBy)) continue;
    const fromPlace = placeOf(day, from);
    const toPlace = placeOf(day, to);
    if (!fromPlace?.coords || !toPlace?.coords) continue; // movement's call
    const estimate = ctx.travel.estimate({
      origin: fromPlace.coords,
      destination: toPlace.coords,
      mode: to.arriveBy,
      departureLocal: from.endTime,
    });
    if (estimate === null) continue; // travel.uncertifiable already fires
    legs.push({
      fromId: from.id,
      toId: to.id,
      mode: to.arriveBy,
      departLocal: from.endTime,
      minutes: Math.ceil(estimate.minutes),
    });
  }

  if (legs.length === 0) return found;

  // --- no weather at all: the rule cannot fire, and must say so ----------
  if (ctx.windows === null) {
    const exposedMinutes = legs.reduce((sum, l) => sum + l.minutes, 0);
    found.push(
      advisory(
        "exposure.unknown",
        [],
        `This day has ${legs.length} leg${legs.length === 1 ? "" : "s"} on foot totalling ${exposedMinutes} minutes outside, and no weather is stored for ${day.date} — beyond the forecast horizon. Exposure could not be checked: this is an unchecked leg, not an approved one.`,
        {
          date: day.date,
          exposedLegCount: legs.length,
          exposedMinutes,
          missing: "weather",
        },
      ),
    );
    return found;
  }

  const hourly = ctx.windows.hourlyExposure;
  const alternatives =
    ctx.transport === null
      ? null
      : SHELTERED_MODES.filter((m) => ctx.transport!.includes(m));

  for (const leg of legs) {
    const reading = exposureAt(hourly, leg.departLocal);
    if (reading === null) {
      // A stored row that does not cover this hour is still an absence.
      found.push(
        advisory(
          "exposure.unknown",
          [leg.fromId, leg.toId],
          `The ${leg.minutes}-minute ${leg.mode} leaving ${describePlace(placeOf(day, slots.find((s) => s.id === leg.fromId)!), leg.fromId)} at ${leg.departLocal} has no stored hourly reading for that hour, so its exposure could not be checked.`,
          {
            fromSlotId: leg.fromId,
            toSlotId: leg.toId,
            departLocal: leg.departLocal,
            missing: "hour",
          },
        ),
      );
      continue;
    }

    const { capMinutes, drivers } = walkCapMinutes(reading, params);
    if (leg.minutes <= capMinutes) continue;

    const fromSlot = slots.find((s) => s.id === leg.fromId)!;
    const toSlot = slots.find((s) => s.id === leg.toId)!;
    const fromName = describePlace(placeOf(day, fromSlot), leg.fromId);
    const toName = describePlace(placeOf(day, toSlot), leg.toId);
    const condition =
      drivers.length > 0 ? drivers.join(" and ") : "these conditions";
    const data = {
      fromSlotId: leg.fromId,
      toSlotId: leg.toId,
      mode: leg.mode,
      exposedMinutes: leg.minutes,
      capMinutes,
      drivers,
      apparentTempC: reading.apparentTempC,
      precipProbPct: reading.precipProbPct,
      precipMm: reading.precipMm,
      usAqi: reading.usAqi,
      departLocal: leg.departLocal,
      alternatives: alternatives ?? null,
    };

    // An alternative we cannot price is not an alternative — offering a
    // mode swap we cannot time would be a guess dressed up as care.
    const priceable =
      alternatives?.filter((mode) => {
        const fromPlace = placeOf(day, fromSlot);
        const toPlace = placeOf(day, toSlot);
        if (!fromPlace?.coords || !toPlace?.coords) return false;
        return (
          ctx.travel.estimate({
            origin: fromPlace.coords,
            destination: toPlace.coords,
            mode,
            departureLocal: leg.departLocal,
          }) !== null
        );
      }) ?? [];

    if (priceable.length > 0) {
      found.push(
        violation(
          "exposure.leg-over-cap",
          [leg.fromId, leg.toId],
          `${slotLabel(day, leg.toId)} is reached by a ${leg.minutes}-minute ${leg.mode} from ${fromName} to ${toName}, leaving ${leg.departLocal} in ${condition} (${degrees(reading.apparentTempC)}). That is over the ${capMinutes}-minute limit for those conditions — put them on ${priceable[0]}.`,
          { ...data, preferredMode: priceable[0] },
        ),
      );
    } else {
      found.push(
        advisory(
          "exposure.leg-unavoidable",
          [leg.fromId, leg.toId],
          `The ${leg.minutes}-minute ${leg.mode} from ${fromName} to ${toName} is over the ${capMinutes}-minute limit for ${condition} (${degrees(reading.apparentTempC)}), and no sheltered alternative is available on this trip. Say so rather than hide it: they should dress for it.`,
          data,
        ),
      );
    }
  }

  return found;
}
