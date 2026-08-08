import { createClient } from "@supabase/supabase-js";
import { createInstrumentation } from "../src/server/instrumentation";
import {
  assembleTravelProvider,
  type TransitLeg,
} from "../src/server/travel/assemble";
import {
  GOOGLE_TRANSIT_EST_COST_USD,
} from "../src/server/travel/google-transit";
import {
  CITY,
  PLACES,
  PROBE_QUERIES,
  STUB_FALLTHROUGH_QUERY,
  type ProbeQuery,
} from "./travel-pairs";

/**
 * The CHECKPOINT 3 live proof (XXX-24 Step 3): every probe query runs
 * through the production-shaped provider chain (stored matrix → live
 * transit prefetch → haversine stub) and is compared against the
 * founder's lived estimates. Provenance is printed per answer — the
 * point is to SEE tier-1 founder rows shadowing ORS, live Google
 * transit arriving as tier 2, and the deliberate fall-through pair
 * downgrading honestly to the tier-3 stub.
 *
 * Spend: one Compute Routes Essentials call per transit pair (~4 ×
 * $0.005 list per run, $0 inside the 10K/month free cap). Nothing this
 * script does writes to travel_times — transit answers are
 * request-scoped by decision doc 003 and die with the process.
 *
 * PASS tolerance is provisional (max(5 min, 33%)); the founder's call
 * at CHECKPOINT 3 is final, and cycle rows have no baseline at all —
 * they are presented for live adjudication.
 *
 * Usage: npx tsx --env-file .env.local scripts/travel-probe.ts
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

/** Next Saturday, 14:00 Toronto (EDT year-round is fine for a probe —
 * August dates are EDT; the instant is recorded in the trace). */
function probeDepartureIso(): string {
  const now = new Date();
  const daysUntilSaturday = (6 - now.getUTCDay() + 7) % 7 || 7;
  const dep = new Date(now);
  dep.setUTCDate(now.getUTCDate() + daysUntilSaturday);
  dep.setUTCHours(18, 0, 0, 0); // 14:00 EDT
  return dep.toISOString();
}

function verdict(
  answerMinutes: number,
  founderMinutes: number | null,
): string {
  if (founderMinutes === null) return "ADJUDICATE";
  const delta = Math.abs(answerMinutes - founderMinutes);
  const tolerance = Math.max(5, founderMinutes / 3);
  return delta <= tolerance ? "PASS*" : "CHECK";
}

async function main() {
  const googleKey = requireEnv("GOOGLE_MAPS_API_KEY");
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const instrumentation = createInstrumentation(supabase);
  const traceId = await instrumentation.startTrace("travel_probe");
  const departureTimeIso = probeDepartureIso();

  const transitLegs: TransitLeg[] = PROBE_QUERIES.filter(
    (q) => q.mode === "transit",
  ).map((q) => ({
    label: `${q.origin}→${q.dest}`,
    origin: PLACES[q.origin].coords,
    dest: PLACES[q.dest].coords,
    departureTimeIso,
  }));

  const { provider, transitCalls } = await assembleTravelProvider(
    supabase,
    googleKey,
    CITY,
    transitLegs,
  );
  for (const call of transitCalls) {
    await instrumentation.logEvent(traceId, {
      provider: "google_routes",
      endpoint: "computeRoutes.transit",
      estCostUsd: GOOGLE_TRANSIT_EST_COST_USD,
      durationMs: call.durationMs,
      metadata: {
        leg: call.label,
        minutes: call.estimate?.minutes ?? null,
        departureTimeIso,
      },
    });
  }
  const liveTransitByLeg = new Map(
    transitCalls.map((c) => [c.label, c.estimate]),
  );

  const runQuery = (q: ProbeQuery) => {
    const estimate = provider.estimate({
      origin: PLACES[q.origin].coords,
      destination: PLACES[q.dest].coords,
      mode: q.mode,
      departureLocal: "14:00",
    });
    return {
      pair: `${PLACES[q.origin].label} → ${PLACES[q.dest].label}`,
      mode: q.mode,
      chainMinutes: estimate?.minutes ?? null,
      source: estimate?.provenance.source ?? "(null — honest absence)",
      tier: estimate?.provenance.tier ?? null,
      liveGoogleMinutes:
        q.mode === "transit"
          ? (liveTransitByLeg.get(`${q.origin}→${q.dest}`)?.minutes ?? null)
          : undefined,
      founderMinutes: q.founderMinutes,
      verdict:
        estimate === null
          ? "NO ANSWER"
          : verdict(estimate.minutes, q.founderMinutes),
      note: q.note,
    };
  };

  const results = PROBE_QUERIES.map(runQuery);
  const fallthrough = runQuery(STUB_FALLTHROUGH_QUERY);

  const totalCostUsd = transitCalls.length * GOOGLE_TRANSIT_EST_COST_USD;
  await instrumentation.endTrace(traceId, {
    totalCostUsd,
    metadata: {
      queries: results.length,
      transitCalls: transitCalls.length,
      departureTimeIso,
    },
  });

  // Human-readable comparison table + machine-readable JSON.
  const pad = (v: unknown, w: number) => String(v ?? "—").padEnd(w);
  console.log(
    pad("pair", 58) +
      pad("mode", 9) +
      pad("chain", 7) +
      pad("src/tier", 22) +
      pad("google", 8) +
      pad("founder", 9) +
      "verdict",
  );
  for (const r of [...results, fallthrough]) {
    console.log(
      pad(r.pair, 58) +
        pad(r.mode, 9) +
        pad(r.chainMinutes, 7) +
        pad(`${r.source}/${r.tier ?? "—"}`, 22) +
        pad(r.mode === "transit" ? r.liveGoogleMinutes : "n/a", 8) +
        pad(r.founderMinutes, 9) +
        r.verdict,
    );
  }
  console.log(
    `\n(PASS* = within provisional tolerance max(5 min, 33%); founder adjudication at CHECKPOINT 3 is final.)`,
  );
  console.log(
    JSON.stringify({ traceId, departureTimeIso, totalCostUsd, results, fallthrough }, null, 2),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
