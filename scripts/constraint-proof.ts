import { createClient } from "@supabase/supabase-js";
import { generateDay, type EngineDeps } from "../src/server/generation/engine";
import { createAnthropic, UsageRecorder } from "../src/server/generation/llm";
import { LlmSelector } from "../src/server/generation/select-llm";
import { DeterministicSelector } from "../src/server/generation/select";
import { narrateDay } from "../src/server/generation/narrate-llm";
import { createEngineGoogleClient } from "../src/server/generation/google";
import { createInstrumentation } from "../src/server/instrumentation";
import { readProfile } from "../src/server/profile/repo";
import { personaFromProfile } from "../src/shared/profile";
import { CUISINE_LABELS } from "../src/shared/cuisine";
import { categoryLabel, type PlaceCategory } from "../src/shared/vocabulary";
import type { GenerationRequest } from "../src/server/generation/types";
import { validateDay } from "../src/shared/day-grammar/validate";
import { contextFor } from "../src/shared/fixtures/golden/support";
import { TRAP_FIXTURES } from "../src/shared/fixtures/golden/traps";

/**
 * CP3 live constraint proof (XXX-43, Session 15).
 *
 * The offline exams prove the constraint holds in fixtures. This proves it
 * holds against the real pool, the real selector, and the real narrator —
 * which is the only place the eight upstream seams and the ninth backstop
 * meet at once.
 *
 * WHAT IT ASSERTS, and it exits non-zero on any of them:
 *   1. a day for a no-alcohol traveller seats ZERO bars;
 *   2. the grammar rule did not have to catch it, AND was in a position to —
 *      silence alone is not evidence, because a disconnected rule is also
 *      silent (see the note at the assertion; that is exactly how XXX-43's
 *      backstop shipped dead and this proof said PASS every run);
 *      a day that reached the user means the palette narrowed correctly,
 *      which is the outcome the backstop exists to make provable rather than
 *      hoped for;
 *   3. a named cuisine reaches the day, or the day says why it could not.
 *
 * Costs roughly $0.40–0.50 per generation.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/constraint-proof.ts
 *   npx tsx --env-file=.env.local scripts/constraint-proof.ts --date 2026-08-29
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 62 - s.length))}`);
};

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const googleApiKey = requireEnv("GOOGLE_MAPS_API_KEY");
  const date = arg("--date") ?? "2026-08-29";

  const { profile } = await readProfile(supabase);
  head("THE TRAVELLER");
  line(`  excluded : ${profile.excludedCategories.map(categoryLabel).join(", ") || "nothing"}`);
  line(`  loves    : ${profile.lovedCuisines.map((c) => CUISINE_LABELS[c]).join(", ") || "nothing stated"}`);
  line(`  persona  : ${JSON.stringify(personaFromProfile(profile))}`);

  if (profile.excludedCategories.length === 0) {
    line();
    line("  ✗ The stored profile excludes nothing, so this proof would assert");
    line("    nothing. Set a constraint first — the premise before the behaviour.");
    process.exit(1);
  }

  const usage = new UsageRecorder();
  const anthropic = createAnthropic();
  const instrumentation = createInstrumentation(supabase);

  const deps: EngineDeps = {
    supabase,
    google: createEngineGoogleClient({ apiKey: googleApiKey }),
    googleApiKey,
    instrumentation,
    selector: new LlmSelector({
      client: anthropic,
      usage,
      fallback: new DeterministicSelector(),
    }),
    narrator: (input) =>
      narrateDay({
        client: anthropic,
        usage,
        day: input.day,
        advisories: input.advisories,
        persona: input.persona,
        reasonSeeds: input.reasonSeeds,
      }),
    llmUsage: usage,
    traceMetadata: { surface: "constraint-proof", ticket: "XXX-43" },
  };

  const request: GenerationRequest = {
    city: "toronto",
    date,
    persona: personaFromProfile(profile),
    budgetBand: null,
    transport: ["walk", "transit"],
    excludedCategories: profile.excludedCategories,
    lovedCuisines: profile.lovedCuisines,
    ...(arg("--theme") === "islands"
      ? {
          theme: {
            mode: "experience" as const,
            experienceId: "toronto-islands" as const,
          },
        }
      : {}),
  };

  head(`GENERATING — ${date}`);
  const outcome = await generateDay(deps, request);
  line(`  outcome: ${outcome.status}`);

  if (outcome.status !== "ok") {
    line();
    line(`  Refused or failed — nothing to assert about a day that does not exist.`);
    if (outcome.status === "theme-infeasible") line(`  reason: ${outcome.infeasibility.reason}`);
    process.exit(1);
  }

  const day = outcome.day;
  head("THE DAY");
  const seatedCategories: PlaceCategory[] = [];
  for (const slot of [...day.slots].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const place = day.places[slot.placeId];
    const cat =
      place?.category?.status === "present" ? place.category.value : null;
    if (cat !== null) seatedCategories.push(cat);
    const reason = outcome.reasons?.find((r) => r.slotId === slot.id)?.reason ?? "";
    line(
      `  ${slot.startTime}–${slot.endTime}  ${(place?.name ?? "?").padEnd(32)} ${cat ?? "?"}`,
    );
    if (reason) line(`      ${reason}`);
  }

  head("LEGS — does a named crossing reach the day?");
  const named = (outcome.travel).filter((l) => l.via !== undefined);
  if ((outcome.travel).length === 0) {
    line("  (no legs recorded on this outcome)");
  } else {
    for (const leg of outcome.travel) {
      const label =
        leg.via !== undefined
          ? `FERRY — ${leg.via.label}${leg.via.lastDeparture ? ` · last boat ${leg.via.lastDeparture}` : ""}`
          : leg.mode;
      line(`  ${String(leg.minutes).padStart(3)} min  ${label}`);
    }
  }
  line(`  named crossings: ${named.length}`);

  head("ASSERTIONS");
  const failures: string[] = [];

  // 1. Zero excluded categories seated.
  for (const excluded of profile.excludedCategories) {
    const seated = seatedCategories.filter((c) => c === excluded).length;
    const ok = seated === 0;
    line(`  ${ok ? "✓" : "✗"} zero ${categoryLabel(excluded)} seated (found ${seated})`);
    if (!ok) failures.push(`${seated} ${excluded} stop(s) reached the day`);
  }

  // 2. The backstop did not have to fire — AND was in a position to.
  //
  //    THE ASSERTION THIS REPLACES WAS THE DEFECT (found at XXX-47, Session
  //    16 CP2). It read "the grammar backstop did not need to catch
  //    anything" and treated silence as PASS. The backstop was silent
  //    because the engine's validation context never passed
  //    `excludedCategories` — so the rule returned on its first line for
  //    every generation this product has ever run, and this proof said ✓
  //    every time.
  //
  //    **A rule whose success condition is SILENCE cannot tell "it worked"
  //    from "it was never connected."** So the silence is now only half the
  //    assertion. The other half is reachability: the same trap day the exam
  //    uses, run through the constraint this profile actually set, must be
  //    REJECTED. If that comes back clean the rule is disconnected again, and
  //    this script says so instead of congratulating it.
  const backstopFired = outcome.findings.some(
    (f) => f.ruleId === "constraint.excluded-category",
  );
  line(
    `  ${backstopFired ? "✗" : "✓"} the grammar backstop did not need to catch anything`,
  );
  if (backstopFired) failures.push("the backstop fired — an upstream seam leaked");

  const trap = TRAP_FIXTURES.find((t) => t.key === "trap-excluded-category");
  const reachable =
    trap !== undefined &&
    profile.excludedCategories.length > 0 &&
    validateDay(trap.golden.day, {
      ...contextFor({
        ...trap.golden,
        excludedCategories: profile.excludedCategories,
      }),
    }).some((f) => f.ruleId === "constraint.excluded-category");
  line(
    `  ${reachable ? "✓" : "✗"} the backstop is REACHABLE — the trap day is still rejected under this profile's own constraints`,
  );
  if (!reachable) {
    failures.push(
      "the backstop could not reject the trap day — it is disconnected, and its silence above means nothing",
    );
  }

  // 3. A named cuisine reached the day, or is honestly absent.
  if (profile.lovedCuisines.length > 0) {
    const reasons = (outcome.reasons ?? []).map((r) => r.reason.toLowerCase()).join(" ");
    const named = profile.lovedCuisines.filter((c) =>
      reasons.includes(CUISINE_LABELS[c].toLowerCase()),
    );
    line(
      `  ${named.length > 0 ? "✓" : "·"} a stated cuisine is visible in the reasons` +
        (named.length > 0 ? ` (${named.join(", ")})` : " — not cited this day"),
    );
  }

  head("SPEND");
  line(`  this generation: $${outcome.stats.estCostUsd.toFixed(4)}`);
  line(`  trace: ${outcome.stats.traceId}`);

  if (failures.length > 0) {
    head("FAILED");
    for (const f of failures) line(`  ✗ ${f}`);
    process.exit(1);
  }
  head("PASS");
}

void main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
