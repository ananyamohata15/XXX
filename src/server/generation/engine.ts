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
import type { Span } from "@/shared/day-grammar/predicates";
import type { Violation } from "@/shared/day-grammar/types";
import {
  ANCHOR_MIN_RATING_COUNT,
  partitionByCalibre,
} from "@/shared/anchor-calibre";
import { diceIndex, diceStream, personaIdentity } from "@/shared/dice";
import { timeToMinutes } from "@/shared/time";
import {
  CITY_GEO,
  isOutdoorCategory,
  type PlaceCategory,
} from "@/shared/vocabulary";
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
  type ComposedLeg,
  type ComposeInput,
  type Skeleton,
} from "./compose";
import { applyFounderGroundtruth } from "./groundtruth";
import { environmentIsFair, selectTheme } from "./theme-select";
import { readFerryTimetable } from "../city-facts/repo";
import { EXPERIENCE_SPECS, themeId, themeZoneSlugs } from "@/shared/theme";
import { holdsAThread, holdsAnExperience, templatesHolding } from "./arc";
import { POOL_WINDOWS, retrieveCandidates, zonesFor } from "./retrieve";
import { planRepair, MAX_VALIDATION_PASSES, type RepairPlan } from "./repair";

import type { CuisineTag } from "@/shared/cuisine";
import { collapseByPlace, scoreAll } from "./score";
import { MENU_SIZE, MENU_SIZE_DISCRETIONARY } from "./select";
import type {
  Candidate,
  CardReason,
  GenerationOutcome,
  GenerationRequest,
  GenerationStats,
  Menu,
  Selector,
  SlotIntent,
  StageTimings,
} from "./types";

/**
 * How many times a day may re-elect its centrepiece before the generation
 * fails. Two covers every case the Session-11 matrix produced; the point
 * of a bound is that an unseatable pool must not loop.
 */
const MAX_ANCHOR_REELECTIONS = 2;

/** How many stable orderings a category's pool page may be taken in. */
const POOL_WINDOW_COUNT = POOL_WINDOWS.length;

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
  /** Seam for `resolveSeed`; production leaves it and gets `Math.random`. */
  random?: () => number;
  /**
   * Exam/test seam ONLY: overrides the fetched weather/daylight
   * environment so repair-loop behavior is demonstrable and testable on
   * demand (a synthetic rain window over a chosen hour). Production
   * callers must never set it — the trace records when it is used.
   */
  examEnvironmentOverride?: Environment;
  /**
   * Exam seam ONLY (XXX-35): receives the exact inputs `composeDay` was
   * called with, once per validation pass.
   *
   * It exists so the seated-time A/B costs nothing. `composeDay` is pure
   * given these, so the exam can recompose the SAME day with
   * `seatingLegacyEarliest` and compare — a true before/after on identical
   * candidates, selections and travel, with no second generation and no
   * second Details call. Production never sets it.
   */
  onComposeInputs?: (input: ComposeInput) => void;
  /**
   * Written into the trace AT START and carried into the end summary, so
   * a caller's own tags survive a crash. The tasting room tags its
   * surface here: the per-day self-cap counts traces by that tag, and a
   * tag written only at endTrace would miss the runs that spent money and
   * then died.
   */
  traceMetadata?: Record<string, unknown>;
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

/**
 * THE seed — minted here when the caller sends none, and the only place a
 * day's seed comes into existence.
 *
 * `request.seed` is the CALLER'S REQUEST for a seed. The return value is the
 * day's RESOLVED seed. Session 12 proved how expensive it is to let one name
 * mean both: the engine minted a seed, used it for scoring and retrieval and
 * recorded it in the trace, while `buildSkeleton` re-read `request.seed` —
 * still null, because the tasting room sends `seed: null` on every
 * generation — and diced the entire arc at **0**. Every room day ever
 * generated was composed at seed 0, six selection points never varied, and
 * each trace recorded a seed beside an arc that seed did not build.
 *
 * So the rule this function exists to make checkable:
 *
 *   **Reproducibility law — the seed recorded IS the seed that built the
 *   day.** Nothing downstream of this line reads `request.seed` again.
 *
 * `random` is injected so the property is testable without the engine's I/O.
 */
export function resolveSeed(
  request: GenerationRequest,
  random: () => number = Math.random,
): number {
  return request.seed ?? Math.floor(random() * 2 ** 31);
}

export async function generateDay(
  deps: EngineDeps,
  request: GenerationRequest,
): Promise<GenerationOutcome> {
  const now = deps.now ?? (() => new Date());
  const seed = resolveSeed(request, deps.random);
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
  const traceId = await deps.instrumentation.startTrace(
    "day_generation",
    deps.traceMetadata,
  );
  let detailsCalls = 0;
  let searchTextCalls = 0;
  let linksMinted = 0;
  let transitCalls = 0;
  let estCostUsd = 0;
  let founderOverrides = 0;
  let founderExpired = 0;
  let legs: ComposedLeg[] = [];

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
    founderOverrides,
    founderExpired,
    anthropic: { ...anthropic },
    estCostUsd,
    timings: { ...timings, totalMs: now().getTime() - t0 },
  });

  try {
    /**
     * ENVIRONMENT FIRST (XXX-40, Session 14).
     *
     * It used to be fetched just before composition. Theme selection needs
     * weather — the founder's *"if the weather is good"* is a SELECTION input,
     * not a post-hoc filter — and the theme is an input to `buildSkeleton`,
     * which is the first thing the engine does. So the read moves up.
     *
     * Cost-neutral: it is a `weather_days` row and a computed ephemeris. No
     * Google endpoint, no Anthropic call.
     */
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

    /**
     * Which scheduled routes run today. Read ONCE, before selection, because
     * a route that does not run makes its whole theme infeasible — and the
     * traveller must be told that rather than handed a day without the boat.
     */
    const runningRoutes = new Set<string>();
    for (const spec of EXPERIENCE_SPECS) {
      if (spec.legs === undefined) continue;
      const timetable = await readFerryTimetable(
        deps.supabase,
        request.city,
        spec.legs.routeKey,
        request.date,
      );
      if (timetable !== null) runningRoutes.add(spec.legs.routeKey);
    }

    // -- theme selection ---------------------------------------------------
    const themeOutcome = selectTheme({
      persona: request.persona,
      requested: request.theme ?? null,
      feasibility: {
        persona: request.persona,
        routeRuns: (routeKey) => runningRoutes.has(routeKey),
        goodWeather: environmentIsFair(environment),
        canHold: (theme) =>
          theme.mode === "venue" ||
          templatesHolding(
            request.persona,
            theme.mode === "thread" ? holdsAThread : holdsAnExperience,
          ).length > 0,
      },
      dice: diceStream({
        seed,
        identity: personaIdentity(request.persona),
        site: "theme",
        context: request.date,
      }),
    });
    if (themeOutcome.status === "refused") {
      // A requested theme that cannot be built is not a failed day — the day
      // was never possible. Said plainly rather than downgraded in silence.
      await deps.instrumentation.logEvent(traceId, {
        provider: "theme",
        endpoint: "requested_infeasible",
        estCostUsd: 0,
        metadata: {
          theme: themeId(themeOutcome.theme),
          reason: themeOutcome.infeasibility.reason,
          detail: themeOutcome.infeasibility.detail,
        },
      });
      const stats = finishStats(0, 0, 0);
      await deps.instrumentation.endTrace(traceId, {
        totalCostUsd: estCostUsd,
        fullDayMs: stats.timings.totalMs,
        metadata: {
          ...deps.traceMetadata,
          outcome: "theme_infeasible",
          theme: themeId(themeOutcome.theme),
          theme_refusal: themeOutcome.infeasibility.reason,
        },
      });
      return {
        status: "theme-infeasible",
        theme: themeOutcome.theme,
        infeasibility: themeOutcome.infeasibility,
        stats,
      };
    }
    const theme = themeOutcome.selection.theme;
    /** A thread or an experience owns the day's centre; election is skipped. */
    const themeOwnsAnchor = theme.mode !== "venue";

    // -- skeleton + retrieval ---------------------------------------------
    let skeleton = buildSkeleton(request, { seed, theme });
    /**
     * Anchor categories this day has proven it cannot seat. An unseatable
     * centrepiece is a reason to elect a different one — never a reason to
     * ship the un-anchored day the founder rejected in those exact words
     * (XXX-35 CP2 ruling 1).
     */
    const failedAnchorCategories: PlaceCategory[] = [];

    /**
     * Re-elect around an anchor that can only be seated BELOW calibre —
     * CP2 ruling 1's path extended from *unseatable* to *seated but
     * degenerate* (XXX-35, Session 13 Step 2).
     *
     * Here rather than in the validation loop on purpose: the degradation is
     * a property of the day's SHAPE, known before a single candidate is
     * retrieved, so re-electing costs nothing. Waiting until after Details
     * would spend real money to discover something the skeleton already knew.
     *
     * If nothing better exists, the FIRST election stands. Re-electing away
     * from the persona's first interest to another equally-cramped category
     * gains the traveller nothing and breaks the product's promise; the day
     * keeps its centre and says out loud that the centre is small.
     */
    /**
     * Set when the anchor's menu held nothing fit to be a centrepiece.
     * Reported, never silently accepted (XXX-35, Session 13 Step 2).
     */
    let anchorCalibreUnmet: { category: PlaceCategory; examined: number } | null =
      null;
    const firstSkeleton = skeleton;
    while (
      skeleton.anchorDegraded !== null &&
      failedAnchorCategories.length < MAX_ANCHOR_REELECTIONS
    ) {
      const degraded = skeleton.anchorDegraded;
      failedAnchorCategories.push(degraded.category);
      const reelected = buildSkeleton(request, {
        seed,
        theme,
        excludeAnchorCategories: failedAnchorCategories,
      });
      await deps.instrumentation.logEvent(traceId, {
        provider: "arc",
        endpoint: "anchor_reelected",
        estCostUsd: 0,
        metadata: {
          cause: "below_calibre",
          failed_category: degraded.category,
          fitted_minutes: degraded.fittedMinutes,
          floor_minutes: degraded.floorMinutes,
          next_category: reelected.electedAnchor?.category ?? null,
          attempt: failedAnchorCategories.length,
        },
      });
      if (reelected.electedAnchor === null) break;
      skeleton = reelected;
    }
    if (skeleton.anchorDegraded !== null) {
      // Every category tried is still cramped. Keep the persona's own first
      // interest rather than an arbitrary equally-small substitute.
      skeleton = firstSkeleton;
      failedAnchorCategories.length = 0;
      await deps.instrumentation.logEvent(traceId, {
        provider: "arc",
        endpoint: "anchor_degraded_seated",
        estCostUsd: 0,
        metadata: {
          category: skeleton.anchorDegraded?.category ?? null,
          fitted_minutes: skeleton.anchorDegraded?.fittedMinutes ?? null,
          floor_minutes: skeleton.anchorDegraded?.floorMinutes ?? null,
        },
      });
    }
    // Retrieval's two dice (XXX-35, Session 12): which zones inside the
    // lens's bucket this day emphasises, and which of the eight stable
    // orderings each category's 400-row page is taken in. Both are pure
    // functions of (seed, persona, …), so a trace replays exactly; neither
    // changes the query count.
    const identity = personaIdentity(request.persona);
    const zones = zonesFor(
      request.persona.lens,
      (request.anchors ?? []).map((a) => a.coords),
      diceStream({ seed, identity, site: "zone", context: request.date }),
      // A theme has a geography, and the lens is not it (CP0 ruling 2).
      themeZoneSlugs(theme),
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
      (category) =>
        diceIndex(
          { seed, identity, site: "pool-window", context: category },
          POOL_WINDOW_COUNT,
        ),
    );
    timings.retrieveMs = now().getTime() - tRetrieve;

    // -- pre-score + shortlist --------------------------------------------
    let scored = scoreAll(pool, request.persona, request.budgetBand, seed);
    const shortlist = pickShortlist(scored, skeleton);

    // -- link-on-demand + request-time facts (in-memory only) --------------
    const tDetails = now().getTime();
    // One Candidate per place, its best-fitting category winning. See
    // `collapseByPlace` — this line was `new Map(scored.map(...))`, which
    // over a score-descending list handed every multi-category place to its
    // WORST-fitting category (XXX-35, Session 12 CP2 ruling 3).
    const byId = new Map(
      collapseByPlace(scored).map((c) => [c.place.id, c] as const),
    );
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

    // -- founder ground-truth override (stage 3b) --------------------------
    // Boots-on-the-ground beats the listing: between two tier-1 facts the
    // tie is broken by channel, not by timestamp. In memory, for this
    // request only — nothing Google-derived is written anywhere.
    const groundtruth = await applyFounderGroundtruth(
      deps.supabase,
      [...byId.values()],
      request.date,
      now().toISOString(),
    );
    founderOverrides = groundtruth.applied.length;
    founderExpired = groundtruth.skipped.filter(
      (s) => s.reason === "expired",
    ).length;
    for (const entry of groundtruth.applied) {
      await deps.instrumentation.logEvent(traceId, {
        provider: "founder_groundtruth",
        endpoint: "override_applied",
        estCostUsd: 0,
        metadata: { place_id: entry.placeId, fact_key: entry.factKey },
      });
    }
    // Expiry is never silent: a correction that aged out is re-verification
    // work, not a quiet reversion to the answer the founder rejected.
    for (const entry of groundtruth.skipped) {
      await deps.instrumentation.logEvent(traceId, {
        provider: "founder_groundtruth",
        endpoint:
          entry.reason === "expired"
            ? "override_expired"
            : "override_not_applicable",
        estCostUsd: 0,
        metadata: {
          place_id: entry.placeId,
          fact_key: entry.factKey,
          reason: entry.reason,
          age_days: entry.ageDays,
        },
      });
    }

    // -- hard filters + re-score ------------------------------------------
    const withFacts = groundtruth.candidates;
    const { kept } = hardFilter(
      withFacts,
      request.date,
      skeleton.daySpan,
      (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min,
    );
    scored = scoreAll(kept, request.persona, request.budgetBand, seed);
    const candidatesById = new Map(scored.map((c) => [c.place.id, c]));

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
      const menus = buildMenus(
        skeleton,
        scored,
        request.date,
        dusk,
        repair,
        request.lovedCuisines ?? [],
      );

      /**
       * Did the anchor's menu contain anything fit to BE an anchor?
       *
       * `buildMenus` leaves the menu whole when nothing clears the bar —
       * an anchorless day is worse than a small-centred one. That choice is
       * only honest if the shortfall is then said out loud, which is here.
       */
      const anchorMenu = menus.find((m) => m.intent.role === "anchor");
      if (anchorMenu !== undefined && anchorMenu.options.length > 0) {
        const { worthy } = partitionByCalibre(anchorMenu.options, (c) => ({
          name: c.place.name,
          category: c.category,
          userRatingCount: c.userRatingCount,
        }));
        anchorCalibreUnmet =
          worthy.length === 0
            ? {
                category: anchorMenu.intent.categories[0],
                examined: anchorMenu.options.length,
              }
            : null;
        if (anchorCalibreUnmet !== null) {
          await deps.instrumentation.logEvent(traceId, {
            provider: "arc",
            endpoint: "anchor_calibre_unmet",
            estCostUsd: 0,
            metadata: {
              category: anchorCalibreUnmet.category,
              examined: anchorCalibreUnmet.examined,
              bar: ANCHOR_MIN_RATING_COUNT,
            },
          });
        }
      }

      const tSelect = now().getTime();
      const selections = await deps.selector.select(
        menus,
        request.persona,
        seed,
        feedback,
        request.lovedCuisines ?? [],
      );
      timings.selectMs += now().getTime() - tSelect;
      await drainLlmUsage();

      const alternates = new Map(
        menus.map((m) => [m.intent.id, m.options.map((o) => o.place.id)]),
      );
      const tCompose = now().getTime();
      const composeInput: ComposeInput = {
        request,
        skeleton,
        selections,
        candidatesById,
        travel: travelProvider,
        outdoorLatestEnd: dusk,
        slackMinutes: repair?.slackMinutes ?? 0,
        exposure: environment.windows?.hourlyExposure ?? null,
        alternates,
      };
      deps.onComposeInputs?.(composeInput);
      let composed = composeDay(composeInput);

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
          // Same inputs, real transit numbers now in the provider.
          const withTransit: ComposeInput = {
            ...composeInput,
            travel: travelProvider,
          };
          deps.onComposeInputs?.(withTransit);
          composed = composeDay(withTransit);
        }
        transitFetched = true;
      }
      legs = composed.legs;
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

      // The centrepiece is not optional. Before Session 11's exam this
      // path shipped silently: the matrix lost its anchor in 3 of 6 days
      // and every one of them still returned status "ok", so the trace
      // claimed an elected anchor the day did not contain. Re-elect
      // around the category that could not be seated and compose again.
      //
      // Re-election deliberately does NOT spend a validation pass —
      // MAX_VALIDATION_PASSES is 3 and repair needs it. It has its own
      // budget, so the loop still terminates at
      // MAX_VALIDATION_PASSES + MAX_ANCHOR_REELECTIONS iterations.
      const anchorIntent = skeleton.intents.find((i) => i.role === "anchor");
      const anchorUnfilled =
        anchorIntent !== undefined &&
        unfilledFinal.some((u) => u.intentId === anchorIntent.id);
      if (
        anchorUnfilled &&
        skeleton.electedAnchor !== null &&
        failedAnchorCategories.length < MAX_ANCHOR_REELECTIONS
      ) {
        const failedCategory = skeleton.electedAnchor.category;
        failedAnchorCategories.push(failedCategory);
        const reelected = buildSkeleton(request, {
          seed,
          theme,
          excludeAnchorCategories: failedAnchorCategories,
        });
        await deps.instrumentation.logEvent(traceId, {
          provider: "arc",
          endpoint: "anchor_reelected",
          estCostUsd: 0,
          metadata: {
            failed_category: failedCategory,
            next_category: reelected.electedAnchor?.category ?? null,
            attempt: failedAnchorCategories.length,
          },
        });
        if (reelected.electedAnchor !== null) {
          skeleton = reelected;
          repair = undefined;
          feedback = undefined;
          passes--; // re-election is not a validation attempt
          continue;
        }
      }
      // Out of categories or out of re-elections and the day still has no
      // centre: that is a failure, and it says so rather than shipping.
      /**
       * THE CENTRE IS NOT OPTIONAL — including when a THEME owns it
       * (XXX-40, Session 14 Step 3, found live).
       *
       * Both guards here tested `skeleton.electedAnchor !== null`, which is
       * the record of an ELECTION. A themed day has none: the thread or the
       * experience pre-empts election, so `electedAnchor` is null by design.
       * The result was that the first live islands day lost its composite
       * block to `unschedulable` and shipped anyway, reporting *"This day
       * holds up — 8 notes."*
       *
       * That is Session 11's exact defect returning through a door this
       * session opened: *"the matrix lost its anchor in 3 of 6 days and every
       * one of them still returned status ok"*. The founder's words for it
       * are on the record twice — **"the day isnt anchored on anything"**.
       *
       * So the question is asked about the DAY, not about the election: did
       * the anchor intent get seated? Re-election still needs an elected
       * anchor to re-elect (a theme's centre is not ours to swap), so a
       * themed day with no seatable centre fails HONESTLY and immediately.
       */
      if (anchorUnfilled && skeleton.electedAnchor === null && themeOwnsAnchor) {
        await deps.instrumentation.logEvent(traceId, {
          provider: "arc",
          endpoint: "theme_anchor_unseatable",
          estCostUsd: 0,
          metadata: {
            theme: themeId(theme),
            anchor_categories: anchorIntent?.categories ?? [],
          },
        });
        const stats = finishStats(pool.length, shortlist.length, passes);
        await deps.instrumentation.endTrace(traceId, {
          totalCostUsd: estCostUsd,
          fullDayMs: stats.timings.totalMs,
          metadata: {
            ...deps.traceMetadata,
            ...traceSummary(stats, "failed", request, lastViolations.length),
            theme: themeId(theme),
            theme_anchor_unseatable: true,
          },
        });
        const violation: Violation = {
          ruleId: "dwell.understay",
          severity: "violation",
          slotIds: [],
          message: `This day's centre — ${anchorIntent?.label ?? "the theme's anchor"} — could not be seated, so the day has nothing at its middle.`,
          data: { theme: themeId(theme) },
        };
        return {
          status: "failed",
          violations: [violation],
          narrated: describeViolations([violation]),
          stats,
        };
      }
      if (anchorUnfilled && skeleton.electedAnchor !== null) {
        await deps.instrumentation.logEvent(traceId, {
          provider: "arc",
          endpoint: "anchor_unseatable_exhausted",
          estCostUsd: 0,
          metadata: {
            tried: [...failedAnchorCategories, skeleton.electedAnchor.category],
          },
        });
        const stats = finishStats(pool.length, shortlist.length, passes);
        await deps.instrumentation.endTrace(traceId, {
          totalCostUsd: estCostUsd,
          fullDayMs: stats.timings.totalMs,
          metadata: {
            ...deps.traceMetadata,
            ...traceSummary(stats, "failed", request, lastViolations.length),
            anchor_unseatable: true,
            anchor_tried: [
              ...failedAnchorCategories,
              skeleton.electedAnchor.category,
            ],
          },
        });
        return {
          status: "failed",
          violations: lastViolations,
          narrated: describeViolations(lastViolations),
          stats,
        };
      }

      const context = buildGrammarContext({
        environment,
        mealPattern,
        persona: request.persona,
        budgetBand: request.budgetBand,
        lodging: request.lodging ?? null,
        anchorBaseline: composed.anchorBaseline,
        travel: travelProvider,
        transport: request.transport,
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
          metadata: {
            ...deps.traceMetadata,
            ...traceSummary(stats, "ok", request, findings.length),
            // The arc is auditable after the fact: a later session can ask
            // which shape produced a day the founder rejected.
            arc_template_id: skeleton.templateId,
            theme: themeId(theme),
            theme_origin: themeOutcome.selection.origin,
            elected_anchor: skeleton.electedAnchor,
            anchor_degraded: skeleton.anchorDegraded,
            anchor_calibre_unmet: anchorCalibreUnmet,
            open_periods: composed.openPeriods.length,
            exposure_swaps: legs.filter((l) => l.exposureSwap !== null).length,
          },
        });
        return {
          status: "ok",
          day: composed.day,
          travel: legs,
          openPeriods: composed.openPeriods,
          electedAnchor: skeleton.electedAnchor,
          anchorDegraded: skeleton.anchorDegraded,
          anchorCalibreUnmet,
          arcTemplateId: skeleton.templateId,
          theme: themeOutcome.selection,
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
      metadata: {
        ...deps.traceMetadata,
        ...traceSummary(stats, "failed", request, lastViolations.length),
      },
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
          ...deps.traceMetadata,
          outcome: "aborted",
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => undefined);
    throw err;
  }
}

/**
 * How deep this intent's menu goes. Meals are structural and stay at four;
 * the discretionary steps are where choice lives (XXX-40, CP1 ruling 1).
 */
/**
 * How many venues of a LICENSED category lead its menu. Two: enough for the
 * founder's two-shopping-stop shape when the first is already the anchor,
 * few enough that a licence stays a bookend rather than a takeover.
 */
export const LICENSED_MENU_DEPTH = 2;

/**
 * How many venues of a NAMED CUISINE lead its menu (XXX-43).
 *
 * Two, and borrowed deliberately from `LICENSED_MENU_DEPTH` rather than
 * chosen fresh — the two constants answer the same question ("how much menu
 * does a stated preference get to reserve before it stops being a preference
 * and becomes a takeover?") and Session 14 already argued it through. One is
 * too few: the single best Thai place may already be seated elsewhere in the
 * day, which is exactly the failure the licensed-close ruling was written
 * for. More than two starts crowding out the textures the rest of the menu
 * exists to offer.
 */
export const CUISINE_MENU_DEPTH = 2;

export function menuSizeFor(intent: SlotIntent): number {
  return intent.kind === "meal" ? MENU_SIZE : MENU_SIZE_DISCRETIONARY;
}

/**
 * THE DIE'S LAST MILE (XXX-40, Session 14 CP1 ruling 1).
 *
 * `intent.categories` is a DICED ORDER, not a ranking — Session 12 built the
 * whole dice layer so that a step's second and third choices are real. This
 * function is where that order either survives into the menu or dies.
 *
 * It used to die. `buildMenus` sorted by `categories.indexOf(category)` and
 * then took `slice(0, MENU_SIZE)`, so whenever the head category had four or
 * more survivors — nearly always — **the menu was single-category and the
 * rest of the diced order was unreachable.** Measured at CP0 on
 * `persona-shopper`'s close: 65 viewpoints, 338 bars, 106 historic sites and
 * 391 restaurants survived every filter, and the menu offered four viewpoints
 * and nothing else. A die rolled upstream of a cap is still a funnel —
 * Session 12's own lesson, one layer lower.
 *
 * Round-robin over the diced order: the best unused survivor of the first
 * category, then of the second, and so on, cycling until the menu is full or
 * every category is spent.
 *
 *   - the HEAD still leads the menu, so `DeterministicSelector`'s `options[0]`
 *     still honours the die's first choice;
 *   - positions 2..n are genuinely different categories, which is what the
 *     alternates fallback in `composeDay` and the LLM selector need;
 *   - a category with nothing left is skipped rather than reserving a slot,
 *     so a thin category cannot shrink the menu.
 */
export function allocateMenu(
  kept: Candidate[],
  categories: readonly PlaceCategory[],
  size: number,
  /**
   * A category that takes the first `LICENSED_MENU_DEPTH` slots before the
   * round-robin begins (XXX-40, Session 14 — the licensed-close ruling).
   *
   * Only the family licence sets this. Promoting the licensed CATEGORY to the
   * head of the list was measurably not enough: the head venue turned out to
   * be the one already seated as the day's anchor, and the second venue of
   * the same category sat six deep behind three other categories, so the
   * shopper's day still closed on a bar.
   *
   * EXACTLY two, and the licensed category is then EXCLUDED from the
   * round-robin remainder (Session 14 ruling). The licence grants a reserved
   * PAIR, not a rotation share: left in the rotation it took three of six
   * slots and pushed the tail category off the menu entirely, which is a
   * takeover wearing a bookend's clothes. Two is what the founder's shape
   * needs — one venue by day, a different one in the evening — and the rest
   * of the menu stays genuinely different textures.
   *
   * Deduplication against already-seated venues needs no extra machinery:
   * `DeterministicSelector` skips venues it has already used and `composeDay`
   * skips venues already placed, so a second licensed venue on the menu is
   * exactly what those two need in order to reach one.
   */
  priorityCategory?: PlaceCategory,
  /**
   * Cuisines the traveller named (XXX-43). Reserves up to
   * `CUISINE_MENU_DEPTH` places at the head of the menu for venues serving
   * one of them.
   *
   * THIS IS THE MENU'S JOB, NOT THE SCORE'S, and that division was settled by
   * measurement rather than argument. A flat bonus inside `scoreCandidate`
   * was tried first and abandoned: swept over 20,000 seeds, ANY additive
   * value large enough to survive the exploration jitter also inverted the
   * icons-vs-corners axis a large fraction of the time (0.03 → 6%, 0.10 →
   * 70%), because the corners margin's floor approaches zero. There is no
   * safe constant; the mechanism was wrong.
   *
   * So the labour divides the way this codebase already divides it — *"the
   * palette offers, affinity weights, the die orders"*. Code GUARANTEES a
   * loved cuisine is on the menu; the taste layer decides whether it wins.
   * Scoring is untouched, so a traveller who named no cuisine scores exactly
   * as they did before this existed.
   *
   * Bounded for the same reason the family licence is bounded: a reserved
   * pair is a guarantee of representation, not a takeover. The rest of the
   * menu stays lens-ordered, so the resident's non-Thai pick is still there
   * to be chosen.
   */
  lovedCuisines: readonly CuisineTag[] = [],
): Candidate[] {
  const byCategory = new Map<PlaceCategory, Candidate[]>();
  for (const candidate of kept) {
    const list = byCategory.get(candidate.category);
    if (list === undefined) byCategory.set(candidate.category, [candidate]);
    else list.push(candidate);
  }
  // Within a category the score decides — that part was never the problem.
  for (const list of byCategory.values()) list.sort((a, b) => b.score - a.score);

  const cursor = new Map<PlaceCategory, number>();
  const out: Candidate[] = [];
  /** Reserved cuisine picks, so the round-robin cannot offer them twice. */
  const spent = new Set<string>();

  if (lovedCuisines.length > 0) {
    const loved = kept
      .filter((c) => c.cuisines.some((x) => lovedCuisines.includes(x)))
      .sort((a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id));
    const take = Math.min(CUISINE_MENU_DEPTH, loved.length, size);
    for (let i = 0; i < take; i += 1) {
      out.push(loved[i]!);
      spent.add(loved[i]!.place.id);
    }
    // Drop the reserved picks from their categories' rotation lists.
    for (const [category, list] of byCategory) {
      byCategory.set(
        category,
        list.filter((c) => !spent.has(c.place.id)),
      );
    }
  }

  if (priorityCategory !== undefined) {
    const list = byCategory.get(priorityCategory) ?? [];
    const take = Math.min(LICENSED_MENU_DEPTH, list.length, size);
    for (let i = 0; i < take; i += 1) out.push(list[i]);
    // Spent. The reserved pair is the whole grant.
    byCategory.delete(priorityCategory);
  }

  let progressed = true;
  while (out.length < size && progressed) {
    progressed = false;
    for (const category of categories) {
      if (out.length >= size) break;
      const list = byCategory.get(category);
      if (list === undefined) continue;
      const at = cursor.get(category) ?? 0;
      if (at >= list.length) continue;
      cursor.set(category, at + 1);
      out.push(list[at]);
      progressed = true;
    }
  }
  return out;
}

/**
 * Deterministic shortlist: menu-depth-plus-spare per intent, capped,
 * deduped. The spare exists because link verification fails honestly for
 * long-tail names — fetching a little past menu depth keeps menus from
 * emptying when it does.
 *
 * **It MIRRORS `allocateMenu`** (XXX-40, Session 14) — the harness-fidelity
 * doctrine applied to spend. This used to walk the score-ordered pool and
 * take the top `SHORTLIST_DEPTH` across the intent's categories, which was a
 * different rule from the menu's head-category slice: Details were bought for
 * high-scoring candidates the menu then declined to offer. Whatever decides
 * what the menu SHOWS must decide what the engine PAYS to learn about.
 *
 * `SHORTLIST_NOMINAL` still caps the whole thing, so the spend bound is
 * unchanged by the wider discretionary menus.
 */
const SHORTLIST_SPARE = 2;
export function pickShortlist(
  scored: Candidate[],
  skeleton: Skeleton,
): Candidate[] {
  const picked = new Map<string, Candidate>();
  for (const intent of skeleton.intents) {
    if (picked.size >= SHORTLIST_NOMINAL) break;
    const eligible = scored.filter((c) => intent.categories.includes(c.category));
    const allocated = allocateMenu(
      eligible,
      intent.categories,
      menuSizeFor(intent) + SHORTLIST_SPARE,
    );
    for (const candidate of allocated) {
      if (picked.size >= SHORTLIST_NOMINAL) break;
      picked.set(candidate.place.id, candidate);
    }
  }
  return [...picked.values()];
}

export function buildMenus(
  skeleton: Skeleton,
  scored: Candidate[],
  date: string,
  dusk: number,
  repair: RepairPlan | undefined,
  /**
   * Cuisines the traveller named (XXX-43). Defaulted so the offline
   * diagnostics that call `buildMenus` directly keep meaning what they meant;
   * the engine and the fidelity harness both pass the request's own value.
   */
  lovedCuisines: readonly CuisineTag[] = [],
): Menu[] {
  return skeleton.intents.map((intent) => {
    const struck = repair?.strikes.get(`s-${intent.id}`) ?? new Set<string>();
    /**
     * Outdoor stops are clamped to dusk — keyed on the texture FAMILY, not
     * on the literal `"parks"` it used to test (XXX-37, Session 13).
     *
     * `scenic_viewpoints` is an outdoor category and was not clamped, so a
     * viewpoint could be seated after dark: an outdoor stop with nothing to
     * see, which is the exact failure the daylight rules exist to prevent.
     * The literal was correct when `parks` was the only outdoor category and
     * became wrong the moment it was not — so it now asks the question it
     * means ("is this outdoor?") instead of naming the one member it had.
     *
     * Session 14 (XXX-40) fixed the other half twice over.
     *
     * FIRST: routed through `isOutdoorCategory` rather than repeating the
     * family test inline. The fifth load-bearing constant was the other half
     * of this same question — `retrieveCandidates` was still deciding
     * `PlaceTags.outdoor` from `category === "parks"`, and that tag is what
     * `composeDay`'s own dusk clamp and every daylight/weather rule read. So
     * for a whole session the clamp here and the tag there disagreed about
     * `scenic_viewpoints`.
     *
     * SECOND, and larger: **the clamp is PER CANDIDATE, not per intent.**
     * `intent.categories.some(isOutdoorCategory)` narrowed the WHOLE window
     * whenever any one category was outdoor — and `closeCategories` always
     * offers `parks`, so every close intent in the product was dusk-clamped
     * for all four of its categories.
     *
     * What that cost, measured on `persona-shopper` at seed 42: a close
     * window of 20:15–22:00 became 20:15–20:30, and fifteen minutes is a span
     * only `scenic_viewpoints` (min dwell 15) can hold. Bars, historic sites
     * and restaurants were struck from the menu by an outdoor rule that does
     * not apply to them, so the menu returned four viewpoints and nothing
     * else. A 21:00 bar close was legal and unreachable.
     *
     * A constraint that belongs to each MEMBER, applied to the SET — the same
     * shape as the dead `Retail > Farmers Market` rule, and CLAUDE.md's own
     * standing line about asserting per rule rather than over a set.
     */
    const windowFor = (candidate: Candidate): Span =>
      isOutdoorCategory(candidate.category)
        ? { start: intent.window.start, end: Math.min(intent.window.end, dusk) }
        : intent.window;
    const { kept } = hardFilter(
      scored.filter(
        (c) =>
          intent.categories.includes(c.category) && !struck.has(c.place.id),
      ),
      date,
      windowFor,
      (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min,
    );
    const size = menuSizeFor(intent);

    /**
     * The ANCHOR's menu is filtered by calibre (XXX-35, Session 13 Step 2).
     *
     * Everywhere else the score decides, and that is right — an ordinary
     * stop's job is to fit the persona. The centre's job is different, and
     * `scoreCandidate` cannot see the difference: it ranked a pocket park
     * first inside `parks` for a nature-first persona and was working
     * correctly when it did.
     *
     * Filter rather than re-rank, because a selector handed a sub-calibre
     * option will sometimes take it, and "sometimes seats a 20-minute
     * anchor" is the defect. If NOTHING clears the bar the menu is left
     * whole — an anchorless day is worse than a small one — and the
     * shortfall is reported instead of hidden.
     */
    if (intent.role === "anchor") {
      const { worthy } = partitionByCalibre(kept, (c) => ({
        name: c.place.name,
        category: c.category,
        userRatingCount: c.userRatingCount,
      }));
      if (worthy.length > 0) {
        return {
          intent,
          // No cuisine reservation on the ANCHOR: a day's centrepiece is
          // chosen for calibre, and a restaurant is rarely the centre. Meals
          // are where a stated cuisine belongs.
          options: allocateMenu(worthy, intent.categories, size),
        };
      }
    }
    return {
      intent,
      options: allocateMenu(
        kept,
        intent.categories,
        size,
        intent.licensedCategory,
        lovedCuisines,
      ),
    };
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
    /**
     * What the arc draw depends on, so ANY trace can be replayed — not just
     * the tasting room's, which alone recorded a persona key. Session 12's
     * seed defect survived a whole session partly because the harness traces
     * that spent most of the month's Details budget could not be checked
     * against their own recorded seed. An identity hash and a pace are
     * enough to re-pick the template; neither is the persona itself.
     */
    persona_identity: personaIdentity(request.persona),
    persona_pace: request.persona.pace,
    pool_candidates: stats.poolCandidates,
    shortlisted: stats.shortlisted,
    details_calls: stats.detailsCalls, // the 87% canary, first-class
    search_text_calls: stats.searchTextCalls,
    links_minted: stats.linksMinted,
    transit_calls: stats.transitCalls,
    validation_passes: stats.validationPasses,
    founder_overrides: stats.founderOverrides,
    founder_overrides_expired: stats.founderExpired,
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
