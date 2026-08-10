/**
 * Founder ground-truth precedence and staleness (XXX-33, Session 10 CP1).
 *
 * Constraint 3 says APIs own facts. Comment 10289 exempts one channel:
 * founder ground-truth is "unconditional tier 1 — operator trust". This
 * module is that exemption expressed as arithmetic, and it is the only
 * place the precedence question is answered.
 *
 * The doctrine, in one paragraph. Google's hours for a small restaurant
 * come from a merchant listing the merchant maintains badly — trap class
 * 2 exists because of it, and trap class 1 (permanently-closed places
 * still listed) is the trust-killer this project was rebuilt around. The
 * founder stood at the door. Between two tier-1 facts the tie is broken
 * by CHANNEL, not by timestamp.
 *
 * Why not freshest-wins: Google is re-fetched on every single
 * generation, so its fetchedAt is always newer than any founder fact by
 * minutes. Freshest-wins would override the correction on the very next
 * generation and it would never once govern. It reads as principled and
 * is silently useless.
 *
 * Why not pinned-forever (except one arm): a correction is an
 * observation at an instant, and the founder will not revisit every
 * venue annually. So each claim class governs for a horizon drawn from
 * how that part of the world actually changes, and then EXPIRES LOUDLY —
 * it stops governing, the trace records it, and it surfaces as
 * re-verification work. It never silently reverts to the answer the
 * founder rejected (constraint 4, pointed at our own data).
 *
 * Pure and dependency-free: no I/O, no clock of its own — `nowIso` is
 * always passed in, so every horizon boundary is a unit test.
 */

import type {
  BusinessStatus,
  GrammarFact,
  GrammarPlace,
  HoursByWeekday,
  HoursCorrections,
} from "./day-grammar/types";
import type { PriceRange } from "./timeline";
import type { Tier, Weekday } from "./vocabulary";

/** The one source string the founder channel writes under. */
export const FOUNDER_SOURCE = "founder_groundtruth";
const FOUNDER_TIER: Tier = 1;

export const FOUNDER_FACT_KEYS = [
  "business_status",
  "hours_corrections",
  "price_range",
] as const;
export type FounderFactKey = (typeof FOUNDER_FACT_KEYS)[number];

/** A stored founder fact, already parsed at the server boundary. */
export type FounderFact =
  | { factKey: "business_status"; value: BusinessStatus; fetchedAt: string }
  | { factKey: "hours_corrections"; value: HoursCorrections; fetchedAt: string }
  | { factKey: "price_range"; value: PriceRange; fetchedAt: string };

/**
 * How long a founder fact governs, in days. `null` = no expiry.
 *
 * The horizons are arguments, not preferences:
 *
 * - `closed_permanently`, no expiry. A permanent closure is a fact about
 *   a discontinued thing, not a perishable observation, and the stakes
 *   are asymmetric in comment 10289's own sense: pinning wrongly costs
 *   one venue out of a 31,377-place pool (≈ nothing), un-pinning wrongly
 *   means recommending a shuttered restaurant (the trust-killer). A new
 *   business at that address is a different identity — a new
 *   google_place_id — and a genuine reopening is a founder retraction.
 * - Any other `business_status` (the founder overruling a Google
 *   "closed"), 180 days. A reopening IS perishable, and here the stakes
 *   point the other way: a wrong "it's open" is the trust-killer.
 * - `hours_corrections`, 180 days. Seasonal hours turn over roughly
 *   twice a year — the golden set's own FIKA / MOCA / Winter-Village
 *   traps are all seasonal or weekday-shaped. Older than a season, a
 *   correction is likelier stale than the API.
 * - `price_range`, 90 days. Menu prices drift continuously, and Delhi's
 *   cash-economy ranges drift faster.
 */
export function horizonDays(fact: FounderFact): number | null {
  switch (fact.factKey) {
    case "business_status":
      return fact.value === "closed_permanently" ? null : 180;
    case "hours_corrections":
      return 180;
    case "price_range":
      return 90;
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days elapsed since `fetchedAt`. Negative clamps to 0. */
export function ageDays(fetchedAt: string, nowIso: string): number {
  const elapsed = Date.parse(nowIso) - Date.parse(fetchedAt);
  return Math.max(0, Math.floor(elapsed / MS_PER_DAY));
}

/**
 * Does this founder fact still govern? A fact expires the day it passes
 * its horizon: at exactly `horizonDays` it still governs, at
 * `horizonDays + 1` it does not.
 */
export function isGoverning(fact: FounderFact, nowIso: string): boolean {
  const horizon = horizonDays(fact);
  return horizon === null || ageDays(fact.fetchedAt, nowIso) <= horizon;
}

/** Why a governing founder fact still changed nothing. */
export type SkipReason =
  | "expired"
  /** hours_corrections says nothing about the weekday being generated. */
  | "weekday-not-corrected"
  /**
   * hours_corrections with no Google hours to correct. Building a whole
   * week from one known weekday would invent six days of closure —
   * exactly the silent fallback constraint 4 forbids — so the correction
   * governs nothing and says so. See the module note in applyFounderFacts.
   */
  | "no-base-hours";

export interface OverrideOutcome {
  place: GrammarPlace;
  applied: FounderFactKey[];
  skipped: { factKey: FounderFactKey; reason: SkipReason; ageDays: number }[];
}

const founderFact = <T>(value: T, fetchedAt: string): GrammarFact<T> => ({
  status: "present",
  value,
  source: FOUNDER_SOURCE,
  tier: FOUNDER_TIER,
  fetchedAt,
});

/**
 * Supersede a place's facts with the founder's, for ONE generation, in
 * memory. Nothing here is persisted and nothing Google-derived is
 * written anywhere — the override replaces a value on its way into the
 * request, which is why it leaves decision 001 untouched.
 *
 * `weekday` is the weekday of the date being generated: hours
 * corrections are per-weekday, so a Tuesday correction is simply not
 * relevant to a Saturday and says so rather than governing by accident.
 */
export function applyFounderFacts(
  place: GrammarPlace,
  facts: readonly FounderFact[],
  weekday: Weekday,
  nowIso: string,
): OverrideOutcome {
  const applied: FounderFactKey[] = [];
  const skipped: OverrideOutcome["skipped"] = [];
  let next = place;

  for (const fact of facts) {
    const age = ageDays(fact.fetchedAt, nowIso);
    if (!isGoverning(fact, nowIso)) {
      skipped.push({ factKey: fact.factKey, reason: "expired", ageDays: age });
      continue;
    }

    if (fact.factKey === "business_status") {
      next = { ...next, businessStatus: founderFact(fact.value, fact.fetchedAt) };
      applied.push(fact.factKey);
      continue;
    }

    if (fact.factKey === "price_range") {
      next = { ...next, priceRange: founderFact(fact.value, fact.fetchedAt) };
      applied.push(fact.factKey);
      continue;
    }

    const corrected = fact.value[weekday];
    if (corrected === undefined) {
      skipped.push({
        factKey: fact.factKey,
        reason: "weekday-not-corrected",
        ageDays: age,
      });
      continue;
    }
    if (next.hours === undefined || next.hours.status !== "present") {
      skipped.push({
        factKey: fact.factKey,
        reason: "no-base-hours",
        ageDays: age,
      });
      continue;
    }
    const merged: HoursByWeekday = { ...next.hours.value, [weekday]: corrected };
    // Provenance names the channel that GOVERNS the weekday being
    // generated — the only weekday anything reads from this fact. The
    // untouched weekdays ride along from Google unchanged and unread;
    // this projection exists for one date and is never persisted.
    next = { ...next, hours: founderFact(merged, fact.fetchedAt) };
    applied.push(fact.factKey);
  }

  return { place: next, applied, skipped };
}
