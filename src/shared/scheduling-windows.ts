/**
 * Derived scheduling windows (XXX-23) — pure judgment applied to stored
 * weather facts + computed daylight. Computed at READ time, never
 * materialized (Session 6 Checkpoint 1 ruling 4): the thresholds below are
 * Tier-3 judgment parameters under active tuning by grammar work;
 * materializing would bake today's guesses into rows. Any output is
 * reproducible from (weather row, daylight, params version).
 *
 * Zero dependencies — usable by the E4 day-grammar validator (server) and
 * any client rendering. All times are city-local: hourly entries as
 * "YYYY-MM-DDTHH:mm" (Open-Meteo timezone-parameter format), boundaries and
 * ranges as "HH:MM". Same-day lexical comparison is exact for both.
 */

/**
 * How many days of forecast we ask Open-Meteo for, and therefore how far
 * ahead a day can be weather-checked at all.
 *
 * It lives in `src/shared` because BOTH sides need it and they must not
 * disagree: the ingest job requests it, and the tasting page bounds its
 * date picker by it (XXX-35 §1.5 — the page offered +45 days against this
 * number and said nothing about the gap).
 *
 * It is the CONFIGURED horizon, not a promise about the table. Rows from
 * an earlier run linger until the sweep takes them — Session 10's audit
 * counted 16 dates present against this 14 — so the horizon explains a
 * weather-blind day, while `windows === null` is what PROVES one. Only the
 * second is load-bearing in any disclosure.
 */
export const FORECAST_HORIZON_DAYS = 14;

/** One Open-Meteo hourly forecast entry, normalized at the Zod boundary. */
export interface HourlyWeather {
  timeLocal: string; // "YYYY-MM-DDTHH:mm"
  tempC: number;
  apparentTempC: number;
  /** null = provider did not publish a probability for this hour. */
  precipProbPct: number | null;
  precipMm: number;
  weatherCode: number;
  windKph: number;
  cloudCoverPct: number;
}

/** One hourly air-quality entry; null values = not published for the hour. */
export interface HourlyAirQuality {
  timeLocal: string;
  usAqi: number | null;
  pm25: number | null;
  pm10: number | null;
  ozone: number | null;
}

/** Daylight boundaries for one city-date, all "HH:MM" city-local. */
export interface DaylightTimes {
  date: string; // "YYYY-MM-DD"
  timezone: string;
  civilDawnLocal: string;
  sunriseLocal: string;
  /** Morning golden hour ends when the sun climbs through +6° altitude. */
  goldenHourAmEndLocal: string;
  /** Evening golden hour begins when the sun sinks through +6° altitude. */
  goldenHourPmStartLocal: string;
  sunsetLocal: string;
  civilDuskLocal: string;
}

export interface LocalTimeRange {
  startLocal: string; // "HH:MM" inclusive
  endLocal: string; // "HH:MM" exclusive
}

/**
 * v1 threshold judgments (Tier 3). Versioned so persisted references to a
 * derivation (if any ever exist) can name the params that produced it.
 * Candidates deliberately deferred (no speculative abstraction): wind
 * avoidance, humidity-adjusted comfort, UV.
 */
export const WINDOW_PARAMS = {
  version: "v1",
  /** Hour counts as rainy at or above this precipitation probability. */
  rainProbPct: 40,
  /** Apparent temperature at or above this is heat-avoid (Delhi-ready). */
  heatApparentC: 32,
  /** Apparent temperature at or below this is cold-avoid (Toronto January). */
  coldApparentC: -12,
  /** US AQI at or above this flags the hour unhealthy. */
  aqiUnhealthy: 100,
} as const;
export type WindowParams = typeof WINDOW_PARAMS;

/**
 * One hour's raw exposure readings, city-local. A PROJECTION of the stored
 * weather facts, not a judgment: no threshold has been applied and none of
 * these numbers is derived from another. The leg-exposure rule
 * (XXX-35 item 1) needs the readings themselves because a walk's cap is a
 * function of temperature, not of whether an hour cleared a slot-level
 * avoid threshold — at -8 °C nothing is flagged and a 35-minute walk still
 * should not happen.
 *
 * `null` on `precipProbPct` / `usAqi` means the provider published no
 * value for that hour. The cap function reads null as "this input cannot
 * bind", never as a clean reading.
 */
export interface HourlyExposure {
  startLocal: string; // "HH:MM"
  endLocal: string; // "HH:MM", exclusive
  apparentTempC: number;
  precipProbPct: number | null;
  precipMm: number;
  usAqi: number | null;
}

export interface SchedulingWindows {
  date: string;
  timezone: string;
  paramsVersion: string;
  /** Hours with precipitation probability >= params.rainProbPct. */
  rainWindows: LocalTimeRange[];
  /** Hours with apparent temperature >= params.heatApparentC. */
  heatAvoidWindows: LocalTimeRange[];
  /** Hours with apparent temperature <= params.coldApparentC. */
  coldAvoidWindows: LocalTimeRange[];
  /** Hours with US AQI >= params.aqiUnhealthy. Empty when AQI absent. */
  aqiUnhealthyWindows: LocalTimeRange[];
  /**
   * Daylight hours clear of rain/heat/cold/AQI flags. When AQI data is
   * absent, windows are computed without the AQI constraint and
   * aqiConsidered is false — honest absence, never silent.
   */
  outdoorFriendlyWindows: LocalTimeRange[];
  aqiConsidered: boolean;
  aqi:
    | { status: "present"; maxUsAqi: number | null }
    | { status: "absent" };
  daylight: DaylightTimes;
  /**
   * Per-hour readings, in `hourly` order. Consumed by the leg-exposure
   * rule; merged windows above cannot serve it (see HourlyExposure).
   */
  hourlyExposure: HourlyExposure[];
}

/** "YYYY-MM-DDTHH:mm" → "HH:MM" (start of the hour the entry covers). */
function hourStart(timeLocal: string): string {
  return timeLocal.slice(11, 16);
}

/** End boundary of the hour starting at "HH:MM" ("23:00" → "24:00"). */
function hourEnd(start: string): string {
  const h = Number(start.slice(0, 2)) + 1;
  return `${String(h).padStart(2, "0")}:00`;
}

/** Merge flagged hours (by start "HH:MM") into contiguous ranges. */
function mergeHours(starts: string[]): LocalTimeRange[] {
  const sorted = [...starts].sort();
  const ranges: LocalTimeRange[] = [];
  for (const start of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.endLocal === start) {
      last.endLocal = hourEnd(start);
    } else {
      ranges.push({ startLocal: start, endLocal: hourEnd(start) });
    }
  }
  return ranges;
}

export interface WeatherDayInput {
  date: string;
  timezone: string;
  hourly: HourlyWeather[];
  /** null = air quality honestly absent for this date (beyond AQI horizon). */
  airQualityHourly: HourlyAirQuality[] | null;
}

export function deriveSchedulingWindows(
  day: WeatherDayInput,
  daylight: DaylightTimes,
  params: WindowParams = WINDOW_PARAMS,
): SchedulingWindows {
  const aqiByHour = new Map<string, number | null>();
  for (const entry of day.airQualityHourly ?? []) {
    aqiByHour.set(hourStart(entry.timeLocal), entry.usAqi);
  }

  const rain: string[] = [];
  const heat: string[] = [];
  const cold: string[] = [];
  const aqiBad: string[] = [];
  const outdoor: string[] = [];
  const exposure: HourlyExposure[] = [];

  for (const hour of day.hourly) {
    const start = hourStart(hour.timeLocal);
    const end = hourEnd(start);

    exposure.push({
      startLocal: start,
      endLocal: end,
      apparentTempC: hour.apparentTempC,
      precipProbPct: hour.precipProbPct,
      precipMm: hour.precipMm,
      usAqi: aqiByHour.get(start) ?? null,
    });

    const isRain =
      hour.precipProbPct !== null && hour.precipProbPct >= params.rainProbPct;
    const isHeat = hour.apparentTempC >= params.heatApparentC;
    const isCold = hour.apparentTempC <= params.coldApparentC;
    const usAqi = aqiByHour.get(start) ?? null;
    const isAqiBad = usAqi !== null && usAqi >= params.aqiUnhealthy;

    if (isRain) rain.push(start);
    if (isHeat) heat.push(start);
    if (isCold) cold.push(start);
    if (isAqiBad) aqiBad.push(start);

    // Outdoor-friendly: the hour overlaps [sunrise, sunset) and carries no
    // avoid-flag. Unknown AQI (absent or null-valued) does not block — it is
    // reported via aqiConsidered instead of silently pretending clean air.
    const overlapsDaylight =
      start < daylight.sunsetLocal && end > daylight.sunriseLocal;
    if (overlapsDaylight && !isRain && !isHeat && !isCold && !isAqiBad) {
      outdoor.push(start);
    }
  }

  const aqiValues = [...aqiByHour.values()].filter(
    (v): v is number => v !== null,
  );
  return {
    date: day.date,
    timezone: day.timezone,
    paramsVersion: params.version,
    rainWindows: mergeHours(rain),
    heatAvoidWindows: mergeHours(heat),
    coldAvoidWindows: mergeHours(cold),
    aqiUnhealthyWindows: mergeHours(aqiBad),
    outdoorFriendlyWindows: mergeHours(outdoor),
    aqiConsidered: day.airQualityHourly !== null,
    aqi:
      day.airQualityHourly !== null
        ? {
            status: "present",
            maxUsAqi: aqiValues.length > 0 ? Math.max(...aqiValues) : null,
          }
        : { status: "absent" },
    daylight,
    hourlyExposure: exposure,
  };
}
