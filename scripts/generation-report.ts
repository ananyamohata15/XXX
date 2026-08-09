import { createClient } from "@supabase/supabase-js";
import { createInstrumentation } from "@/server/instrumentation";
import { generateDay, type EngineDeps } from "@/server/generation/engine";
import { createEngineGoogleClient } from "@/server/generation/google";
import { DeterministicSelector } from "@/server/generation/select";
import type {
  GenerationOutcome,
  GenerationRequest,
} from "@/server/generation/types";
import type { Environment } from "@/server/generation/context";
import { computeDaylight } from "@/server/weather/ephemeris";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import type { GrammarDay, GrammarFact } from "@/shared/day-grammar/types";

/**
 * Generation evidence report (XXX-5 Session 9, CHECKPOINT 2/3 proofs).
 *
 * What it does: runs generateDay end to end and prints the day with every
 * card's provenance chain, the advisory narration, and the trace's cost +
 * latency actuals. Flags select the exam:
 *   --persona <key>     one of the six golden personas (default day-2-old-town)
 *   --date YYYY-MM-DD   the day to plan (default: next Saturday)
 *   --seed <n>          fixed exploration seed (default 42)
 *   --budget <n>        CAD budget band max
 *   --twice             run twice with the same seed; diff venue sets (determinism)
 *   --repair-demo       synthetic all-afternoon rain via the exam seam, so an
 *                       outdoor pick is rejected by the validator and repaired
 *   --json              machine-readable output
 *
 * What it costs: one run ≈ shortlist-size Details calls at $0.020 list each
 * (cap 30) + free IDs-only searches + ≤4 transit calls at $0.005. Printed
 * from the trace afterward, never estimated.
 *
 * What it writes: a day_generation trace (+ events), and — via
 * link-on-demand — discovered_places rows, identity_matches rows, and
 * places.google_place_id links for candidates it verified (Session 5
 * thresholds). Request-time Google facts are NEVER written anywhere.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * GOOGLE_MAPS_API_KEY (self-reported below, never read by a session).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (flag: string): boolean => process.argv.includes(flag);

function nextSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function factLine(fact: GrammarFact<unknown> | undefined): string {
  if (fact === undefined) return "— (never fetched)";
  if (fact.status === "absent") {
    return `absent [${fact.source}/${fact.tier} @ ${fact.fetchedAt.slice(0, 16)}]`;
  }
  const value =
    typeof fact.value === "object"
      ? JSON.stringify(fact.value).slice(0, 60)
      : String(fact.value);
  return `${value} [${fact.source}/${fact.tier} @ ${fact.fetchedAt.slice(0, 16)}]`;
}

function printDay(day: GrammarDay): void {
  console.log(`\n  ${day.date} (${day.dayStart}–${day.dayEnd}) — ${day.slots.length} slots`);
  for (const slot of [...day.slots].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  )) {
    const place = day.places[slot.placeId];
    console.log(
      `\n  ${slot.startTime}–${slot.endTime}  ${place?.name ?? slot.placeId}` +
        `  (${slot.kind}, ${slot.origin}, arrive by ${slot.arriveBy})` +
        (place?.neighborhood ? `  · ${place.neighborhood}` : ""),
    );
    if (place === undefined) continue;
    console.log(`      category:  ${factLine(place.category)}`);
    console.log(`      status:    ${factLine(place.businessStatus)}`);
    console.log(`      hours:     ${factLine(place.hours)}`);
    console.log(`      price:     ${factLine(place.priceRange)}`);
  }
}

/** Synthetic exam weather: clear morning, rain 12:00–18:00 (repair demo). */
function rainAfternoon(date: string): Environment {
  const daylight = computeDaylight("toronto", date);
  return {
    daylight,
    windows: {
      date,
      timezone: "America/Toronto",
      paramsVersion: "v1",
      rainWindows: [{ startLocal: "12:00", endLocal: "18:00" }],
      heatAvoidWindows: [],
      coldAvoidWindows: [],
      aqiUnhealthyWindows: [],
      outdoorFriendlyWindows: [
        { startLocal: "08:00", endLocal: "12:00" },
        { startLocal: "18:00", endLocal: "20:00" },
      ],
      aqiConsidered: true,
      aqi: { status: "present", maxUsAqi: 30 },
      daylight,
    },
  };
}

function digest(outcome: GenerationOutcome): string {
  if (outcome.status !== "ok") return "FAILED";
  return [...outcome.day.slots]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((s) => `${s.startTime}:${outcome.day.places[s.placeId]?.name ?? s.placeId}`)
    .join(" | ");
}

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const googleApiKey = requireEnv("GOOGLE_MAPS_API_KEY");

  const personaKey = arg("--persona") ?? "day-2-old-town";
  const persona = GOLDEN_PERSONAS[personaKey];
  if (persona === undefined) {
    console.error(
      `Unknown persona "${personaKey}". Known: ${Object.keys(GOLDEN_PERSONAS).join(", ")}`,
    );
    process.exit(1);
  }
  const date = arg("--date") ?? nextSaturday();
  const seed = Number(arg("--seed") ?? 42);
  const budgetMax = arg("--budget");

  const request: GenerationRequest = {
    city: "toronto",
    date,
    persona,
    budgetBand:
      budgetMax !== null
        ? { min: 0, max: Number(budgetMax), currency: "CAD" }
        : null,
    transport: ["walk", "transit"],
    seed,
  };

  const deps: EngineDeps = {
    supabase,
    google: createEngineGoogleClient({ apiKey: googleApiKey }),
    googleApiKey,
    instrumentation: createInstrumentation(supabase),
    selector: new DeterministicSelector(),
    ...(has("--repair-demo")
      ? { examEnvironmentOverride: rainAfternoon(date) }
      : {}),
  };

  console.log(
    `generation-report: persona=${personaKey} date=${date} seed=${seed}` +
      (has("--repair-demo") ? " [REPAIR DEMO: synthetic afternoon rain]" : ""),
  );

  const outcome = await generateDay(deps, request);

  if (has("--json")) {
    console.log(JSON.stringify(outcome, null, 2));
  } else if (outcome.status === "ok") {
    printDay(outcome.day);
    console.log(`\n  headline: ${outcome.narrated.headline}`);
    for (const line of outcome.narrated.advisories) {
      console.log(`    note [${line.ruleId}]: ${line.text}`);
    }
  } else {
    console.log(`\n  HONEST FAILURE — ${outcome.narrated.headline}`);
    for (const line of outcome.narrated.violations) {
      console.log(`    violation [${line.ruleId}]: ${line.text}`);
    }
  }

  const s = outcome.stats;
  console.log(`\n  trace ${s.traceId}`);
  console.log(
    `  pool=${s.poolCandidates} shortlist=${s.shortlisted} details=${s.detailsCalls} ` +
      `searchText=${s.searchTextCalls} linksMinted=${s.linksMinted} transit=${s.transitCalls}`,
  );
  console.log(
    `  passes=${s.validationPasses} repairLog=${JSON.stringify(s.repairLog)}`,
  );
  if (s.unfilled.length > 0) {
    console.log(
      `  unfilled: ${s.unfilled.map((u) => `${u.label} (${u.cause})`).join(", ")}`,
    );
  }
  console.log(
    `  est cost (list): $${s.estCostUsd.toFixed(3)} · latency: total ${s.timings.totalMs}ms ` +
      `(retrieve ${s.timings.retrieveMs}, details ${s.timings.detailsMs}, compose ${s.timings.composeMs}, validate ${s.timings.validateMs})`,
  );

  if (has("--twice")) {
    console.log("\n  — determinism: second run, same seed —");
    const second = await generateDay(deps, request);
    const same = digest(outcome) === digest(second);
    console.log(`  run 1: ${digest(outcome)}`);
    console.log(`  run 2: ${digest(second)}`);
    console.log(
      same
        ? "  DETERMINISTIC: identical venues and times."
        : "  MISMATCH — deterministic path is not deterministic, investigate.",
    );
    console.log(
      `  run 2 cost (list): $${second.stats.estCostUsd.toFixed(3)} — facts are request-scoped; every run re-fetches (no cross-request cache exists, by law).`,
    );
    if (!same) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
