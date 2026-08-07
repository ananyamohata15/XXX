import { z } from "zod";
import type {
  HourlyAirQuality,
  HourlyWeather,
} from "@/shared/scheduling-windows";

/**
 * Zod boundary for Open-Meteo responses (XXX-23). External API responses
 * are untrusted input — parse, don't validate-and-hope. Open-Meteo returns
 * parallel arrays under `hourly`/`daily`; every value array must match the
 * length of its `time` array or the whole response is rejected (a silent
 * misalignment would attach values to the wrong hours).
 *
 * Times arrive city-local without offset ("2026-08-07T14:00") because we
 * request `timezone=<city tz>` — exactly the frame the day-grammar
 * schedules in. Stored as-is with the timezone recorded on the row.
 */

const localMinute = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "expected local YYYY-MM-DDTHH:mm");
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected local YYYY-MM-DD");

function parallel<T extends z.ZodTypeAny>(value: T) {
  return z.array(value);
}

export const forecastResponseSchema = z
  .object({
    timezone: z.string(),
    hourly: z.object({
      time: z.array(localMinute).min(1),
      temperature_2m: parallel(z.number()),
      apparent_temperature: parallel(z.number()),
      precipitation_probability: parallel(z.number().nullable()),
      precipitation: parallel(z.number()),
      weather_code: parallel(z.number()),
      wind_speed_10m: parallel(z.number()),
      cloud_cover: parallel(z.number()),
    }),
    daily: z.object({
      time: z.array(localDate).min(1),
      temperature_2m_max: parallel(z.number().nullable()),
      temperature_2m_min: parallel(z.number().nullable()),
      precipitation_sum: parallel(z.number().nullable()),
      precipitation_probability_max: parallel(z.number().nullable()),
    }),
  })
  .superRefine((value, ctx) => {
    for (const group of ["hourly", "daily"] as const) {
      const record = value[group] as Record<string, unknown[]>;
      const expected = record.time.length;
      for (const [key, arr] of Object.entries(record)) {
        if (arr.length !== expected) {
          ctx.addIssue({
            code: "custom",
            path: [group, key],
            message: `${group}.${key} has ${arr.length} entries, ${group}.time has ${expected}`,
          });
        }
      }
    }
  });
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;

export const airQualityResponseSchema = z
  .object({
    timezone: z.string(),
    hourly: z.object({
      time: z.array(localMinute).min(1),
      us_aqi: parallel(z.number().nullable()),
      pm2_5: parallel(z.number().nullable()),
      pm10: parallel(z.number().nullable()),
      ozone: parallel(z.number().nullable()),
    }),
  })
  .superRefine((value, ctx) => {
    const expected = value.hourly.time.length;
    for (const [key, arr] of Object.entries(
      value.hourly as Record<string, unknown[]>,
    )) {
      if (arr.length !== expected) {
        ctx.addIssue({
          code: "custom",
          path: ["hourly", key],
          message: `hourly.${key} has ${arr.length} entries, hourly.time has ${expected}`,
        });
      }
    }
  });
export type AirQualityResponse = z.infer<typeof airQualityResponseSchema>;

/** The `forecast` jsonb payload stored on a weather_days row. */
export interface ForecastPayload {
  daily: {
    tempMinC: number | null;
    tempMaxC: number | null;
    precipSumMm: number | null;
    precipProbMaxPct: number | null;
  };
  hourly: HourlyWeather[];
}

/** The `air_quality` jsonb payload stored on a weather_days row. */
export interface AirQualityPayload {
  hourly: HourlyAirQuality[];
}

/** Normalize the parsed forecast response into per-date stored payloads. */
export function forecastByDate(
  response: ForecastResponse,
): Map<string, ForecastPayload> {
  const byDate = new Map<string, ForecastPayload>();
  response.daily.time.forEach((date, i) => {
    byDate.set(date, {
      daily: {
        tempMinC: response.daily.temperature_2m_min[i],
        tempMaxC: response.daily.temperature_2m_max[i],
        precipSumMm: response.daily.precipitation_sum[i],
        precipProbMaxPct: response.daily.precipitation_probability_max[i],
      },
      hourly: [],
    });
  });
  response.hourly.time.forEach((timeLocal, i) => {
    const payload = byDate.get(timeLocal.slice(0, 10));
    // Hours on a date missing from `daily` would be a provider-side
    // inconsistency; fail loudly rather than dropping hours silently.
    if (!payload) {
      throw new Error(`forecast hour ${timeLocal} has no matching daily date`);
    }
    payload.hourly.push({
      timeLocal,
      tempC: response.hourly.temperature_2m[i],
      apparentTempC: response.hourly.apparent_temperature[i],
      precipProbPct: response.hourly.precipitation_probability[i],
      precipMm: response.hourly.precipitation[i],
      weatherCode: response.hourly.weather_code[i],
      windKph: response.hourly.wind_speed_10m[i],
      cloudCoverPct: response.hourly.cloud_cover[i],
    });
  });
  return byDate;
}

/** Normalize the parsed air-quality response into per-date stored payloads. */
export function airQualityByDate(
  response: AirQualityResponse,
): Map<string, AirQualityPayload> {
  const byDate = new Map<string, AirQualityPayload>();
  response.hourly.time.forEach((timeLocal, i) => {
    const date = timeLocal.slice(0, 10);
    const payload = byDate.get(date) ?? { hourly: [] };
    payload.hourly.push({
      timeLocal,
      usAqi: response.hourly.us_aqi[i],
      pm25: response.hourly.pm2_5[i],
      pm10: response.hourly.pm10[i],
      ozone: response.hourly.ozone[i],
    });
    byDate.set(date, payload);
  });
  return byDate;
}
