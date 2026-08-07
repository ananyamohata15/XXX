import { createClient } from "@supabase/supabase-js";
import { computeDaylight } from "../src/server/weather/ephemeris";
import {
  deriveSchedulingWindows,
  type WeatherDayInput,
} from "../src/shared/scheduling-windows";
import { getWeatherDay } from "../src/server/weather/repo";
import type { City } from "../src/shared/vocabulary";

/**
 * Read-only weather evidence report (XXX-23). Makes no external API calls
 * and writes nothing: reads one stored weather_days row, computes daylight
 * (pure ephemeris) and derived windows (pure function) for it.
 *
 * Usage: npx tsx --env-file <env> scripts/weather-report.ts [--date YYYY-MM-DD]
 *        npx tsx scripts/weather-report.ts --ephemeris-only YYYY-MM-DD[..YYYY-MM-DD]
 *          (no DB, no env needed — pure computation, e.g. the January
 *           golden-set daylight table)
 */

const CITY: City = "toronto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function* dateRange(from: string, to: string): Generator<string> {
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (
    let t = new Date(`${from}T00:00:00Z`).getTime();
    t <= end;
    t += 24 * 60 * 60 * 1000
  ) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

async function main() {
  const argv = process.argv.slice(2);

  const ephemerisArg = argv.indexOf("--ephemeris-only");
  if (ephemerisArg >= 0) {
    const spec = argv[ephemerisArg + 1];
    if (!spec) throw new Error("--ephemeris-only requires a date or range");
    const [from, to] = spec.includes("..") ? spec.split("..") : [spec, spec];
    for (const date of dateRange(from, to)) {
      const d = computeDaylight(CITY, date);
      console.log(
        `${date}  dawn ${d.civilDawnLocal}  rise ${d.sunriseLocal}  ` +
          `goldenAmEnd ${d.goldenHourAmEndLocal}  goldenPmStart ${d.goldenHourPmStartLocal}  ` +
          `set ${d.sunsetLocal}  dusk ${d.civilDuskLocal}`,
      );
    }
    return;
  }

  const dateArg = argv.indexOf("--date");
  const date =
    dateArg >= 0
      ? argv[dateArg + 1]
      : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const row = await getWeatherDay(supabase, CITY, date);
  if (!row) {
    console.log(`no weather_days row for ${CITY} ${date} (honest absence — not ingested)`);
    process.exit(2);
  }

  console.log("stored row (provenance + daily + first 3 hours):");
  console.log(
    JSON.stringify(
      {
        id: row.id,
        city: row.city,
        date: row.date,
        timezone: row.timezone,
        source: row.source,
        tier: row.tier,
        fetched_at: row.fetched_at,
        forecast_status: row.forecast_status,
        air_quality_status: row.air_quality_status,
        daily: row.forecast?.daily,
        hourly_sample: row.forecast?.hourly.slice(0, 3),
        aqi_sample: row.air_quality?.hourly.slice(0, 3) ?? null,
      },
      null,
      2,
    ),
  );

  const daylight = computeDaylight(CITY, date);
  console.log("computed daylight (ephemeris, in-memory provenance):");
  console.log(JSON.stringify(daylight, null, 2));

  if (row.forecast) {
    const input: WeatherDayInput = {
      date: row.date,
      timezone: row.timezone,
      hourly: row.forecast.hourly,
      airQualityHourly: row.air_quality?.hourly ?? null,
    };
    console.log("derived scheduling windows (computed at read time):");
    console.log(JSON.stringify(deriveSchedulingWindows(input, daylight), null, 2));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
