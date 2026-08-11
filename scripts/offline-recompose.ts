import { createClient } from "@supabase/supabase-js";
import { buildSkeleton, composeDay } from "@/server/generation/compose";
import { hardFilter } from "@/server/generation/filters";
import { retrieveCandidates, zonesFor } from "@/server/generation/retrieve";
import { scoreAll } from "@/server/generation/score";
import type { Candidate, GenerationRequest, Selection } from "@/server/generation/types";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { timeToMinutes } from "@/shared/time";
import { PLACE_CATEGORIES } from "@/shared/vocabulary";

/**
 * Offline recompose of the matrix — the $0 half of the CP2 proof.
 *
 * Reads the candidate pool the PAID runs already persisted (Supabase
 * `places` + `facts`; `retrieveCandidates` touches no Google endpoint),
 * then builds each golden persona's skeleton, selects deterministically and
 * composes. No Details call, no Anthropic call, no forecast — so the
 * anchor-seating question can be asked as many times as it takes for
 * nothing.
 *
 * What it cannot prove: live travel times (this uses the Haversine stub,
 * as the report's own fallback does) and LLM selection. Those are the live
 * confirm's job, and the honest division is stated rather than blurred.
 *
 *   npx tsx --env-file=.env.local scripts/offline-recompose.ts [--date YYYY-MM-DD] [--seed n]
 */

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const date = arg("--date") ?? "2026-08-15";
  const seed = Number(arg("--seed") ?? 42);
  const supabase = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
  );

  console.log(
    `offline recompose — date=${date} seed=${seed} · DB pool only, $0 (no Google, no Anthropic)\n`,
  );

  const keys = Object.keys(GOLDEN_PERSONAS);
  let seated = 0;
  const rows: string[] = [];

  for (const key of keys) {
    const persona = GOLDEN_PERSONAS[key];
    const request: GenerationRequest = {
      city: "toronto",
      date,
      persona,
      budgetBand: key === "day-4-budget" ? { min: 0, max: 70, currency: "CAD" } : null,
      transport: ["walk", "transit"],
      seed,
    };

    const skeleton = buildSkeleton(request);
    const zones = zonesFor(persona.lens, []);
    const pool = await retrieveCandidates(
      supabase,
      "toronto",
      [...PLACE_CATEGORIES],
      zones,
    );
    const { kept } = hardFilter(
      pool,
      date,
      skeleton.daySpan,
      (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min,
    );
    const scored = scoreAll(kept, persona, request.budgetBand, seed);
    const byId = new Map(scored.map((c: Candidate) => [c.place.id, c]));

    // Deterministic selection, same rule the DeterministicSelector uses:
    // the best-scoring unused candidate whose category the intent wants.
    const used = new Set<string>();
    const selections: Selection[] = [];
    for (const intent of skeleton.intents) {
      const pick = scored.find(
        (c: Candidate) =>
          intent.categories.includes(c.category) && !used.has(c.place.id),
      );
      if (pick !== undefined) {
        used.add(pick.place.id);
        selections.push({ intentId: intent.id, placeId: pick.place.id });
      }
    }

    const composed = composeDay({
      request,
      skeleton,
      selections,
      candidatesById: byId,
      travel: new HaversineStubProvider(),
      outdoorLatestEnd: timeToMinutes("20:30"),
    });

    const anchorIntent = skeleton.intents.find((i) => i.role === "anchor");
    const anchorSlot = composed.day.slots.find((s) => s.role === "anchor");
    const ok = anchorSlot !== undefined;
    if (ok) seated++;
    const anchorPlace =
      anchorSlot === undefined
        ? null
        : composed.day.places[anchorSlot.placeId]?.name;

    rows.push(
      `${ok ? "  OK " : "  ** "}${key.padEnd(17)}pool=${String(pool.length).padStart(3)} ` +
        `tpl=${skeleton.templateId.padEnd(11)} elected=${(skeleton.electedAnchor?.category ?? "user-anchor").padEnd(18)}` +
        `stops=${composed.day.slots.length} anchor=${ok ? anchorPlace : "MISSING"}` +
        (anchorIntent !== undefined && composed.unfilled.includes(anchorIntent.id)
          ? " [reported unfilled]"
          : "") +
        (skeleton.droppedSteps.length > 0
          ? ` dropped=${skeleton.droppedSteps.map((d) => d.step).join(",")}`
          : ""),
    );
  }

  console.log(rows.join("\n"));
  console.log(
    `\nanchors seated: ${seated}/${keys.length}${seated === keys.length ? "  → PASS" : "  → FAIL"}`,
  );
  if (seated !== keys.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
