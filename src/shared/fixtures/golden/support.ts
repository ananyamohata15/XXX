/**
 * Authoring helpers for the golden-set fixtures (XXX-26).
 *
 * Provenance-at-creation admits no exception for fixture data
 * (constraint 2), so every fact built here carries source + tier +
 * fetchedAt. The sources name what the real pipeline would cite for a
 * value of that kind — `founder_groundtruth` for the things the founder
 * verified in person during the red-pen, `google_places` for hours and
 * business status, `ephemeris:astronomy-engine` for daylight.
 *
 * Daylight values are hard-coded rather than computed because
 * src/shared may not import src/server, where the ephemeris lives. They
 * are not invented: they came out of `scripts/daylight-table.ts`, and
 * tests/day-grammar/golden-set.test.ts re-derives every one of them
 * through computeDaylight and fails if a pasted digit ever drifts.
 */

import { GRAMMAR_PARAMS } from "../../day-grammar/params";
import { HaversineStubProvider } from "../../day-grammar/travel";
import type {
  AnchorBaseline,
  GrammarContext,
  GrammarDay,
  GrammarFact,
  GrammarPlace,
  GrammarSlot,
  HoursByWeekday,
  LatLng,
  MealPatternId,
  OpenInterval,
  PersonaStructure,
  PlaceTags,
  TravelTimeProvider,
} from "../../day-grammar/types";
import {
  WINDOW_PARAMS,
  type DaylightTimes,
  type SchedulingWindows,
} from "../../scheduling-windows";
import type { PriceRange } from "../../timeline";
import {
  WEEKDAYS,
  type Tier,
  type TransportMode,
  type Weekday,
  type PlaceCategory,
} from "../../vocabulary";

/** One timestamp for the whole golden set, as the E2 fixture does. */
export const GOLDEN_FETCHED_AT = "2026-08-06T23:05:00-04:00";

export const FOUNDER = "founder_groundtruth";
export const PLACES_API = "google_places";
export const CONCIERGE = "concierge";

export const present = <T>(
  value: T,
  source: string,
  tier: Tier,
): GrammarFact<T> => ({
  status: "present",
  value,
  source,
  tier,
  fetchedAt: GOLDEN_FETCHED_AT,
});

export const absent = (source: string, tier: Tier): GrammarFact<never> => ({
  status: "absent",
  source,
  tier,
  fetchedAt: GOLDEN_FETCHED_AT,
});

/** `[open, close]` pairs; "24:00" is a legal close, midnight is not crossable. */
type IntervalSpec = readonly (readonly [string, string])[];

const toIntervals = (spec: IntervalSpec): OpenInterval[] =>
  spec.map(([open, close]) => ({ open, close }));

/**
 * Per-weekday hours from a default plus overrides. Hours are per-weekday
 * structures, never a single string (trap class 2) — an override of `[]`
 * is a closed day and is meant to be read as one.
 */
export function hours(
  spec: { default: IntervalSpec } & Partial<Record<Weekday, IntervalSpec>>,
): HoursByWeekday {
  const out = {} as HoursByWeekday;
  for (const day of WEEKDAYS) {
    out[day] = toIntervals(spec[day] ?? spec.default);
  }
  return out;
}

export const tags = (over: Partial<PlaceTags> = {}): PlaceTags => ({
  outdoor: false,
  goldenHourAffine: false,
  highCrowd: false,
  ...over,
});

export const cad = (min: number, max: number = min) => ({
  min,
  max,
  currency: "CAD",
});

/** Turns a place list into the day's `places` record. */
export const byId = (list: GrammarPlace[]): Record<string, GrammarPlace> =>
  Object.fromEntries(list.map((p) => [p.id, p]));

export interface SlotSpec {
  id: string;
  place: string;
  from: string;
  to: string;
  kind?: GrammarSlot["kind"];
  by?: GrammarSlot["arriveBy"];
  origin?: GrammarSlot["origin"];
  requires?: string;
}

export const slot = (spec: SlotSpec): GrammarSlot => ({
  id: spec.id,
  placeId: spec.place,
  startTime: spec.from,
  endTime: spec.to,
  kind: spec.kind ?? "activity",
  arriveBy: spec.by ?? "walk",
  origin: spec.origin ?? "concierge",
  ...(spec.requires === undefined ? {} : { requiresOffering: spec.requires }),
});

export const at = (lat: number, lng: number): LatLng => ({ lat, lng });

/**
 * A day with no adverse weather: no rain, heat, cold or AQI windows, and
 * one outdoor-friendly stretch covering the daylight hours. Built to the
 * same hour-boundary convention deriveSchedulingWindows() uses, so the
 * shape a fixture hands the validator is the shape production hands it.
 *
 * Day 3 does NOT use this — it runs real hourly readings through
 * deriveSchedulingWindows itself, which is what proves the validator
 * consumes Session 6's function rather than reimplementing it.
 */
export function clearWindows(
  light: DaylightTimes,
  maxUsAqi: number | null = 34,
  /**
   * Apparent temperature every hour of this fixture day. 18 °C is a day
   * nobody has an opinion about — no exposure band binds it — which is
   * exactly what a "clear" fixture should mean now that leg exposure
   * reads hourly readings (XXX-35). A fixture wanting winter legs passes
   * its own number.
   */
  apparentTempC = 18,
): SchedulingWindows {
  const floorHour = (hm: string) => `${hm.slice(0, 2)}:00`;
  const ceilHour = (hm: string) =>
    `${String(Number(hm.slice(0, 2)) + 1).padStart(2, "0")}:00`;
  return {
    date: light.date,
    timezone: light.timezone,
    paramsVersion: WINDOW_PARAMS.version,
    rainWindows: [],
    heatAvoidWindows: [],
    coldAvoidWindows: [],
    aqiUnhealthyWindows: [],
    outdoorFriendlyWindows: [
      {
        startLocal: floorHour(light.sunriseLocal),
        endLocal: ceilHour(light.sunsetLocal),
      },
    ],
    aqiConsidered: maxUsAqi !== null,
    aqi: maxUsAqi === null ? { status: "absent" } : { status: "present", maxUsAqi },
    daylight: light,
    hourlyExposure: Array.from({ length: 24 }, (_, hour) => ({
      startLocal: `${String(hour).padStart(2, "0")}:00`,
      endLocal: `${String(hour + 1).padStart(2, "0")}:00`,
      apparentTempC,
      precipProbPct: 0,
      precipMm: 0,
      usAqi: maxUsAqi,
    })),
  };
}

/**
 * Everything the exam needs about one golden day: the day itself plus the
 * context the founder's circumstances line implies. Kept together so a
 * fixture is one import and cannot be run against the wrong context.
 */
export interface GoldenDay {
  key: string;
  title: string;
  day: GrammarDay;
  daylight: DaylightTimes | null;
  windows: SchedulingWindows | null;
  mealPattern: MealPatternId | null;
  persona: { structure: PersonaStructure } | null;
  budgetBand: PriceRange | null;
  lodging: LatLng | null;
  anchorBaseline: Record<string, AnchorBaseline> | null;
  /**
   * Modes this day's traveller uses. Optional: absent means the fixture
   * does not state them, which is exactly the `null` the leg-exposure rule
   * reads as "cannot claim an alternative exists" — so an unstated fixture
   * gets an advisory rather than a rejection.
   */
  transport?: TransportMode[];
  /**
   * Categories the fixture's traveller refused (XXX-43). Absent → `null`,
   * so every existing golden day and trap validates exactly as before.
   *
   * This field exists because the constraint has TWO context builders — the
   * engine's and this one — and a constraint added only to the engine's would
   * leave the golden exam and all 27 traps validating blind to it.
   */
  excludedCategories?: readonly PlaceCategory[];
}

/** Builds the validator context for a golden day. Stub travel by default. */
export function contextFor(
  golden: GoldenDay,
  travel: TravelTimeProvider = new HaversineStubProvider(),
): GrammarContext {
  return {
    daylight: golden.daylight,
    windows: golden.windows,
    mealPattern: golden.mealPattern,
    persona: golden.persona,
    budgetBand: golden.budgetBand,
    lodging: golden.lodging,
    anchorBaseline: golden.anchorBaseline,
    travel,
    transport: golden.transport ?? null,
    excludedCategories: golden.excludedCategories ?? null,
    params: GRAMMAR_PARAMS,
  };
}

/**
 * Daylight for one Toronto date, exactly as `scripts/daylight-table.ts`
 * printed it. Verified against computeDaylight in the fixture test.
 */
export const daylight = (
  date: string,
  civilDawnLocal: string,
  sunriseLocal: string,
  goldenHourAmEndLocal: string,
  goldenHourPmStartLocal: string,
  sunsetLocal: string,
  civilDuskLocal: string,
): DaylightTimes => ({
  date,
  timezone: "America/Toronto",
  civilDawnLocal,
  sunriseLocal,
  goldenHourAmEndLocal,
  goldenHourPmStartLocal,
  sunsetLocal,
  civilDuskLocal,
});
