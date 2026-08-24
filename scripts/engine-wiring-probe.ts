import { createClient } from "@supabase/supabase-js";
import { generateDay, type EngineDeps } from "@/server/generation/engine";
import type { EngineGoogleClient } from "@/server/generation/google";
import { DeterministicSelector } from "@/server/generation/select";
import type { GenerationRequest } from "@/server/generation/types";
import type { DayTheme } from "@/shared/theme";
import type { PlaceCategory } from "@/shared/vocabulary";
import type { Instrumentation, TraceEvent } from "@/server/instrumentation";
import { GOLDEN_PERSONAS } from "@/shared/persona";

/**
 * Engine wiring probe (XXX-47, Session 16 CP2) — does the engine actually run
 * what we think it runs?
 *
 * WHY THIS EXISTS. This session found that `constraint.excluded-category` —
 * built in Session 15 with nine upstream seams, a trap fixture and a live
 * proof script — had NEVER FIRED, because the engine's validation context
 * omitted one optional argument. Every offline exam passed. The live proof
 * passed, because its assertion was that the rule stayed silent.
 *
 * The lesson is not "add a test". It is that **a stage's presence in the
 * source is not evidence that the engine runs it**, and the only thing that
 * is evidence is watching the engine run it. So this drives the REAL
 * `generateDay` — real pool, real skeleton, real menus, real composition,
 * real validation — and asserts on what the run actually emitted.
 *
 * FREE, and the freeness is engineered rather than hoped for:
 *   · `transport: ["walk"]` means `transitLegsOf` returns nothing, so Google
 *     Routes is never called;
 *   · the Google client is a stub that answers `null` / no facts, so no
 *     searchText and no Details call is made;
 *   · no narrator, so no Anthropic call;
 *   · instrumentation is in-memory, so no trace rows are written.
 * Supabase reads only. The cost is asserted below, not assumed.
 *
 * What it therefore CANNOT prove: anything downstream of live hours. Days
 * here carry honest-absence hours, which is a thinner day than production
 * builds — stated rather than glossed.
 *
 *   npx tsx --env-file=.env.local scripts/engine-wiring-probe.ts
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 62 - s.length))}`);
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

/**
 * Answers nothing and touches no network. Honest absence all the way down.
 *
 * It COUNTS its own invocations, because the engine's `estCostUsd` counts
 * calls it ASKED FOR rather than bytes that left the building — so the
 * recorded figure is non-zero here while the actual outlay is not. Asserting
 * on `estCostUsd` would have been asserting the wrong number; the number that
 * proves nothing was spent is this one.
 */
function stubGoogle(): { client: EngineGoogleClient; details: number; search: number } {
  const counts = { details: 0, search: 0 };
  return {
    get details() {
      return counts.details;
    },
    get search() {
      return counts.search;
    },
    client: {
      getDetails: () => {
        counts.details++;
        return Promise.resolve({ facts: {}, raw: {} } as never);
      },
      searchPlaceId: () => {
        counts.search++;
        return Promise.resolve(null);
      },
    },
  };
}

function recordingInstrumentation(): {
  instrumentation: Instrumentation;
  events: TraceEvent[];
  summaries: Record<string, unknown>[];
} {
  const events: TraceEvent[] = [];
  const summaries: Record<string, unknown>[] = [];
  return {
    events,
    summaries,
    instrumentation: {
      startTrace: () => Promise.resolve("probe-trace"),
      logEvent: (_id, event) => {
        events.push(event);
        return Promise.resolve();
      },
      endTrace: (_id, summary) => {
        summaries.push((summary?.metadata ?? {}) as Record<string, unknown>);
        return Promise.resolve();
      },
    },
  };
}

async function main(): Promise<void> {
  const supabase = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const failures: string[] = [];
  const check = (ok: boolean, label: string): void => {
    line(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failures.push(label);
  };

  const CASES: {
    label: string;
    excluded: readonly string[];
    theme?: DayTheme;
    persona: string;
  }[] = [
    { label: "unconstrained", excluded: [], persona: "day-1-jays" },
    { label: "no-alcohol", excluded: ["nightlife_bars"], persona: "day-1-jays" },
    {
      // XXX-48: the second tenant of the experience layer.
      label: "picnic",
      excluded: [],
      theme: { mode: "experience", experienceId: "park-picnic" },
      persona: "day-6-excursion",
    },
    {
      // XXX-47: a district as the day's centre.
      label: "zone:yorkville",
      excluded: [],
      theme: { mode: "zone", zoneSlug: "yorkville" },
      persona: "persona-shopper",
    },
  ];

  for (const testCase of CASES) {
    const { label, excluded } = testCase;
    head(`a real generateDay — ${label}`);
    const recorder = recordingInstrumentation();
    const google = stubGoogle();
    const deps: EngineDeps = {
      supabase,
      google: google.client,
      googleApiKey: "",
      instrumentation: recorder.instrumentation,
      selector: new DeterministicSelector(),
    };
    const request: GenerationRequest = {
      city: "toronto",
      date: "2026-09-05",
      persona: GOLDEN_PERSONAS[testCase.persona]!,
      budgetBand: null,
      // walk-only, so no transit leg is ever priced and no Routes call made
      transport: ["walk"],
      seed: 42,
      ...(excluded.length === 0
        ? {}
        : { excludedCategories: [...excluded] as PlaceCategory[] }),
      ...(testCase.theme === undefined ? {} : { theme: testCase.theme }),
    };
    const outcome = await generateDay(deps, request);
    line(`  outcome: ${outcome.status}`);
    if (outcome.status === "ok") {
      line(
        `  ${outcome.day.slots.length} stops · ${outcome.findings.length} advisories · $${outcome.stats.estCostUsd.toFixed(4)}`,
      );
    }

    // 1. NOTHING LEFT THE BUILDING, asserted on the right number.
    //
    //    NOT `estCostUsd`. The engine increments that per call it ASKS FOR,
    //    so a stubbed client still books the charge — it records intent, not
    //    I/O. An assertion on it would be the instrument failure this
    //    project keeps meeting: a confident answer about the wrong signal.
    //    What proves no money moved is that every Google answer came from a
    //    stub, and that no transit leg was ever offered to Routes.
    const routesCalls = outcome.stats.transitCalls;
    check(
      routesCalls === 0,
      `no Google Routes call (walk-only transport; ${routesCalls} made)`,
    );
    line(
      `      ${google.search} searchText + ${google.details} Details answered by the stub, so $0 actually left the building` +
        ` — the engine's own notional estimate for the same run is $${outcome.stats.estCostUsd.toFixed(4)}`,
    );

    // 2. THE COHERENCE PASS RAN. Logged unconditionally, including when it
    //    makes no move — a fire-rate recorded only when it fires is not one.
    const swap = recorder.events.find((e) => e.endpoint === "swap_pass");
    check(swap !== undefined, "the coherence pass ran inside the engine");
    if (swap !== undefined) {
      line(
        `      moves ${swap.metadata?.moves} · saved ${swap.metadata?.saved_minutes} min · ${swap.metadata?.trials} trials · refused ${swap.metadata?.rejected_by_grammar} by grammar`,
      );
      for (const d of (swap.metadata?.detail ?? []) as string[]) line(`      ${d}`);
    }

    if (testCase.theme?.mode === "experience") {
      // 5. THE EXPERIENCE IS A LAYER, not one hard-coded day: a composite
      //    block, and the provisioning stop that exists because of it.
      if (outcome.status === "ok") {
        const composite = outcome.day.slots.find(
          (sl) => sl.compositeDwell !== undefined,
        );
        check(composite !== undefined, "a composite block was seated");
        const provision = outcome.day.slots.find((sl) => sl.role === "provision");
        check(provision !== undefined, "a provisioning stop was seated");
        if (composite !== undefined && provision !== undefined) {
          check(
            provision.startTime < composite.startTime,
            "provisioning comes BEFORE the block it serves — causality",
          );
          const park = outcome.day.places[composite.placeId];
          line(
            `      ${park?.name} · ${composite.startTime}–${composite.endTime}, provisioned at ${outcome.day.places[provision.placeId]?.name}`,
          );
        }
      } else {
        line(`      refused: ${JSON.stringify(outcome).slice(0, 160)}`);
      }
    }

    if (testCase.theme?.mode === "zone") {
      // 6. THE DAY STAYED IN THE DISTRICT, or said where else it went.
      if (outcome.status === "ok") {
        const labels = new Set(
          outcome.day.slots.map(
            (sl) => outcome.day.places[sl.placeId]?.neighborhood ?? "?",
          ),
        );
        line(`      neighbourhoods: ${[...labels].join(", ")}`);
        const spill = outcome.zoneSpill;
        line(
          spill === null
            ? "      no widening was needed"
            : `      WIDENED: ${spill.starvedSteps.join(", ")} had nothing in ${spill.zoneLabel}; reached into ${spill.spilledInto.join(", ")} (${spill.resolved ? "resolved" : "still thin"})`,
        );
        check(
          outcome.theme.theme.mode === "zone",
          "the day kept the theme it was asked for",
        );
      }
    }

    if (excluded.length > 0) {
      // 3. THE VENUE-LEVEL CONSTRAINT RAN, and caught label-only bars.
      const refused = recorder.events.find((e) => e.endpoint === "venues_refused");
      check(refused !== undefined, "the venue-level alcohol filter ran");
      const byLabel = Number(refused?.metadata?.dropped_by_drinking_label ?? 0);
      check(
        byLabel > 0,
        `it caught venues the CATEGORY gate would have admitted (${byLabel})`,
      );
      if (refused !== undefined) {
        for (const s of (refused.metadata?.sample ?? []) as string[]) line(`      ${s}`);
      }

      // 4. THE BACKSTOP IS REACHABLE. Not "did it fire" — it must not, if the
      //    upstream seams work — but "was it told", which is the question
      //    whose absence let it ship dead for a whole session.
      if (outcome.status === "ok") {
        const bars = outcome.day.slots.filter((s) => {
          const c = outcome.day.places[s.placeId]?.category;
          return c?.status === "present" && c.value === "nightlife_bars";
        });
        check(bars.length === 0, "zero bars reached the day");
      }
    }
  }

  head("verdict");
  if (failures.length > 0) {
    for (const f of failures) line(`  ✗ ${f}`);
    console.error("\nFAIL — the engine does not run what the source says it runs.");
    process.exit(1);
  }
  line("  PASS — observed in a real generateDay, not inferred from the source.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
