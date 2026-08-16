/**
 * City-scoped facts — the vocabulary and the pure readers (XXX-38/40,
 * Session 14 CP0 ruling 3).
 *
 * A ferry timetable is a fact about a ROUTE, owned by the city, valid across
 * a season. `facts` is place-grain and `weather_days` is city-DATE grain, so
 * neither could hold it without inventing a place or repeating a row per day.
 *
 * Everything here is pure: the schedule readers take a date and a timetable
 * and answer. I/O lives in `src/server/generation/city-facts.ts`; the
 * validator and the composer both consume these, and the validator must stay
 * sync so E5 can run it in the browser.
 */

import type { Tier } from "./vocabulary";

export const CITY_FACT_KINDS = ["ferry_timetable"] as const;
export type CityFactKind = (typeof CITY_FACT_KINDS)[number];

/** Inclusive season bounds; null/null = the fact has no season. */
export interface FactSeason {
  validFrom: string | null;
  validTo: string | null;
}

export interface CityFact<T> {
  city: string;
  factKind: CityFactKind;
  /** Route or mode key within the kind, e.g. "ferry:hanlans". */
  subjectKey: string;
  value: T;
  season: FactSeason;
  source: string;
  tier: Tier;
  fetchedAt: string;
}

/**
 * A scheduled route's departures, in city-local "HH:MM".
 *
 * Two directions because a return trip is not the outbound reversed — golden
 * Day 7 verifies city departures at 11:15/11:45/12:15 and island departures
 * at 21:30/22:00/22:30/23:00, and the last boat is the number the whole day
 * is planned backwards from.
 */
export interface FerryTimetable {
  routeKey: string;
  label: string;
  /** Minutes in the crossing. */
  crossingMinutes: number;
  /** Departures FROM the mainland terminal. */
  outbound: string[];
  /** Departures FROM the island. */
  inbound: string[];
}

/** Is this fact valid on a city-local calendar date? */
export function seasonCovers(season: FactSeason, date: string): boolean {
  if (season.validFrom === null || season.validTo === null) return true;
  return date >= season.validFrom && date <= season.validTo;
}

/**
 * The first departure at or after `afterLocal`, or null.
 *
 * `null` is honest absence and is load-bearing here: a traveller who has
 * missed the last boat has missed it, and inventing a later one is the
 * silent-fallback failure that would strand someone on an island.
 */
export function nextDeparture(
  departures: readonly string[],
  afterLocal: string,
): string | null {
  for (const departure of [...departures].sort()) {
    if (departure >= afterLocal) return departure;
  }
  return null;
}

/**
 * The last departure at or before `byLocal`, or null.
 *
 * This is the one golden Day 7 plans against — *"Hanlan's departures 21:30 /
 * 22:00 / 22:30 / 23:00 — last boat 11pm; comfortable margin after sunset"*.
 */
export function lastDepartureBy(
  departures: readonly string[],
  byLocal: string,
): string | null {
  let best: string | null = null;
  for (const departure of departures) {
    if (departure <= byLocal && (best === null || departure > best)) {
      best = departure;
    }
  }
  return best;
}

/** The final departure of the day — the one that decides when to leave. */
export function lastDeparture(departures: readonly string[]): string | null {
  let best: string | null = null;
  for (const departure of departures) {
    if (best === null || departure > best) best = departure;
  }
  return best;
}
