import { Body, Observer, SearchAltitude, SearchRiseSet } from "astronomy-engine";
import { CITY_GEO, type City } from "@/shared/vocabulary";
import type { DaylightTimes } from "@/shared/scheduling-windows";

/**
 * Daylight facts via computed ephemeris (XXX-23; XXX-5 E4 grammar comment
 * item 1). astronomy-engine is validated by its author against JPL Horizons
 * / NOVAS reference data (±1 min rise/set bounds across centuries); our own
 * known-answer tests pin Toronto solstice/equinox values ±2 min
 * (tests/ephemeris.test.ts).
 *
 * Deterministic + free + instant, so NEVER stored (Checkpoint 1 ruling 4):
 * recomputation always agrees with itself; storage would only add a sync
 * liability. Provenance rides in memory on the result — the 001 pattern of
 * provenance-at-creation for transient facts.
 *
 * Golden hour boundary at +6° solar altitude is a definitional Tier-3
 * parameter applied to Tier-1 ephemeris output.
 */

export const GOLDEN_HOUR_ALTITUDE_DEG = 6;
const CIVIL_TWILIGHT_ALTITUDE_DEG = -6;

export interface DaylightFact extends DaylightTimes {
  sunriseUtc: string;
  sunsetUtc: string;
  provenance: {
    source: "ephemeris:astronomy-engine";
    tier: 1;
    computedAt: string;
  };
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
function tzOffsetMs(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24, // Intl may render midnight as "24"
    get("minute"),
    get("second"),
  );
  return asIfUtc - utc.getTime();
}

/** City-local midnight of `date` ("YYYY-MM-DD") as a UTC instant. */
function localMidnightUtc(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  const corrected = new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
  // A DST transition between guess and corrected can shift the offset once.
  const settled = new Date(guess.getTime() - tzOffsetMs(corrected, timeZone));
  return settled;
}

function formatLocalHm(utc: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(utc)
    .replace("24", "00");
}

/**
 * Compute the daylight fact for a city-date. Throws if any event is not
 * found within the day — impossible at our launch cities' latitudes
 * (no polar day/night); a throw means a bug, and pipelines fail loudly.
 */
export function computeDaylight(city: City, date: string): DaylightFact {
  const { lat, lng, timezone } = CITY_GEO[city];
  const observer = new Observer(lat, lng, 0);
  const dayStart = localMidnightUtc(date, timezone);

  const find = (label: string, time: { date: Date } | null): Date => {
    if (!time) {
      throw new Error(`ephemeris: no ${label} found for ${city} ${date}`);
    }
    return time.date;
  };

  const sunrise = find(
    "sunrise",
    SearchRiseSet(Body.Sun, observer, +1, dayStart, 1),
  );
  const sunset = find(
    "sunset",
    SearchRiseSet(Body.Sun, observer, -1, dayStart, 1),
  );
  const civilDawn = find(
    "civil dawn",
    SearchAltitude(Body.Sun, observer, +1, dayStart, 1, CIVIL_TWILIGHT_ALTITUDE_DEG),
  );
  const civilDusk = find(
    "civil dusk",
    SearchAltitude(Body.Sun, observer, -1, dayStart, 1, CIVIL_TWILIGHT_ALTITUDE_DEG),
  );
  const goldenAmEnd = find(
    "morning golden-hour end",
    SearchAltitude(Body.Sun, observer, +1, dayStart, 1, GOLDEN_HOUR_ALTITUDE_DEG),
  );
  const goldenPmStart = find(
    "evening golden-hour start",
    SearchAltitude(Body.Sun, observer, -1, dayStart, 1, GOLDEN_HOUR_ALTITUDE_DEG),
  );

  return {
    date,
    timezone,
    civilDawnLocal: formatLocalHm(civilDawn, timezone),
    sunriseLocal: formatLocalHm(sunrise, timezone),
    goldenHourAmEndLocal: formatLocalHm(goldenAmEnd, timezone),
    goldenHourPmStartLocal: formatLocalHm(goldenPmStart, timezone),
    sunsetLocal: formatLocalHm(sunset, timezone),
    civilDuskLocal: formatLocalHm(civilDusk, timezone),
    sunriseUtc: sunrise.toISOString(),
    sunsetUtc: sunset.toISOString(),
    provenance: {
      source: "ephemeris:astronomy-engine",
      tier: 1,
      computedAt: new Date().toISOString(),
    },
  };
}
