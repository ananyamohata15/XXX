import { describe, expect, it } from "vitest";
import {
  airQualityByDate,
  airQualityResponseSchema,
  forecastByDate,
  forecastResponseSchema,
} from "@/server/weather/schemas";
import {
  WINDOW_PARAMS,
  deriveSchedulingWindows,
  type DaylightTimes,
  type HourlyWeather,
  type WeatherDayInput,
} from "@/shared/scheduling-windows";

/** Build a full-day hourly series with per-hour overrides. */
function hourlyDay(
  date: string,
  overrides: (hour: number) => Partial<HourlyWeather> = () => ({}),
): HourlyWeather[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    timeLocal: `${date}T${String(hour).padStart(2, "0")}:00`,
    tempC: 20,
    apparentTempC: 20,
    precipProbPct: 0,
    precipMm: 0,
    weatherCode: 1,
    windKph: 10,
    cloudCoverPct: 30,
    ...overrides(hour),
  }));
}

function daylight(partial: Partial<DaylightTimes>): DaylightTimes {
  return {
    date: "2026-08-15",
    timezone: "America/Toronto",
    civilDawnLocal: "05:55",
    sunriseLocal: "06:26",
    goldenHourAmEndLocal: "07:06",
    goldenHourPmStartLocal: "19:44",
    sunsetLocal: "20:24",
    civilDuskLocal: "20:55",
    ...partial,
  };
}

describe("Open-Meteo Zod boundary", () => {
  const validForecast = {
    timezone: "America/Toronto",
    hourly: {
      time: ["2026-08-15T00:00", "2026-08-15T01:00"],
      temperature_2m: [18.2, 17.9],
      apparent_temperature: [19.1, 18.5],
      precipitation_probability: [10, null],
      precipitation: [0, 0],
      weather_code: [1, 2],
      wind_speed_10m: [8.4, 9.2],
      cloud_cover: [20, 45],
    },
    daily: {
      time: ["2026-08-15"],
      temperature_2m_max: [26.1],
      temperature_2m_min: [16.4],
      precipitation_sum: [0.2],
      precipitation_probability_max: [35],
    },
  };

  it("parses a valid forecast response and normalizes per date", () => {
    const parsed = forecastResponseSchema.parse(validForecast);
    const byDate = forecastByDate(parsed);
    const day = byDate.get("2026-08-15");
    expect(byDate.size).toBe(1);
    expect(day?.daily).toEqual({
      tempMinC: 16.4,
      tempMaxC: 26.1,
      precipSumMm: 0.2,
      precipProbMaxPct: 35,
    });
    expect(day?.hourly).toHaveLength(2);
    expect(day?.hourly[1]).toMatchObject({
      timeLocal: "2026-08-15T01:00",
      precipProbPct: null, // provider null preserved, not defaulted
    });
  });

  it("rejects misaligned parallel arrays (values would attach to wrong hours)", () => {
    const broken = structuredClone(validForecast);
    broken.hourly.temperature_2m = [18.2]; // one entry short
    expect(() => forecastResponseSchema.parse(broken)).toThrow(
      /temperature_2m has 1 entries/,
    );
  });

  it("rejects offset-bearing timestamps (we require the city-local frame)", () => {
    const broken = structuredClone(validForecast);
    broken.hourly.time = ["2026-08-15T00:00Z", "2026-08-15T01:00Z"];
    expect(() => forecastResponseSchema.parse(broken)).toThrow();
  });

  it("parses air quality and groups by date", () => {
    const parsed = airQualityResponseSchema.parse({
      timezone: "America/Toronto",
      hourly: {
        time: ["2026-08-15T23:00", "2026-08-16T00:00"],
        us_aqi: [42, null],
        pm2_5: [8.1, null],
        pm10: [12.0, null],
        ozone: [61, null],
      },
    });
    const byDate = airQualityByDate(parsed);
    expect([...byDate.keys()]).toEqual(["2026-08-15", "2026-08-16"]);
    expect(byDate.get("2026-08-16")?.hourly[0].usAqi).toBeNull();
  });
});

describe("deriveSchedulingWindows (pure, fixture days)", () => {
  it("rainy fixture day: rain hours excluded from outdoor windows", () => {
    const date = "2026-08-15";
    const day: WeatherDayInput = {
      date,
      timezone: "America/Toronto",
      hourly: hourlyDay(date, (h) =>
        h >= 10 && h <= 13 ? { precipProbPct: 80, precipMm: 2.4 } : {},
      ),
      airQualityHourly: null,
    };
    const windows = deriveSchedulingWindows(day, daylight({ date }));

    expect(windows.rainWindows).toEqual([
      { startLocal: "10:00", endLocal: "14:00" },
    ]);
    // Outdoor splits around the rain block, inside daylight (06:26–20:24).
    expect(windows.outdoorFriendlyWindows).toEqual([
      { startLocal: "06:00", endLocal: "10:00" },
      { startLocal: "14:00", endLocal: "21:00" },
    ]);
    expect(windows.heatAvoidWindows).toEqual([]);
    expect(windows.aqiConsidered).toBe(false);
    expect(windows.aqi).toEqual({ status: "absent" });
    expect(windows.paramsVersion).toBe(WINDOW_PARAMS.version);
  });

  it("heat-dome fixture day: afternoon heat-avoid, AQI flagged (Delhi-ready shape)", () => {
    const date = "2026-07-20";
    const day: WeatherDayInput = {
      date,
      timezone: "America/Toronto",
      hourly: hourlyDay(date, (h) => ({
        apparentTempC: h >= 12 && h <= 17 ? 36 : 27,
      })),
      airQualityHourly: hourlyDay(date).map((h, i) => ({
        timeLocal: h.timeLocal,
        usAqi: i >= 14 && i <= 16 ? 155 : 60,
        pm25: 20,
        pm10: 30,
        ozone: 80,
      })),
    };
    const windows = deriveSchedulingWindows(
      day,
      daylight({ date, sunriseLocal: "05:48", sunsetLocal: "20:52" }),
    );

    expect(windows.heatAvoidWindows).toEqual([
      { startLocal: "12:00", endLocal: "18:00" },
    ]);
    expect(windows.aqiUnhealthyWindows).toEqual([
      { startLocal: "14:00", endLocal: "17:00" },
    ]);
    expect(windows.aqiConsidered).toBe(true);
    expect(windows.aqi).toEqual({ status: "present", maxUsAqi: 155 });
    // Outdoor = daylight minus the heat block (AQI block is inside it).
    expect(windows.outdoorFriendlyWindows).toEqual([
      { startLocal: "05:00", endLocal: "12:00" },
      { startLocal: "18:00", endLocal: "21:00" },
    ]);
  });

  it("January fixture day: short daylight + deep-cold morning", () => {
    const date = "2027-01-07";
    const day: WeatherDayInput = {
      date,
      timezone: "America/Toronto",
      hourly: hourlyDay(date, (h) => ({
        tempC: h < 10 ? -14 : -6,
        apparentTempC: h < 10 ? -18 : -8, // windchill morning, mild midday
      })),
      airQualityHourly: null,
    };
    const windows = deriveSchedulingWindows(
      day,
      daylight({
        date,
        civilDawnLocal: "07:16",
        sunriseLocal: "07:49",
        goldenHourAmEndLocal: "08:44",
        goldenHourPmStartLocal: "16:04",
        sunsetLocal: "16:58",
        civilDuskLocal: "17:31",
      }),
    );

    expect(windows.coldAvoidWindows).toEqual([
      { startLocal: "00:00", endLocal: "10:00" },
    ]);
    // Usable outdoor time: after the cold lifts (10:00) until sunset's hour.
    expect(windows.outdoorFriendlyWindows).toEqual([
      { startLocal: "10:00", endLocal: "17:00" },
    ]);
    expect(windows.rainWindows).toEqual([]);
    expect(windows.daylight.sunsetLocal).toBe("16:58");
  });

  it("null precipitation probability never counts as rain (honest unknown)", () => {
    const date = "2026-08-15";
    const day: WeatherDayInput = {
      date,
      timezone: "America/Toronto",
      hourly: hourlyDay(date, () => ({ precipProbPct: null })),
      airQualityHourly: null,
    };
    const windows = deriveSchedulingWindows(day, daylight({ date }));
    expect(windows.rainWindows).toEqual([]);
    expect(windows.outdoorFriendlyWindows).toEqual([
      { startLocal: "06:00", endLocal: "21:00" },
    ]);
  });
});
