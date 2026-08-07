import type { SupabaseClient } from "@supabase/supabase-js";
import { CITY_GEO, type City } from "@/shared/vocabulary";
import { createInstrumentation } from "../instrumentation";
import {
  AIR_QUALITY_HORIZON_DAYS,
  FORECAST_HORIZON_DAYS,
  createWeatherClient,
  type WeatherClient,
} from "./client";
import { airQualityByDate, forecastByDate } from "./schemas";
import { upsertWeatherDays, type NewWeatherDay } from "./repo";

/**
 * Weather + AQI ingestion (XXX-23): one run refreshes the rolling window
 * for a city — 14 forecast dates, ~5 air-quality dates. Dates beyond the
 * AQI horizon get air_quality_status='absent' (honest absence; the
 * Delhi-ready shape). Past dates are never touched: they freeze at last
 * fetch and are LAST FORECAST, not observed actuals.
 *
 * Fail-loud end to end: fetch, parse, or write failure throws — the script
 * exits non-zero, the cron route 500s and the run shows failed in the
 * Vercel dashboard.
 */

export interface WeatherIngestSummary {
  traceId: string;
  city: City;
  datesWritten: number;
  aqiDatesWritten: number;
  fetchedAt: string;
}

export async function ingestWeatherForCity(
  supabase: SupabaseClient,
  city: City,
  weatherClient: WeatherClient = createWeatherClient(),
): Promise<WeatherIngestSummary> {
  const { lat, lng, timezone } = CITY_GEO[city];
  const instrumentation = createInstrumentation(supabase);
  const traceId = await instrumentation.startTrace("weather_ingest");
  const fetchedAt = new Date().toISOString();

  const forecastStart = Date.now();
  const forecast = await weatherClient.fetchForecast(lat, lng, timezone);
  await instrumentation.logEvent(traceId, {
    provider: "open_meteo",
    endpoint: "v1/forecast",
    estCostUsd: 0, // keyless free service tier; honest zero
    durationMs: Date.now() - forecastStart,
    metadata: { city, forecast_days: FORECAST_HORIZON_DAYS },
  });

  const aqiStart = Date.now();
  const airQuality = await weatherClient.fetchAirQuality(lat, lng, timezone);
  await instrumentation.logEvent(traceId, {
    provider: "open_meteo",
    endpoint: "v1/air-quality",
    estCostUsd: 0,
    durationMs: Date.now() - aqiStart,
    metadata: { city, forecast_days: AIR_QUALITY_HORIZON_DAYS },
  });

  const forecasts = forecastByDate(forecast);
  const aqi = airQualityByDate(airQuality);

  const days: NewWeatherDay[] = [...forecasts.entries()].map(
    ([date, payload]) => ({
      city,
      date,
      timezone,
      forecast: payload,
      airQuality: aqi.get(date) ?? null,
      fetchedAt,
    }),
  );
  const written = await upsertWeatherDays(supabase, days);
  const aqiDatesWritten = days.filter((d) => d.airQuality !== null).length;

  await instrumentation.endTrace(traceId, {
    totalCostUsd: 0,
    metadata: {
      city,
      dates_written: written,
      aqi_dates_written: aqiDatesWritten,
      forecast_horizon_days: FORECAST_HORIZON_DAYS,
      aqi_horizon_days: AIR_QUALITY_HORIZON_DAYS,
    },
  });

  return {
    traceId,
    city,
    datesWritten: written,
    aqiDatesWritten,
    fetchedAt,
  };
}
