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
import { toTimelineDay } from "@/shared/timeline-mapping";
import type { TimelineDay } from "@/shared/timeline";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { capReached, readQuota, type QuotaStatus } from "./quota";

export const NARRATION_SOURCE = "anthropic:claude-sonnet-5";

export interface TastingRequest {
  personaKey: string;
  date: string;
  budgetMax: number | null;
  seed: number | null;
}

export interface TastingMeter {
  traceId: string;
  seed: number;
  estCostUsd: number;
  totalMs: number;
  stageMs: Record<string, number>;
  detailsCalls: number;
  searchTextCalls: number;
  linksMinted: number;
  transitCalls: number;
  validationPasses: number;
  repairLog: { pass: number; ruleIds: string[] }[];
  founderOverrides: number;
  founderExpired: number;
  anthropic: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estCostUsd: number;
    contractRetries: number;
    toneRetries: number;
  };
  quota: QuotaStatus;
}

export type TastingOutcome =
  | {
      status: "ok";
      day: TimelineDay;
      headline: string;
      advisories: { ruleId: string; text: string }[];
      dayNotes: string[];
      unfilled: { label: string; cause: string }[];
      /** Distinct fact/travel sources on this day — attribution keys off it. */
      sources: string[];
      meter: TastingMeter;
    }
  | {
      /** Grammar-loop exhaustion. Surfaced honestly; a founder should see it. */
      status: "failed";
      headline: string;
      violations: { ruleId: string; text: string }[];
      meter: TastingMeter;
    }
  | { status: "capped"; quota: QuotaStatus };

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
  if (capReached(quota)) return { status: "capped", quota };

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

  if (outcome.status === "failed") {
    return {
      status: "failed",
      headline: outcome.narrated.headline,
      violations: outcome.narrated.violations.map((v) => ({
        ruleId: v.ruleId,
        text: v.text,
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
    day,
    headline: outcome.narrated.headline,
    advisories: outcome.narrated.advisories.map((a) => ({
      ruleId: a.ruleId,
      text: a.text,
    })),
    dayNotes: outcome.dayNotes,
    unfilled: outcome.stats.unfilled.map((u) => ({
      label: u.label,
      cause: u.cause,
    })),
    sources: [...sources].sort(),
    meter,
  };
}
