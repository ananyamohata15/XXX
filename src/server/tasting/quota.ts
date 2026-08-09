/**
 * The tasting room's self-cap and spend gauge (XXX-32, CP1 ruling 2).
 *
 * The cap is a RUNAWAY GUARD, not a budget. It stops a page that
 * regenerates on mount, a stuck retry, or an enthusiastic evening; it
 * does not stop sustained daily use from costing real money. That is
 * what the gauge is for — the founder watches month-to-date Details
 * events against Google's 1,000/month Enterprise free cap while
 * spending them, which is a budget control a number in code cannot be.
 *
 * Counting is by TRACE, tagged at start, so a generation that spent
 * money and then crashed still counts against the day. The alternative
 * (counting successes) would let a failing loop spend without limit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { CITY_GEO } from "@/shared/vocabulary";
import { localToUtcIso } from "../generation/engine";
import { TASTING_SURFACE } from "../feedback/shown";

/** Ruled at CP1: three review sittings of 3–4 generations, plus mistakes. */
export const TASTING_DAILY_CAP = 12;

/** Google Places Enterprise SKU: 1,000 free events per calendar month. */
export const DETAILS_FREE_EVENTS_PER_MONTH = 1000;

import type { TastingQuota } from "@/shared/tasting";

/** The wire shape lives in src/shared so the page can read it too. */
export type QuotaStatus = TastingQuota;

/** The instant of the most recent midnight in the city's own timezone. */
export function cityDayStart(nowIso: string, city: "toronto"): string {
  const timezone = CITY_GEO[city].timezone;
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowIso));
  return localToUtcIso(localDate, "00:00", timezone);
}

/** First instant of the current UTC calendar month — Google bills monthly. */
export function monthStart(nowIso: string): string {
  return `${nowIso.slice(0, 7)}-01T00:00:00.000Z`;
}

export async function readQuota(
  client: SupabaseClient,
  nowIso: string,
): Promise<QuotaStatus> {
  const dayStart = cityDayStart(nowIso, "toronto");
  const nextReset = cityDayStart(
    new Date(Date.parse(dayStart) + 26 * 3600_000).toISOString(),
    "toronto",
  );

  // count: "exact" without head: a HEAD-shaped request can answer
  // healthily while hiding an error (Session 1's false-healthy incident);
  // asking for a row keeps failures loud.
  const generations = await client
    .from("traces")
    .select("id", { count: "exact" })
    .eq("kind", "day_generation")
    .eq("metadata->>surface", TASTING_SURFACE)
    .gte("started_at", dayStart)
    .limit(1);
  if (generations.error) {
    throw new Error(`quota read failed: ${generations.error.message}`);
  }

  const details = await client
    .from("trace_events")
    .select("id", { count: "exact" })
    .eq("provider", "google_places")
    .eq("endpoint", "places.get(engine)")
    .gte("created_at", monthStart(nowIso))
    .limit(1);
  if (details.error) {
    throw new Error(`details gauge read failed: ${details.error.message}`);
  }

  return {
    generationsToday: generations.count ?? 0,
    dailyCap: TASTING_DAILY_CAP,
    resetsAt: nextReset,
    detailsThisMonth: details.count ?? 0,
    detailsFreeCap: DETAILS_FREE_EVENTS_PER_MONTH,
  };
}

export const capReached = (quota: QuotaStatus): boolean =>
  quota.generationsToday >= quota.dailyCap;
