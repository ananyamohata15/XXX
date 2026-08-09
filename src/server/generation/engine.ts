/**
 * generateDay(request) → GrammarDay + reasons (XXX-5 Session 9).
 *
 * The orchestrator: retrieval → link-on-demand → request-time facts →
 * hard filters → scoring → selection → composition → grammar loop.
 * Instrumented end to end under one `day_generation` trace; the
 * Details-event count is a first-class metric (CP1 ruling 4 — the 87%
 * canary). Server-side only; no route exists until XXX-17's session.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeViolations,
  regenerationFeedback,
} from "@/shared/day-grammar/describe";
import {
  hasViolations,
  validateDay,
  violationsOnly,
  advisoriesOnly,
} from "@/shared/day-grammar/validate";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { haversineKm } from "@/shared/day-grammar/travel";
import type { Violation } from "@/shared/day-grammar/types";
import { timeToMinutes } from "@/shared/time";
import { CITY_GEO } from "@/shared/vocabulary";
import type { Instrumentation } from "../instrumentation";
import { assembleTravelProvider, type TransitLeg } from "../travel/assemble";
import { GOOGLE_TRANSIT_EST_COST_USD } from "../travel/google-transit";
import {
  buildGrammarContext,
  fetchEnvironment,
  type Environment,
} from "./context";
import type { UsageRecorder } from "./llm";
import type { NarrateResult } from "./narrate-llm";
import { applyDetails } from "./details";
import { hardFilter } from "./filters";
import {
  PLACE_DETAILS_ENTERPRISE_USD_PER_CALL,
  TEXT_SEARCH_IDS_ONLY_USD_PER_CALL,
  type EngineGoogleClient,
} from "./google";
import { judgeAndPersistLink, linkSearchBias, linkSearchQuery } from "./links";
import {
  buildSkeleton,
  composeDay,
  defaultMealPattern,
  modeFor,
  type Skeleton,
} from "./compose";
import { retrieveCandidates, zonesFor } from "./retrieve";
import { planRepair, MAX_VALIDATION_PASSES, type RepairPlan } from "./repair";
import { scoreAll } from "./score";
import { MENU_SIZE } from "./select";
import type {
  Candidate,
  CardReason,
  GenerationOutcome,
  GenerationRequest,
  GenerationStats,
  Menu,
  Selector,
  StageTimings,
} from "./types";

export const SHORTLIST_NOMINAL = 24;
export const DETAILS_CAP = 30;
const DETAILS_CONCURRENCY = 8;

export interface EngineDeps {
  supabase: SupabaseClient;
  google: EngineGoogleClient;
  /** For the travel assembly's request-scoped transit calls. */
  googleApiKey: string;
  instrumentation: Instrumentation;
  selector: Selector;
  /**
   * The narration stage (Step 3). Absent → reasons/dayNotes stay empty
   * (the deterministic path). The engine hands it only what lower
   * layers already decided.
   */
  narrator?: (input: {
    day: Parameters<typeof validateDay>[0];
    advisories: Violation[];
    persona: GenerationRequest["persona"];
    reasonSeeds: Map<string, string>;
  }) => Promise<NarrateResult>;
  /** Shared with the LLM stages; the engine drains it into the trace. */
  llmUsage?: UsageRecorder;
  now?: () => Date;
  /**
   * Exam/test seam ONLY: overrides the fetched weather/daylight
   * environment so repair-loop behavior is demonstrable and testable on
   * demand (a synthetic rain window over a chosen hour). Production
   * callers must never set it — the trace records when it is used.
   */
  examEnvironmentOverride?: Environment;
}

/** Local wall-clock → UTC instant, via the city's IANA zone. */
export function localToUtcIso(
  date: string,
  timeHHMM: string,
  timeZone: string,
): string {
  const guess = new Date(`${date}T${timeHHMM}:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(guess);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const shown = Date.parse(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}:00Z`,
  );
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
}

export async function generateDay(
  deps: EngineDeps,
  request: GenerationRequest,
): Promise<GenerationOutcome> {
  const now = deps.now ?? (() => new Date());
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 31);
  const t0 = now().getTime();
  const timings: StageTimings = {
    retrieveMs: 0,
    linkMs: 0,
    detailsMs: 0,
    composeMs: 0,
    validateMs: 0,
    selectMs: 0,
    narrateMs: 0,
    totalMs: 0,
  };
  const traceId = await deps.instrumentation.startTrace("day_generation");
  let detailsCalls = 0;
  let searchTextCalls = 0;
  let linksMinted = 0;
  let transitCalls = 0;
  let estCostUsd = 0;

  const repairLog: { pass: number; ruleIds: string[] }[] = [];
  let unfilledFinal: GenerationStats["unfilled"] = [];
  const anthropic = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estCostUsd: 0,
    contractRetries: 0,
    toneRetries: 0,
  };
  /** Drain the LLM stages' usage into the trace + the stats. */
  const drainLlmUsage = async (): Promise<void> => {
    for (const event of deps.llmUsage?.drain() ?? []) {
      anthropic.calls++;
      anthropic.inputTokens += event.inputTokens;
      anthropic.outputTokens += event.outputTokens;
      anthropic.estCostUsd += event.estCostUsd;
      if (event.contractRetry) anthropic.contractRetries++;
      if (event.toneRetry) anthropic.toneRetries++;
      estCostUsd += event.estCostUsd;
      await deps.instrumentation.logEvent(traceId, {
        provider: "anthropic",
        endpoint: `messages(${event.stage})`,
        estCostUsd: event.estCostUsd,
        durationMs: event.durationMs,
        metadata: {
          model: "claude-sonnet-5",
          input_tokens: event.inputTokens,
          output_tokens: event.outputTokens,
          contract_retry: event.contractRetry,
          tone_retry: event.toneRetry,
          pricing_basis: "list",
        },
      });
    }
  };
  const finishStats = (
    poolCandidates: number,
    shortlisted: number,
    validationPasses: number,
  ): GenerationStats => ({
    traceId,
    seed,
    poolCandidates,
    shortlisted,
    detailsCalls,
    searchTextCalls,
    linksMinted,
    transitCalls,
    validationPasses,
    repairLog,
    unfilled: unfilledFinal,
    anthropic: { ...anthropic },
    estCostUsd,
    timings: { ...timings, totalMs: now().getTime() - t0 },
  });

  try {
    // -- skeleton + retrieval ---------------------------------------------
    const skeleton = buildSkeleton(request);
    const zones = zonesFor(
      request.persona.lens,
      (request.anchors ?? []).map((a) => a.coords),
    );
    const categories = [
      ...new Set(skeleton.intents.flatMap((i) => i.categories)),
    ];
    const tRetrieve = now().getTime();
    const pool = await retrieveCandidates(
      deps.supabase,
      request.city,
      categories,
      zones,
    );
    timings.retrieveMs = now().getTime() - tRetrieve;

    // -- pre-score + shortlist --------------------------------------------
    let scored = scoreAll(pool, request.persona, request.budgetBand, seed);
    const shortlist = pickShortlist(scored, skeleton);

    // -- link-on-demand + request-time facts (in-memory only) --------------
    const tDetails = now().getTime();
    const byId = new Map(scored.map((c) => [c.place.id, c]));
    await inBatches(shortlist, DETAILS_CONCURRENCY, async (candidate) => {
      let googlePlaceId = candidate.googlePlaceId;
      let minted = false;
      if (googlePlaceId === null) {
        googlePlaceId = await deps.google.searchPlaceId(
          linkSearchQuery(candidate),
          linkSearchBias(candidate),
        );
        searchTextCalls++;
        estCostUsd += TEXT_SEARCH_IDS_ONLY_USD_PER_CALL;
        await deps.instrumentation.logEvent(traceId, {
          provider: "google_places",
          endpoint: "places.searchText(ids-only)",
          estCostUsd: TEXT_SEARCH_IDS_ONLY_USD_PER_CALL,
          metadata: { found: googlePlaceId !== null },
        });
        if (googlePlaceId === null) return; // honest absence
        minted = true;
      }
      if (detailsCalls >= DETAILS_CAP) return; // hard spend cap (CP1)
      detailsCalls++;
      estCostUsd += PLACE_DETAILS_ENTERPRISE_USD_PER_CALL;
      const callStart = now().getTime();
      const response = await deps.google.getDetails(googlePlaceId);
      const applied = applyDetails(candidate, response, now().toISOString());
      await deps.instrumentation.logEvent(traceId, {
        provider: "google_places",
        endpoint: "places.get(engine)",
        estCostUsd: PLACE_DETAILS_ENTERPRISE_USD_PER_CALL,
        durationMs: now().getTime() - callStart,
        metadata: { minted_link: minted, pricing_basis: "list" },
      });
      if (minted) {
        // The Google name decides the link in process memory, then is gone.
        const verdict = await judgeAndPersistLink(
          deps.supabase,
          request.city,
          candidate,
          googlePlaceId,
          applied.googleName,
          applied.location,
          traceId,
          now,
        );
        if (verdict.status !== "matched_confirmed") {
          return; // facts belong to an unverified identity: discarded
        }
        linksMinted++;
        applied.candidate.googlePlaceId = googlePlaceId;
      }
      byId.set(candidate.place.id, applied.candidate);
    });
    timings.detailsMs = now().getTime() - tDetails;

    // -- hard filters + re-score ------------------------------------------
    const withFacts = [...byId.values()];
    const { kept } = hardFilter(
      withFacts,
      request.date,
      skeleton.daySpan,
      (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min,
    );
    scored = scoreAll(kept, request.persona, request.budgetBand, seed);
    const candidatesById = new Map(scored.map((c) => [c.place.id, c]));

    // -- environment (weather windows + daylight) --------------------------
    const environment =
      deps.examEnvironmentOverride ??
      (await fetchEnvironment(deps.supabase, request.city, request.date));
    if (deps.examEnvironmentOverride !== undefined) {
      await deps.instrumentation.logEvent(traceId, {
        provider: "exam",
        endpoint: "environment_override",
        metadata: { reason: "exam/test seam — synthetic weather in play" },
      });
    }
    const dusk = timeToMinutes(environment.daylight.civilDuskLocal);

    // -- selection / composition / grammar loop ----------------------------
    const mealPattern = request.mealPattern ?? defaultMealPattern(request.persona);
    let repair: RepairPlan | undefined;
    let passes = 0;
    let lastViolations: Violation[] = [];
    let feedback: string | undefined;

    // Phase A provider: stored matrix → stub. Transit joins in phase B.
    const baseTravel = await assembleTravelProvider(
      deps.supabase,
      deps.googleApiKey,
      request.city,
      [],
    );
    let travelProvider = baseTravel.provider;
    let transitFetched = false;

    while (passes < MAX_VALIDATION_PASSES) {
      passes++;
      const menus = buildMenus(skeleton, scored, request.date, dusk, repair);
      const tSelect = now().getTime();
      const selections = await deps.selector.select(
        menus,
        request.persona,
        seed,
        feedback,
      );
      timings.selectMs += now().getTime() - tSelect;
      await drainLlmUsage();

      const alternates = new Map(
        menus.map((m) => [m.intent.id, m.options.map((o) => o.place.id)]),
      );
      const tCompose = now().getTime();
      let composed = composeDay({
        request,
        skeleton,
        selections,
        candidatesById,
        travel: travelProvider,
        outdoorLatestEnd: dusk,
        slackMinutes: repair?.slackMinutes ?? 0,
        alternates,
      });

      // Phase B: fetch the day's transit legs once, request-scoped, then
      // recompose against real numbers (doc 003: never stored).
      if (!transitFetched) {
        const legs = transitLegsOf(composed.day, request);
        if (legs.length > 0) {
          const assembled = await assembleTravelProvider(
            deps.supabase,
            deps.googleApiKey,
            request.city,
            legs,
          );
          travelProvider = assembled.provider;
          for (const call of assembled.transitCalls) {
            transitCalls++;
            estCostUsd += GOOGLE_TRANSIT_EST_COST_USD;
            await deps.instrumentation.logEvent(traceId, {
              provider: "google_routes",
              endpoint: "computeRoutes(TRANSIT)",
              estCostUsd: GOOGLE_TRANSIT_EST_COST_USD,
              durationMs: call.durationMs,
              metadata: { answered: call.estimate !== null },
            });
          }
          composed = composeDay({
            request,
            skeleton,
            selections,
            candidatesById,
            travel: travelProvider,
            outdoorLatestEnd: dusk,
            slackMinutes: repair?.slackMinutes ?? 0,
            alternates,
          });
        }
        transitFetched = true;
      }
      timings.composeMs += now().getTime() - tCompose;

      // An intent can miss the day two ways: no legal option left to
      // offer (empty or exhausted menu), or a seat the scheduler could
      // not find. Both are recorded — a thinner day is never silent.
      const selected = new Set(selections.map((s) => s.intentId));
      unfilledFinal = skeleton.intents
        .filter((i) => !selected.has(i.id) || composed.unfilled.includes(i.id))
        .map((i) => ({
          intentId: i.id,
          label: i.label,
          cause: !selected.has(i.id)
            ? ("empty-menu" as const)
            : ("unschedulable" as const),
        }));

      const context = buildGrammarContext({
        environment,
        mealPattern,
        persona: request.persona,
        budgetBand: request.budgetBand,
        lodging: request.lodging ?? null,
        anchorBaseline: composed.anchorBaseline,
        travel: travelProvider,
      });
      const tValidate = now().getTime();
      const findings = validateDay(composed.day, context);
      timings.validateMs += now().getTime() - tValidate;
      const violations = violationsOnly(findings);

      if (!hasViolations(findings)) {
        const advisories = advisoriesOnly(findings);
        let reasons: CardReason[] = [];
        let dayNotes: string[] = [];
        if (deps.narrator !== undefined) {
          const tNarrate = now().getTime();
          const reasonSeeds = new Map(
            selections
              .filter((s) => s.reasonSeed !== undefined)
              .map((s) => [`s-${s.intentId}`, s.reasonSeed!]),
          );
          const narration = await deps.narrator({
            day: composed.day,
            advisories,
            persona: request.persona,
            reasonSeeds,
          });
          timings.narrateMs = now().getTime() - tNarrate;
          await drainLlmUsage();
          reasons = narration.reasons;
          dayNotes = narration.dayNotes;
        }
        const stats = finishStats(pool.length, shortlist.length, passes);
        await deps.instrumentation.endTrace(traceId, {
          totalCostUsd: estCostUsd,
          fullDayMs: stats.timings.totalMs,
          metadata: traceSummary(stats, "ok", request, findings.length),
        });
        return {
          status: "ok",
          day: composed.day,
          findings: advisories,
          narrated: describeViolations(findings),
          reasons,
          dayNotes,
          stats,
        };
      }

      lastViolations = violations;
      feedback = regenerationFeedback(violations);
      repairLog.push({ pass: passes, ruleIds: violations.map((v) => v.ruleId) });
      const capturedDay = composed.day;
      repair = planRepair(
        violations,
        (slotId) =>
          capturedDay.slots.find((s) => s.id === slotId)?.placeId ?? null,
        () => {
          let best: { slotId: string; placeId: string } | null = null;
          let bestMid = -1;
          for (const slot of capturedDay.slots) {
            if (slot.origin !== "concierge") continue;
            const price = capturedDay.places[slot.placeId]?.priceRange;
            if (price === undefined || price.status !== "present") continue;
            const mid = (price.value.min + price.value.max) / 2;
            if (mid > bestMid) {
              bestMid = mid;
              best = { slotId: slot.id, placeId: slot.placeId };
            }
          }
          return best;
        },
        repair,
      );
    }

    const stats = finishStats(pool.length, shortlist.length, passes);
    await deps.instrumentation.endTrace(traceId, {
      totalCostUsd: estCostUsd,
      fullDayMs: stats.timings.totalMs,
      metadata: traceSummary(stats, "failed", request, lastViolations.length),
    });
    return {
      status: "failed",
      violations: lastViolations,
      narrated: describeViolations(lastViolations),
      stats,
    };
  } catch (err) {
    await deps.instrumentation
      .endTrace(traceId, {
        totalCostUsd: estCostUsd,
        metadata: {
          outcome: "aborted",
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Deterministic shortlist: menu-depth-plus-spare per intent, capped,
 * deduped. The spare exists because link verification fails honestly for
 * long-tail names — fetching a little past menu depth keeps menus from
 * emptying when it does.
 */
const SHORTLIST_DEPTH = MENU_SIZE + 2;
function pickShortlist(
  scored: Candidate[],
  skeleton: Skeleton,
): Candidate[] {
  const picked = new Map<string, Candidate>();
  for (const intent of skeleton.intents) {
    let taken = 0;
    for (const candidate of scored) {
      if (taken >= SHORTLIST_DEPTH) break;
      if (!intent.categories.includes(candidate.category)) continue;
      if (picked.has(candidate.place.id)) {
        taken++; // already shortlisted for an earlier intent still counts
        continue;
      }
      if (picked.size >= SHORTLIST_NOMINAL) break;
      picked.set(candidate.place.id, candidate);
      taken++;
    }
  }
  return [...picked.values()];
}

function buildMenus(
  skeleton: Skeleton,
  scored: Candidate[],
  date: string,
  dusk: number,
  repair: RepairPlan | undefined,
): Menu[] {
  return skeleton.intents.map((intent) => {
    const struck = repair?.strikes.get(`s-${intent.id}`) ?? new Set<string>();
    const window = intent.categories.some((c) => c === "parks")
      ? { start: intent.window.start, end: Math.min(intent.window.end, dusk) }
      : intent.window;
    const { kept } = hardFilter(
      scored.filter(
        (c) =>
          intent.categories.includes(c.category) && !struck.has(c.place.id),
      ),
      date,
      window,
      (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min,
    );
    // An intent's category list is a preference order (breakfast wants
    // cafes before restaurants) — the menu honors it before score, so a
    // verified bar can no longer outrank every cafe for the morning slot.
    const preferenceRanked = [...kept].sort(
      (a, b) =>
        intent.categories.indexOf(a.category) -
          intent.categories.indexOf(b.category) || b.score - a.score,
    );
    return { intent, options: preferenceRanked.slice(0, MENU_SIZE) };
  });
}

/** Consecutive transit legs of a composed day, as absolute instants. */
function transitLegsOf(
  day: { slots: { placeId: string; startTime: string; arriveBy: string }[]; places: Record<string, { coords: { lat: number; lng: number } | null }>; date: string },
  request: GenerationRequest,
): TransitLeg[] {
  if (!request.transport.includes("transit")) return [];
  const legs: TransitLeg[] = [];
  const ordered = [...day.slots].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  for (let i = 1; i < ordered.length; i++) {
    const from = day.places[ordered[i - 1].placeId]?.coords ?? null;
    const to = day.places[ordered[i].placeId]?.coords ?? null;
    if (from === null || to === null) continue;
    const km = haversineKm(from, to);
    if (modeFor(km, request.transport) !== "transit") continue;
    legs.push({
      label: `${ordered[i - 1].placeId}->${ordered[i].placeId}`,
      origin: from,
      dest: to,
      departureTimeIso: localToUtcIso(
        request.date,
        ordered[i - 1].startTime,
        CITY_GEO[request.city].timezone,
      ),
    });
  }
  return legs;
}

function traceSummary(
  stats: GenerationStats,
  outcome: "ok" | "failed",
  request: GenerationRequest,
  findingCount: number,
): Record<string, unknown> {
  return {
    outcome,
    seed: stats.seed,
    city: request.city,
    date: request.date,
    persona_structure: request.persona.structure,
    pool_candidates: stats.poolCandidates,
    shortlisted: stats.shortlisted,
    details_calls: stats.detailsCalls, // the 87% canary, first-class
    search_text_calls: stats.searchTextCalls,
    links_minted: stats.linksMinted,
    transit_calls: stats.transitCalls,
    validation_passes: stats.validationPasses,
    repair_log: stats.repairLog,
    findings: findingCount,
    est_cost_usd: stats.estCostUsd,
    stage_ms: stats.timings,
    pricing_basis: "list",
  };
}

async function inBatches<T>(
  items: T[],
  batchSize: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(work));
  }
}
