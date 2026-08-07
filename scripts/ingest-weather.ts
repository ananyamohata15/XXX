import { createClient } from "@supabase/supabase-js";
import { ingestWeatherForCity } from "../src/server/weather/ingest";

/**
 * Prompted weather + AQI ingestion run (XXX-23). Same core as the
 * /api/jobs/ingest-weather cron route; this entry point keeps data fresh
 * until the Vercel Cron schedule activates at merge. Free (Open-Meteo,
 * keyless), writes weather_days + one weather_ingest trace.
 *
 * Usage: npx tsx --env-file <env> scripts/ingest-weather.ts
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const summary = await ingestWeatherForCity(supabase, "toronto");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
