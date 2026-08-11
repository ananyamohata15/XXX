import {
  airQualityResponseSchema,
  forecastResponseSchema,
  type AirQualityResponse,
  type ForecastResponse,
} from "./schemas";

/**
 * Open-Meteo fetchers (XXX-23). Keyless and free (non-commercial service
 * tier during build; data under CC BY 4.0 — decision recorded in
 * SESSION_NOTES Session 6 §1.4). Fail-loud: any HTTP or parse failure
 * throws — a broken refresh aborts and surfaces, never skips.
 *
 * Both endpoints are asked for city-local times (`timezone` param) so every
 * stored hour lives in the frame the day-grammar schedules in.
 */

/**
 * Re-exported, not redeclared: the tasting page bounds its date picker by
 * this number and may not import `src/server`, so it moved to
 * `src/shared/scheduling-windows` where both sides read the same one.
 */
import { FORECAST_HORIZON_DAYS } from "@/shared/scheduling-windows";
export { FORECAST_HORIZON_DAYS };
export const AIR_QUALITY_HORIZON_DAYS = 5;

const FORECAST_HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "cloud_cover",
].join(",");
const FORECAST_DAILY = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
].join(",");
const AIR_QUALITY_HOURLY = ["us_aqi", "pm2_5", "pm10", "ozone"].join(",");

export interface WeatherClient {
  fetchForecast(lat: number, lng: number, timezone: string): Promise<ForecastResponse>;
  fetchAirQuality(lat: number, lng: number, timezone: string): Promise<AirQualityResponse>;
}

export function createWeatherClient(
  fetchImpl: typeof fetch = fetch,
): WeatherClient {
  async function getJson(url: string, label: string): Promise<unknown> {
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`open-meteo ${label} failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  return {
    async fetchForecast(lat, lng, timezone) {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lng}` +
        `&hourly=${FORECAST_HOURLY}&daily=${FORECAST_DAILY}` +
        `&timezone=${encodeURIComponent(timezone)}` +
        `&forecast_days=${FORECAST_HORIZON_DAYS}`;
      return forecastResponseSchema.parse(await getJson(url, "forecast"));
    },
    async fetchAirQuality(lat, lng, timezone) {
      const url =
        `https://air-quality-api.open-meteo.com/v1/air-quality` +
        `?latitude=${lat}&longitude=${lng}` +
        `&hourly=${AIR_QUALITY_HOURLY}` +
        `&timezone=${encodeURIComponent(timezone)}` +
        `&forecast_days=${AIR_QUALITY_HORIZON_DAYS}`;
      return airQualityResponseSchema.parse(await getJson(url, "air quality"));
    },
  };
}
