/**
 * The tasting room's wire contract (XXX-32).
 *
 * The page is a client component and may not import `src/server/**`
 * (the API-first boundary rule), so the shapes the route returns live
 * here where both sides can see them. Types only — no logic, no I/O.
 */

import type { TimelineDay } from "./timeline";

export interface TastingQuota {
  generationsToday: number;
  dailyCap: number;
  /** City-local midnight the daily count resets at, as an instant. */
  resetsAt: string;
  detailsThisMonth: number;
  detailsFreeCap: number;
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
  quota: TastingQuota;
}

export interface NarratedLineView {
  ruleId: string;
  text: string;
  /**
   * The stops this note is about (XXX-43, Session 15).
   *
   * `NarratedLine` has carried `slotIds` all along and this boundary DROPPED
   * it, which is why every per-stop note piled up in one wall above the day
   * instead of sitting on the card it concerned. Restoring it is most of what
   * collapses the wall: a note about slot 3 belongs on slot 3.
   *
   * Empty = a day-level note, which is the only kind that belongs at the foot.
   */
  slotIds: string[];
}

/**
 * Stated when a day was vetted without weather (XXX-35 §1.5).
 *
 * The page offers dates well past the forecast horizon, so a founder can
 * spend an evening vetting days whose weather nobody checked — and until
 * now the page did not say so. Driven by the environment (`windows ===
 * null` is the fact), never by arithmetic on the date: the horizon is the
 * EXPLANATION, the missing row is the evidence.
 *
 * `null` = the day was weather-checked.
 */
export interface WeatherBlindNotice {
  date: string;
  daysOut: number;
  horizonDays: number;
}

export type TastingOutcome =
  | {
      status: "ok";
      day: TimelineDay;
      headline: string;
      advisories: NarratedLineView[];
      dayNotes: string[];
      unfilled: { label: string; cause: string }[];
      /**
       * Non-null = the day's centre could only be seated below anchor
       * calibre, and no re-election did better (XXX-35, Session 13). The
       * founder's own finding — "An anchor that lasts only 20 mins?" — was
       * invisible on the page that produced it. This is what makes it
       * visible without waiting for anyone to read a trace.
       */
      anchorDegraded: {
        category: string;
        fittedMinutes: number;
        floorMinutes: number;
      } | null;
      /** True = a fabricated day. The page must say so, loudly. */
      synthetic: boolean;
      /**
       * What organizing mode built this day, and whether the traveller asked
       * for it (XXX-40). `reason` is present only for a derived theme — a
       * requested one needs no explanation.
       */
      theme: { id: string; origin: "requested" | "derived"; reason: string | null };
      /** Distinct fact/travel sources on this day — attribution keys off it. */
      sources: string[];
      /** Non-null = generated weather-blind. One honest line, not a modal. */
      weatherBlind: WeatherBlindNotice | null;
      /**
       * Free time the arc placed, with the neighbourhood it happens in
       * (XXX-35). The timeline renders these as gap cards: an unshown gap
       * is what the founder read off the timestamps as "2hr13 wasted".
       */
      openPeriods: {
        id: string;
        startTime: string;
        endTime: string;
        locality: string;
        reason: string;
      }[];
      meter: TastingMeter;
    }
  | {
      /** Grammar-loop exhaustion. Surfaced honestly; a founder should see it. */
      status: "failed";
      headline: string;
      violations: NarratedLineView[];
      meter: TastingMeter;
    }
  | {
      /**
       * A requested theme that cannot be built on this date (XXX-40). Not a
       * failure — the day was never possible, and the room says which theme
       * and why rather than quietly showing a different kind of day.
       */
      status: "theme-infeasible";
      theme: string;
      reason: string;
      detail: string;
      meter: TastingMeter;
    }
  | {
      status: "capped";
      quota: TastingQuota;
      /** Where to raise the guard. A guard should name its own switch. */
      raiseAt: string;
      note: string;
    };

export interface EvidenceResultView {
  evidenceId: string;
  authority: "founder" | "trusted" | "user";
  verificationState: "bypassed" | "queued" | "not_queued";
  flippedFactKey: string | null;
  note?: string;
}
