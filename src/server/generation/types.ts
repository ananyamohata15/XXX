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
}

/** The bounded choice offered to the selector: legal options only. */
export interface Menu {
  intent: SlotIntent;
  options: Candidate[];
}

export interface Selection {
  intentId: string;
  placeId: string;
}

/**
 * The selection seam. Step 2's deterministic selector and Step 3's LLM
 * selector implement the same contract; the grammar loop strikes
 * candidates by excluding them from the menus it re-offers.
 */
export interface Selector {
  select(menus: Menu[], persona: Persona, seed: number): Promise<Selection[]>;
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
  /** The 87% canary (CP1 ruling 4): Details events are first-class. */
  estCostUsd: number;
  timings: StageTimings;
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
