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
}

export type TastingOutcome =
  | {
      status: "ok";
      day: TimelineDay;
      headline: string;
      advisories: NarratedLineView[];
      dayNotes: string[];
      unfilled: { label: string; cause: string }[];
      /** True = a fabricated day. The page must say so, loudly. */
      synthetic: boolean;
      /** Distinct fact/travel sources on this day — attribution keys off it. */
      sources: string[];
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
