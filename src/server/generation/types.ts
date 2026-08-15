/**
 * Generation-engine vocabulary (XXX-5 Session 9).
 *
 * The candidate carrier is deliberately `GrammarPlace`: request-time
 * Google facts land as in-memory `GrammarFact`s with full E1 provenance
 * (constraint 2 applies to transient facts too — decision 001 ambiguity
 * 2), and the same object flows into the composed `GrammarDay` unchanged.
 * There is no second fact shape to drift.
 */

import type { NarratedDay } from "@/shared/day-grammar/describe";
import type {
  GrammarDay,
  GrammarPlace,
  LatLng,
  MealPatternId,
  Violation,
} from "@/shared/day-grammar/types";
import type { Span } from "@/shared/day-grammar/predicates";
import type { Persona } from "@/shared/persona";
import type { PriceRange } from "@/shared/timeline";
import type {
  City,
  PlaceCategory,
  SlotKind,
  SlotRole,
  Tier,
  TransportMode,
} from "@/shared/vocabulary";

/** A user commitment, as the request states it (XXX-27 shape, engine v1). */
export interface AnchorInput {
  label: string;
  coords: LatLng;
  /** City-local "HH:MM". */
  startTime: string;
  endTime: string;
  highCrowd?: boolean;
}

export interface GenerationRequest {
  city: City;
  /** "YYYY-MM-DD" city-local. */
  date: string;
  persona: Persona;
  budgetBand: PriceRange | null;
  /** Selected upstream by taste; defaulted from persona when absent. */
  mealPattern?: MealPatternId;
  /** Modes the traveller will use, in preference order. */
  transport: TransportMode[];
  anchors?: AnchorInput[];
  lodging?: LatLng | null;
  /**
   * Exploration seed. Given → the deterministic layers reproduce exactly
   * (tests, replays). Absent → the engine draws one and logs it in the
   * trace, so any production day is replayable.
   */
  seed?: number;
  dayStart?: string;
  dayEnd?: string;
}

/** One pool row plus everything learned about it during this request. */
export interface Candidate {
  /** Facts accumulate here in memory; `id` is the pool UUID. */
  place: GrammarPlace;
  category: PlaceCategory;
  /** The stored link if one existed; minted-and-verified links update it. */
  googlePlaceId: string | null;
  /** Rating rides the candidate, not the place — no grammar rule reads it. */
  rating: number | null;
  userRatingCount: number | null;
  /** Whether request-time Details facts were fetched for this candidate. */
  detailsFetched: boolean;
  score: number;
}

/** What a slot in the skeleton wants, before any venue is chosen. */
export interface SlotIntent {
  id: string;
  kind: SlotKind;
  /** "breakfast" / "morning activity" — narration + trace vocabulary. */
  label: string;
  /** Minutes-of-day window the slot must land inside. */
  window: Span;
  categories: PlaceCategory[];
  dwellMinutes: number;
  /** What this stop is FOR in the day's arc (XXX-35). */
  role?: SlotRole;
}

/**
 * The concierge's elected centrepiece (XXX-35). Tier 3 and labelled: it is
 * a judgment about the day's shape, and the founder can overrule it — a
 * user-origin anchor pre-empts election entirely.
 */
export interface ElectedAnchorRecord {
  category: PlaceCategory;
  dwellMinutes: number;
  reason: string;
  source: string;
  tier: Tier;
}

/** Free time the arc reserved, before seating decides its exact bounds. */
export interface OpenIntervalPlan {
  id: string;
  /** The intent this period follows; null = the start of the day. */
  afterIntentId: string | null;
  minutes: number;
}

/**
 * Free time as a PLACED choice: it has a location and a reason.
 *
 * Deliberately not a slot. `slots.place_id` is NOT NULL and
 * `slots_kind_valid` admits only meal|activity, so representing free time
 * as a slot would mean a migration to store something that is not a stop.
 * It rides alongside the day exactly as `ComposedLeg` does.
 *
 * The founder's complaint was not that free time existed — it was "too
 * much free time; that too in the middle of nowhere". `locality` is the
 * answer to the second half.
 */
export interface OpenPeriod {
  id: string;
  startTime: string;
  endTime: string;
  /** The neighbourhood the traveller is in for it. */
  locality: string;
  reason: "before the anchor" | "after the anchor" | "evening drift";
  /**
   * true  = the arc RESERVED this time: a template `open` step moved the
   *         cursor on purpose, so the next stop was pushed later.
   * false = the day produced it and we are NAMING it rather than hiding it.
   *
   * The distinction is kept because collapsing it would be a small lie, and
   * because it is the honest answer to the CP2 finding: the first build
   * only surfaced reserved periods, so the templates without an `open` step
   * still delivered the founder's unexplained gap — 135 minutes of it,
   * worse than the 133 they complained about. A traveller experiences both
   * kinds identically; a reviewer should be able to tell them apart.
   */
  placed: boolean;
}

/** The bounded choice offered to the selector: legal options only. */
export interface Menu {
  intent: SlotIntent;
  options: Candidate[];
}

export interface Selection {
  intentId: string;
  placeId: string;
  /** The selector's one-clause why — seeds narration; absent on the
   * deterministic path. */
  reasonSeed?: string;
}

/**
 * The selection seam. Step 2's deterministic selector and Step 3's LLM
 * selector implement the same contract; the grammar loop strikes
 * candidates by excluding them from the menus it re-offers, and passes
 * the violation messages as `feedback` (regenerationFeedback's block) so
 * a taste-driven selector can avoid repeating the mistake, not just the
 * venue.
 */
export interface Selector {
  select(
    menus: Menu[],
    persona: Persona,
    seed: number,
    feedback?: string,
  ): Promise<Selection[]>;
}

export interface StageTimings {
  retrieveMs: number;
  linkMs: number;
  detailsMs: number;
  composeMs: number;
  validateMs: number;
  selectMs: number;
  narrateMs: number;
  totalMs: number;
}

export interface GenerationStats {
  traceId: string;
  seed: number;
  poolCandidates: number;
  shortlisted: number;
  detailsCalls: number;
  searchTextCalls: number;
  linksMinted: number;
  transitCalls: number;
  validationPasses: number;
  /** What each failed pass tripped on — XXX-20's streaming story reads this. */
  repairLog: { pass: number; ruleIds: string[] }[];
  /** Intents the final day could not seat, and why — never silent. */
  unfilled: { intentId: string; label: string; cause: "empty-menu" | "unschedulable" }[];
  /** Founder ground-truth facts that governed this generation (XXX-33). */
  founderOverrides: number;
  /** Founder facts past their horizon: they governed nothing and said so. */
  founderExpired: number;
  anthropic: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    /** List price ($3/$15 per MTok, Sonnet 5); intro billing runs lower. */
    estCostUsd: number;
    /** Contract rejections: parse failures + out-of-menu ids, per stage. */
    contractRetries: number;
    toneRetries: number;
  };
  /** The 87% canary (CP1 ruling 4): Details events are first-class. */
  estCostUsd: number;
  timings: StageTimings;
}

/**
 * One priced hop between consecutive stops, with the provider's own
 * provenance. Surfaced so the timeline can show real travel numbers with
 * a real source (doc 003 permits displaying durations, mapless, with
 * attribution) instead of a hand-wave.
 */
export interface ComposedLeg {
  fromPlaceId: string;
  toPlaceId: string;
  minutes: number;
  mode: TransportMode;
  source: string;
  tier: Tier;
  /**
   * Present when the composer took the traveller off an over-cap walk
   * (XXX-35 item 1). It exists so the narration can be DETERMINISTIC: the
   * swap produces no advisory — the day is correct — so without the
   * counterfactual recorded here, "I put you on the subway, it's -8 out"
   * could only be an LLM sentence with an invented number in it. The
   * temperature rendered is the temperature the cap function read.
   */
  exposureSwap: {
    fromMode: TransportMode;
    toMode: TransportMode;
    exposedMinutes: number;
    capMinutes: number;
    apparentTempC: number;
    drivers: string[];
  } | null;
}

export interface CardReason {
  slotId: string;
  /** One concierge sentence citing lower-layer facts. Empty in Step 2. */
  reason: string;
}

export type GenerationOutcome =
  | {
      status: "ok";
      day: GrammarDay;
      /** The hops the scheduler priced, with provenance. */
      travel: ComposedLeg[];
      /** Free time the arc placed — located and reasoned, never residue. */
      openPeriods: OpenPeriod[];
      /** null = a user anchor pre-empted election. */
      electedAnchor: ElectedAnchorRecord | null;
      /**
       * Non-null = the day's centre had to be seated below anchor calibre
       * and no re-election could do better (XXX-35, Session 13 Step 2). The
       * founder's finding was a 20-minute pocket park seated as a
       * centrepiece in silence; this is the end of the silence.
       */
      anchorDegraded: {
        category: PlaceCategory;
        fittedMinutes: number;
        floorMinutes: number;
      } | null;
      /** Which arc shape built this day (XXX-35) — auditable after the fact. */
      /**
       * Non-null = every option on the anchor's menu was measured and none
       * was fit to be a centrepiece. The day still has a centre — an
       * anchorless day is worse — but the shortfall is on the record.
       */
      anchorCalibreUnmet: { category: PlaceCategory; examined: number } | null;
      arcTemplateId: string;
      /** Advisories only — a day with violations never reaches here. */
      findings: Violation[];
      narrated: NarratedDay;
      reasons: CardReason[];
      dayNotes: string[];
      stats: GenerationStats;
    }
  | {
      /** Grammar-loop exhaustion: surfaced honestly, never shipped. */
      status: "failed";
      violations: Violation[];
      narrated: NarratedDay;
      stats: GenerationStats;
    };
