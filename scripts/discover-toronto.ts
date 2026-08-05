import { createClient } from "@supabase/supabase-js";
import { createInstrumentation } from "../src/server/instrumentation";
import { createPlacesClient } from "../src/server/discovery/client";
import { runDiscovery } from "../src/server/discovery/ingest";
import { buildRunPlan } from "../src/server/discovery/plan";
import { DISCOVERY_FIELD_MASK } from "../src/server/discovery/fieldmask";

/**
 * XXX-22 Toronto discovery ingestion. SPENDS MONEY — every invocation goes
 * through the permission prompt (settings.json ask rule) by design.
 *
 * Modes (explicit, no default — spending must be stated):
 *   --probe <category>:<anchor>[,<category>:<anchor>...]   run only these cells
 *   --full                                                 run the whole plan
 * Guard:
 *   --max-calls <n>   abort before starting if the plan exceeds n calls
 *                     (required for --probe; defaults to the plan size on --full)
 *
 * Env (via environment only — never read from files by the session):
 *   GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: string[]): { cellSpecs: string[] | null; maxCalls: number | null } {
  const probeIndex = argv.indexOf("--probe");
  const fullMode = argv.includes("--full");
  const maxCallsIndex = argv.indexOf("--max-calls");
  const maxCalls =
    maxCallsIndex >= 0 ? Number.parseInt(argv[maxCallsIndex + 1] ?? "", 10) : null;

  if (fullMode === (probeIndex >= 0)) {
    console.error("Exactly one of --full or --probe <cat:anchor,...> is required.");
    process.exit(1);
  }
  if (probeIndex >= 0) {
    const spec = argv[probeIndex + 1];
    if (!spec || !Number.isInteger(maxCalls)) {
      console.error("--probe requires <category>:<anchor>[,...] and --max-calls <n>.");
      process.exit(1);
    }
    return { cellSpecs: spec.split(","), maxCalls };
  }
  return { cellSpecs: null, maxCalls };
}

async function main() {
  const { cellSpecs, maxCalls } = parseArgs(process.argv.slice(2));

  const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const fullPlan = buildRunPlan();
  const plan = cellSpecs
    ? fullPlan.filter((cell) =>
        cellSpecs.includes(`${cell.category}:${cell.anchor}`),
      )
    : fullPlan;

  if (cellSpecs && plan.length !== cellSpecs.length) {
    const known = new Set(fullPlan.map((c) => `${c.category}:${c.anchor}`));
    const bad = cellSpecs.filter((s) => !known.has(s));
    console.error(`Unknown probe cell(s): ${bad.join(", ")}`);
    process.exit(1);
  }
  if (maxCalls !== null && plan.length > maxCalls) {
    console.error(
      `Refusing to start: plan is ${plan.length} calls, --max-calls is ${maxCalls}.`,
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        mode: cellSpecs ? "probe" : "full",
        planned_calls: plan.length,
        field_mask: DISCOVERY_FIELD_MASK,
        est_cost_usd_list: Number((plan.length * 0.032).toFixed(3)),
      },
      null,
      2,
    ),
  );

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const report = await runDiscovery({
    supabase,
    places: createPlacesClient({ apiKey }),
    instrumentation: createInstrumentation(supabase),
    plan,
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
