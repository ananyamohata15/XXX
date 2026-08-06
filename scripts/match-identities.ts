import { createClient } from "@supabase/supabase-js";
import { createInstrumentation } from "../src/server/instrumentation";
import { createDetailsClient, PLACE_DETAILS_PRO_USD_PER_CALL } from "../src/server/base-layer/details-client";
import { buildMatchPlan, runMatching } from "../src/server/base-layer/match";
import { KENSINGTON_BBOX } from "../src/server/base-layer/dataset";

/**
 * Identity matching (decision 002). SPENDS MONEY — every invocation prompts
 * (npx tsx ask rule). Two-phase: the free plan is printed and checked
 * against --max-calls BEFORE any Google call is made.
 *
 * Modes (explicit, no default — spending must be stated):
 *   --probe-kensington    match only discovered places inside the Kensington bbox
 *   --full                match the whole pool
 * Guard:
 *   --max-calls <n>       required in both modes; refuses to start if the
 *                         planned confirm-call count exceeds n
 *   --limit <n>           truncate the plan to the first n confirm entries
 *                         (deterministic google_place_id order); the rest
 *                         stay unprocessed for a later run. Dry-run tool.
 *   --rematch             also reprocess terminal-status places (prompts a
 *                         larger plan; use for threshold changes only)
 *
 * Env: GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 *      SUPABASE_SERVICE_ROLE_KEY (environment only, never read from files).
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
  const argv = process.argv.slice(2);
  const probe = argv.includes("--probe-kensington");
  const full = argv.includes("--full");
  const rematch = argv.includes("--rematch");
  const maxCallsIndex = argv.indexOf("--max-calls");
  const maxCalls =
    maxCallsIndex >= 0
      ? Number.parseInt(argv[maxCallsIndex + 1] ?? "", 10)
      : NaN;

  if (probe === full) {
    console.error("Exactly one of --probe-kensington or --full is required.");
    process.exit(1);
  }
  if (!Number.isInteger(maxCalls) || maxCalls < 0) {
    console.error("--max-calls <n> is required.");
    process.exit(1);
  }

  const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const limitIndex = argv.indexOf("--limit");
  const limit =
    limitIndex >= 0 ? Number.parseInt(argv[limitIndex + 1] ?? "", 10) : null;
  if (limitIndex >= 0 && (!Number.isInteger(limit) || limit! < 1)) {
    console.error("--limit requires a positive integer.");
    process.exit(1);
  }

  const plan = await buildMatchPlan(supabase, "toronto", new Date(), {
    rematch,
    within: probe ? KENSINGTON_BBOX : undefined,
  });
  const plannedBeforeLimit = plan.toConfirm.length;
  if (limit !== null) plan.toConfirm = plan.toConfirm.slice(0, limit);

  console.log(
    JSON.stringify(
      {
        mode: probe ? "probe-kensington" : "full",
        rematch,
        fsq_corpus: plan.fsqCorpusSize,
        planned_confirm_calls: plan.toConfirm.length,
        planned_before_limit: plannedBeforeLimit,
        no_candidates: plan.noCandidates.length,
        skipped_terminal: plan.skippedTerminal,
        skipped_no_coords: plan.skippedNoCoords,
        est_cost_usd_list: Number(
          (plan.toConfirm.length * PLACE_DETAILS_PRO_USD_PER_CALL).toFixed(3),
        ),
      },
      null,
      2,
    ),
  );

  if (plan.toConfirm.length > maxCalls) {
    console.error(
      `Refusing to start: plan needs ${plan.toConfirm.length} confirm calls, --max-calls is ${maxCalls}.`,
    );
    process.exit(1);
  }

  const report = await runMatching({
    supabase,
    details: createDetailsClient({ apiKey }),
    instrumentation: createInstrumentation(supabase),
    plan,
  });

  // Checkpoint 2 addition 3: the raw score list rides in the report so the
  // reviewer judges thresholds against real name pairs, not just outcomes.
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
