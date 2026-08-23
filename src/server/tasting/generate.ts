/**
 * The tasting room's generation service (XXX-32).
 *
 * Business logic lives here, not in the route handler (constraint 5 —
 * the future native app is a new client, not a rewrite). The handler
 * gates, parses and serializes; this composes the engine, maps the day
 * for the timeline, and leaves the trace carrying everything the verdict
 * routes will need to adjudicate a claim.
 */

import { createInstrumentation } from "../instrumentation";
import { generateDay, type EngineDeps } from "../generation/engine";
import { createEngineGoogleClient } from "../generation/google";
import { createAnthropic, UsageRecorder } from "../generation/llm";
import { narrateDay } from "../generation/narrate-llm";
import { DeterministicSelector } from "../generation/select";
import { LlmSelector } from "../generation/select-llm";
import type { GenerationRequest } from "../generation/types";
import { getServerSupabase } from "../supabase";
import { buildTastingContext, TASTING_SURFACE } from "../feedback/shown";
import { buildSyntheticDay } from "./synthetic";
import { toTimelineDay } from "@/shared/timeline-mapping";
import type { Violation } from "@/shared/day-grammar/types";
import { FORECAST_HORIZON_DAYS } from "@/shared/scheduling-windows";
import type { WeatherBlindNotice } from "@/shared/tasting";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { themeId, type DayTheme } from "@/shared/theme";
import {
  capReached,
  readQuota,
  TASTING_CAP_CONFIG_LOCATION,
} from "./quota";

export const NARRATION_SOURCE = "anthropic:claude-sonnet-5";

export interface TastingRequest {
  personaKey: string;
  date: string;
  budgetMax: number | null;
  seed: number | null;
  /**
   * The picker's choice. `null` = "concierge's choice", which is the ABSENCE
   * of a request rather than a fourth mode — the engine derives one.
   */
  theme?: DayTheme | null;
  /** Trip circumstance. `null` = unknown, and the page says so. */
  lodging?: { lat: number; lng: number } | null;
  /**
   * A canned day through the real view-model path, for feeling the page
   * while Google Details quota is unavailable. Costs nothing, spends no
   * quota, and cannot write ground truth (see synthetic.ts).
   */
  synthetic?: boolean;
}

export type { TastingMeter, TastingOutcome } from "@/shared/tasting";
import type { TastingMeter, TastingOutcome } from "@/shared/tasting";

/**
 * The preview path. Same mapping, same components, same verdict
 * round-trip; a trace is written so verdicts have somewhere to attach,
 * marked synthetic so no fact write can follow from a fabricated card.
 */
async function runSyntheticDay(
  input: TastingRequest,
  nowIso: string,
): Promise<TastingOutcome> {
  const supabase = getServerSupabase();
  const built = await buildSyntheticDay(supabase, input.date, nowIso);
  const instrumentation = createInstrumentation(supabase);
  const traceId = await instrumentation.startTrace("day_generation", {
    surface: TASTING_SURFACE,
    synthetic: true,
    tasting: buildTastingContext({
      day: built.day,
      findings: [],
      personaKey: input.personaKey,
      synthetic: true,
    }),
  });
  await instrumentation.endTrace(traceId, {
    totalCostUsd: 0,
    metadata: {
      surface: TASTING_SURFACE,
      synthetic: true,
      outcome: "ok",
      tasting: buildTastingContext({
        day: built.day,
        findings: [],
        personaKey: input.personaKey,
        synthetic: true,
      }),
    },
  });

  const day = toTimelineDay({
    day: built.day,
    legs: built.legs,
    reasons: built.reasons,
    reasonSource: "synthetic_preview",
    generatedAt: nowIso,
  });
  const sources = new Set<string>();
  for (const place of Object.values(day.places)) {
    for (const fact of [place.priceRange, place.hoursToday, place.vibe]) {
      if (fact.status !== "unknown") sources.add(fact.source);
    }
  }
  for (const leg of Object.values(day.travel)) {
    if (leg.source !== undefined) sources.add(leg.source);
  }

  return {
    status: "ok",
    synthetic: true,
    day,
    // A fabricated day is not a weather claim either way, and the preview
    // exists to feel the page rather than to vet a date.
    weatherBlind: null,
    openPeriods: [],
    headline: built.headline,
    advisories: built.advisories,
    dayNotes: built.dayNotes,
    unfilled: [],
    // The synthetic day is a fixed fabrication with a full-length centre;
    // it has no election to degrade.
    anchorDegraded: null,
    // A fabrication is not a themed day either. Labelled `venue` because
    // that is what it looks like, and `requested` because nothing derived it.
    theme: { id: "venue", origin: "requested", reason: null },
    sources: [...sources].sort(),
    meter: {
      traceId,
      seed: 0,
      estCostUsd: 0,
      totalMs: 0,
      stageMs: {},
      detailsCalls: 0,
      searchTextCalls: 0,
      linksMinted: 0,
      transitCalls: 0,
      validationPasses: 0,
      repairLog: [],
      founderOverrides: 0,
      founderExpired: 0,
      anthropic: {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estCostUsd: 0,
        contractRetries: 0,
        toneRetries: 0,
      },
      quota: await readQuota(supabase, nowIso),
    },
  };
}

/**
 * Whether this day was vetted weather-blind, and how far out it is.
 *
 * Read off the grammar's own `weather.unknown` advisory rather than
 * recomputed from the date: the advisory fires because the environment had
 * no row, which is the fact. Date arithmetic would only ever be a guess
 * about what the table holds — and it would be a confident guess on
 * exactly the days the table is stale.
 */
export function weatherBlindNotice(
  findings: Violation[],
  date: string,
  nowIso: string,
): WeatherBlindNotice | null {
  const blind = findings.some((f) => f.ruleId === "weather.unknown");
  if (!blind) return null;
  const dayMs = 86_400_000;
  const today = Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`);
  const target = Date.parse(`${date}T00:00:00Z`);
  return {
    date,
    daysOut: Math.round((target - today) / dayMs),
    horizonDays: FORECAST_HORIZON_DAYS,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export async function runTastingGeneration(
  input: TastingRequest,
  nowIso = new Date().toISOString(),
): Promise<TastingOutcome> {
  const supabase = getServerSupabase();

  const quota = await readQuota(supabase, nowIso);
  // The synthetic day spends nothing, so the runaway guard does not
  // apply to it: capping a free preview would be theatre.
  if (!input.synthetic && capReached(quota)) {
    return {
      status: "capped",
      quota,
      raiseAt: TASTING_CAP_CONFIG_LOCATION,
      note: "A runaway guard, not a budget. Raise it deliberately; the budget lives on the meter and the GCP billing alerts.",
    };
  }

  if (input.synthetic === true) return runSyntheticDay(input, nowIso);

  const persona = GOLDEN_PERSONAS[input.personaKey];
  if (persona === undefined) {
    throw new Error(`unknown persona "${input.personaKey}"`);
  }

  const googleApiKey = requireEnv("GOOGLE_MAPS_API_KEY");
  const usage = new UsageRecorder();
  const anthropic = createAnthropic();
  const deps: EngineDeps = {
    supabase,
    google: createEngineGoogleClient({ apiKey: googleApiKey }),
    googleApiKey,
    instrumentation: createInstrumentation(supabase),
    // The surface tag is written at trace START so the self-cap counts
    // runs that spent money and then died.
    traceMetadata: { surface: TASTING_SURFACE },
    selector: new LlmSelector({
      client: anthropic,
      usage,
      fallback: new DeterministicSelector(),
    }),
    narrator: (narrateInput) =>
      narrateDay({
        client: anthropic,
        usage,
        day: narrateInput.day,
        advisories: narrateInput.advisories,
        persona: narrateInput.persona,
        reasonSeeds: narrateInput.reasonSeeds,
      }),
    llmUsage: usage,
  };

  const request: GenerationRequest = {
    city: "toronto",
    date: input.date,
    persona,
    budgetBand:
      input.budgetMax === null
        ? null
        : { min: 0, max: input.budgetMax, currency: "CAD" },
    transport: ["walk", "transit"],
    ...(input.seed === null ? {} : { seed: input.seed }),
    ...(input.theme === undefined || input.theme === null
      ? {}
      : { theme: input.theme }),
    ...(input.lodging === undefined || input.lodging === null
      ? {}
      : { lodging: input.lodging }),
  };

  const outcome = await generateDay(deps, request);
  const stats = outcome.stats;
  const meter: TastingMeter = {
    traceId: stats.traceId,
    seed: stats.seed,
    estCostUsd: stats.estCostUsd,
    totalMs: stats.timings.totalMs,
    stageMs: { ...stats.timings },
    detailsCalls: stats.detailsCalls,
    searchTextCalls: stats.searchTextCalls,
    linksMinted: stats.linksMinted,
    transitCalls: stats.transitCalls,
    validationPasses: stats.validationPasses,
    repairLog: stats.repairLog,
    founderOverrides: stats.founderOverrides,
    founderExpired: stats.founderExpired,
    anthropic: stats.anthropic,
    // Re-read so the gauge includes the generation just paid for.
    quota: await readQuota(supabase, new Date().toISOString()),
  };

  /**
   * A REQUESTED theme that could not be built (XXX-40). Its own arm, because
   * nothing went wrong with the generation — the day was never possible on
   * this date. The room must say which theme and why, not show a mainland
   * day under an island name.
   */
  if (outcome.status === "theme-infeasible") {
    return {
      status: "theme-infeasible",
      theme: themeId(outcome.theme),
      reason: outcome.infeasibility.reason,
      detail: outcome.infeasibility.detail,
      meter,
    };
  }

  if (outcome.status === "failed") {
    return {
      status: "failed",
      headline: outcome.narrated.headline,
      violations: outcome.narrated.violations.map((v) => ({
        ruleId: v.ruleId,
        text: v.text,
        slotIds: [...v.slotIds],
      })),
      meter,
    };
  }

  // What the founder is looking at, recorded against the trace so a later
  // verdict is adjudicable without trusting the client (XXX-33).
  const context = buildTastingContext({
    day: outcome.day,
    findings: outcome.findings,
    personaKey: input.personaKey,
  });
  const { data: traceRow, error: traceError } = await supabase
    .from("traces")
    .select("metadata")
    .eq("id", stats.traceId)
    .single();
  if (traceError) {
    throw new Error(`trace read-back failed: ${traceError.message}`);
  }
  const merged = {
    ...(traceRow.metadata as Record<string, unknown>),
    tasting: context,
  };
  const { error: writeError } = await supabase
    .from("traces")
    .update({ metadata: merged })
    .eq("id", stats.traceId);
  if (writeError) {
    // Fail loudly: without this block no verdict on this day can be
    // adjudicated, and a verdict UI over unadjudicable cards is worse
    // than no verdict UI.
    throw new Error(`tasting context write failed: ${writeError.message}`);
  }

  const day = toTimelineDay({
    day: outcome.day,
    legs: outcome.travel,
    reasons: new Map(outcome.reasons.map((r) => [r.slotId, r.reason])),
    reasonSource: NARRATION_SOURCE,
    generatedAt: nowIso,
  });

  const sources = new Set<string>();
  for (const place of Object.values(day.places)) {
    for (const fact of [place.priceRange, place.hoursToday, place.vibe]) {
      if (fact.status !== "unknown") sources.add(fact.source);
    }
  }
  for (const leg of Object.values(day.travel)) {
    if (leg.source !== undefined) sources.add(leg.source);
  }

  return {
    status: "ok",
    synthetic: false,
    day,
    weatherBlind: weatherBlindNotice(outcome.findings, input.date, nowIso),
    openPeriods: outcome.openPeriods,
    headline: outcome.narrated.headline,
    advisories: outcome.narrated.advisories.map((a) => ({
      ruleId: a.ruleId,
      text: a.text,
      // Carried, not dropped — see `NarratedLineView.slotIds`.
      slotIds: [...a.slotIds],
    })),
    dayNotes: outcome.dayNotes,
    unfilled: outcome.stats.unfilled.map((u) => ({
      label: u.label,
      cause: u.cause,
    })),
    anchorDegraded: outcome.anchorDegraded,
    theme: {
      id: themeId(outcome.theme.theme),
      origin: outcome.theme.origin,
      reason:
        outcome.theme.origin === "derived" ? outcome.theme.reason : null,
    },
    sources: [...sources].sort(),
    meter,
  };
}
