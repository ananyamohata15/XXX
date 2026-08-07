import type { SupabaseClient } from "@supabase/supabase-js";
import type { AirQualityPayload, ForecastPayload } from "./schemas";

/**
 * weather_days repository (XXX-23). Full-row clobber upsert is CORRECT here
 * (unlike the discovery/base-layer read-then-write pattern): each fetch
 * supersedes the forecast wholesale and no cross-source fields need
 * protecting (Checkpoint 1 ruling 4). Single-owner: this table owns
 * city-date weather observations; derived windows are computed at read
 * time and never stored.
 */

export interface WeatherDayRow {
  id: string;
  city: string;
  date: string;
  timezone: string;
  forecast_status: "present" | "absent";
  forecast: ForecastPayload | null;
  air_quality_status: "present" | "absent";
  air_quality: AirQualityPayload | null;
  source: string;
  tier: number;
  fetched_at: string;
}

const WEATHER_DAY_COLUMNS =
  "id, city, date, timezone, forecast_status, forecast, air_quality_status, air_quality, source, tier, fetched_at";

export interface NewWeatherDay {
  city: string;
  date: string;
  timezone: string;
  forecast: ForecastPayload | null;
  airQuality: AirQualityPayload | null;
  fetchedAt: string;
}

export async function upsertWeatherDays(
  client: SupabaseClient,
  days: NewWeatherDay[],
): Promise<number> {
  if (days.length === 0) return 0;
  const rows = days.map((d) => ({
    city: d.city,
    date: d.date,
    timezone: d.timezone,
    forecast_status: d.forecast ? ("present" as const) : ("absent" as const),
    forecast: d.forecast,
    air_quality_status: d.airQuality
      ? ("present" as const)
      : ("absent" as const),
    air_quality: d.airQuality,
    source: "open_meteo",
    tier: 1,
    fetched_at: d.fetchedAt,
  }));
  const { error } = await client
    .from("weather_days")
    .upsert(rows, { onConflict: "city,date" });
  if (error) throw new Error(`weather_days upsert failed: ${error.message}`);
  return rows.length;
}

export async function getWeatherDay(
  client: SupabaseClient,
  city: string,
  date: string,
): Promise<WeatherDayRow | null> {
  const { data, error } = await client
    .from("weather_days")
    .select(WEATHER_DAY_COLUMNS)
    .eq("city", city)
    .eq("date", date)
    .maybeSingle();
  if (error) throw new Error(`weather_days read failed: ${error.message}`);
  return (data as WeatherDayRow | null) ?? null;
}
