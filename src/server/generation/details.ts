/**
 * Request-time fact conversion (CP1 §1.1 stage 3): one Google Details
 * response → in-memory `GrammarFact`s on the candidate's `GrammarPlace`.
 *
 * Provenance follows the golden-fixture precedent for the same fields:
 * business status and hours are tier 1 (a live answer from the
 * authoritative source at a known instant), price is tier 2 when Google
 * publishes a range and tier 3 when we band it from `priceLevel` (the
 * banding is our judgment, and it says so). Rating rides the Candidate,
 * not the place — no grammar rule reads it; it exists for scoring only.
 *
 * Nothing returned here may outlive the request except through the two
 * granted channels the caller owns (place id, coordinates). The Google
 * display name is surfaced ONLY for the in-memory match comparison and
 * must go no further (doc 002 §3 discipline).
 */

import type {
  BusinessStatus,
  GrammarFact,
  HoursByWeekday,
  OpenInterval,
} from "@/shared/day-grammar/types";
import type { PriceRange } from "@/shared/timeline";
import { WEEKDAYS } from "@/shared/vocabulary";
import type { EngineDetailsResponse } from "./google";
import type { Candidate } from "./types";

export const ENGINE_FACT_SOURCE = "google_places";

const STATUS_MAP: Record<string, BusinessStatus> = {
  OPERATIONAL: "operational",
  CLOSED_TEMPORARILY: "closed_temporarily",
  CLOSED_PERMANENTLY: "closed_permanently",
};

/**
 * Tier-3 CAD bands for Google's coarse price levels. Judgment, marked as
 * such in the fact's tier — a banded guess must never outrank a
 * published range.
 */
const PRICE_LEVEL_BANDS: Record<string, { min: number; max: number }> = {
  PRICE_LEVEL_FREE: { min: 0, max: 0 },
  PRICE_LEVEL_INEXPENSIVE: { min: 5, max: 15 },
  PRICE_LEVEL_MODERATE: { min: 15, max: 40 },
  PRICE_LEVEL_EXPENSIVE: { min: 40, max: 80 },
  PRICE_LEVEL_VERY_EXPENSIVE: { min: 80, max: 150 },
};

const hhmm = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/**
 * Google periods → per-weekday intervals (trap 2's shape). An overnight
 * period contributes both of its true parts — [open, 24:00] on the open
 * day and [00:00, close] on the close day — so nothing is invented and
 * nothing legal is dropped. A single open point at Sunday 00:00 with no
 * close is Google's 24/7 encoding.
 */
export function periodsToHours(
  periods: NonNullable<
    NonNullable<EngineDetailsResponse["regularOpeningHours"]>["periods"]
  >,
): HoursByWeekday {
  const byDay: OpenInterval[][] = WEEKDAYS.map(() => []);
  for (const period of periods) {
    if (period.close === undefined) {
      if (period.open.day === 0 && period.open.hour === 0) {
        return Object.fromEntries(
          WEEKDAYS.map((d) => [d, [{ open: "00:00", close: "24:00" }]]),
        ) as HoursByWeekday;
      }
      continue; // close missing on a non-24/7 period: unusable, skip
    }
    const openTime = hhmm(period.open.hour, period.open.minute);
    const closeTime = hhmm(period.close.hour, period.close.minute);
    if (period.close.day === period.open.day) {
      byDay[period.open.day].push({ open: openTime, close: closeTime });
    } else {
      byDay[period.open.day].push({ open: openTime, close: "24:00" });
      if (closeTime !== "00:00") {
        byDay[period.close.day].push({ open: "00:00", close: closeTime });
      }
    }
  }
  const out = {} as HoursByWeekday;
  WEEKDAYS.forEach((day, i) => {
    out[day] = byDay[i].sort((a, b) => a.open.localeCompare(b.open));
  });
  return out;
}

export interface AppliedDetails {
  candidate: Candidate;
  /** Request-scoped; compared in the caller's memory, then gone. */
  googleName: string | null;
  /** Storable under the 30-day regime via the discovery repo. */
  location: { lat: number; lng: number } | null;
}

export function applyDetails(
  candidate: Candidate,
  response: EngineDetailsResponse,
  fetchedAt: string,
): AppliedDetails {
  const fact = <T>(
    value: T | null,
    tier: 1 | 2 | 3,
  ): GrammarFact<T> =>
    value === null
      ? { status: "absent", source: ENGINE_FACT_SOURCE, tier, fetchedAt }
      : { status: "present", value, source: ENGINE_FACT_SOURCE, tier, fetchedAt };

  const status = STATUS_MAP[response.businessStatus ?? ""] ?? null;
  const periods = response.regularOpeningHours?.periods;
  const hours = periods !== undefined && periods.length > 0 ? periodsToHours(periods) : null;

  let priceRange: PriceRange | null = null;
  let priceTier: 2 | 3 = 2;
  const start = response.priceRange?.startPrice;
  const end = response.priceRange?.endPrice;
  if (start?.units !== undefined || end?.units !== undefined) {
    const min = Number(start?.units ?? 0);
    const max = Number(end?.units ?? start?.units ?? 0);
    priceRange = {
      min,
      max: Math.max(min, max),
      currency: start?.currencyCode ?? end?.currencyCode ?? "CAD",
    };
  } else if (response.priceLevel !== undefined) {
    const band = PRICE_LEVEL_BANDS[response.priceLevel];
    if (band !== undefined) {
      priceRange = { ...band, currency: "CAD" };
      priceTier = 3;
    }
  }

  return {
    candidate: {
      ...candidate,
      place: {
        ...candidate.place,
        businessStatus: fact(status, 1),
        hours: fact(hours, 1),
        priceRange: fact(priceRange, priceTier),
      },
      rating: response.rating ?? null,
      userRatingCount: response.userRatingCount ?? null,
      detailsFetched: true,
    },
    googleName: response.displayName?.text ?? null,
    location: response.location
      ? { lat: response.location.latitude, lng: response.location.longitude }
      : null,
  };
}
