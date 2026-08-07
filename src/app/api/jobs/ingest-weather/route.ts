import { getServerSupabase } from "@/server/supabase";
import { ingestWeatherForCity } from "@/server/weather/ingest";

/**
 * Vercel Cron target for the daily weather refresh (XXX-23; vercel.json
 * crons). Not a public API: every request must carry the CRON_SECRET
 * bearer token, which Vercel attaches automatically to cron invocations
 * once the env var exists. Fail-loud: an ingest error 500s so the run
 * shows failed in the Vercel dashboard.
 */

// Never prerender: each invocation performs the live ingest.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Misconfiguration is its own loud failure, distinct from bad auth.
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await ingestWeatherForCity(getServerSupabase(), "toronto");
    return Response.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("weather ingest failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
