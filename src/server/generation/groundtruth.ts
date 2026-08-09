/**
 * Founder ground-truth override (XXX-33, engine stage 3b).
 *
 * One indexed read of the founder's stored facts for the shortlist, then
 * the pure precedence/staleness math in `@/shared/founder-groundtruth`.
 * Runs AFTER the request-time Details fetch and BEFORE the hard filters,
 * which is the only place it can bite: the filters are what exclude a
 * place the founder says is shut, and the composer is what re-windows a
 * visit against corrected hours.
 *
 * Nothing is written here and nothing Google-derived is stored: the
 * override replaces a value on its way into one request. Decision 001 is
 * untouched.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  applyFounderFacts,
  FOUNDER_FACT_KEYS,
  FOUNDER_SOURCE,
  type FounderFact,
  type OverrideOutcome,
} from "@/shared/founder-groundtruth";
import { BUSINESS_STATUSES } from "@/shared/day-grammar/types";
import { priceRangeSchema } from "@/shared/timeline";
import { WEEKDAYS, weekdayOf, type Weekday } from "@/shared/vocabulary";
import type { Candidate } from "./types";

const intervalSchema = z.strictObject({
  open: z.string(),
  close: z.string(),
});

/**
 * Stored founder facts are OUR data, but they are still parsed at the
 * boundary — a row written by an older schema is untrusted input like
 * any other (parse, don't validate-and-hope).
 */
const rowSchema = z.discriminatedUnion("fact_key", [
  z.object({
    fact_key: z.literal("business_status"),
    value: z.enum(BUSINESS_STATUSES),
    fetched_at: z.string(),
  }),
  z.object({
    fact_key: z.literal("hours_corrections"),
    value: z.record(z.enum(WEEKDAYS), z.array(intervalSchema)),
    fetched_at: z.string(),
  }),
  z.object({
    fact_key: z.literal("price_range"),
    value: priceRangeSchema,
    fetched_at: z.string(),
  }),
]);

export interface GroundtruthOutcome {
  candidates: Candidate[];
  applied: { placeId: string; factKey: string }[];
  /** Governed nothing, and why — expiries surface as re-verification work. */
  skipped: {
    placeId: string;
    factKey: string;
    reason: OverrideOutcome["skipped"][number]["reason"];
    ageDays: number;
  }[];
}

export async function applyFounderGroundtruth(
  client: SupabaseClient,
  candidates: Candidate[],
  date: string,
  nowIso: string,
): Promise<GroundtruthOutcome> {
  const placeIds = candidates.map((c) => c.place.id);
  if (placeIds.length === 0) {
    return { candidates, applied: [], skipped: [] };
  }

  const { data, error } = await client
    .from("facts")
    .select("place_id, fact_key, value, fetched_at")
    .in("place_id", placeIds)
    .eq("source", FOUNDER_SOURCE)
    .eq("status", "present")
    .in("fact_key", [...FOUNDER_FACT_KEYS]);
  if (error) {
    throw new Error(`founder groundtruth read failed: ${error.message}`);
  }

  const byPlace = new Map<string, FounderFact[]>();
  for (const row of data ?? []) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) continue; // a malformed stored fact governs nothing
    const fact = {
      factKey: parsed.data.fact_key,
      value: parsed.data.value,
      fetchedAt: parsed.data.fetched_at,
    } as FounderFact;
    const placeId = (row as { place_id: string }).place_id;
    byPlace.set(placeId, [...(byPlace.get(placeId) ?? []), fact]);
  }

  if (byPlace.size === 0) return { candidates, applied: [], skipped: [] };

  const weekday: Weekday = weekdayOf(date);
  const applied: GroundtruthOutcome["applied"] = [];
  const skipped: GroundtruthOutcome["skipped"] = [];
  const next = candidates.map((candidate) => {
    const facts = byPlace.get(candidate.place.id);
    if (facts === undefined) return candidate;
    const outcome = applyFounderFacts(candidate.place, facts, weekday, nowIso);
    for (const factKey of outcome.applied) {
      applied.push({ placeId: candidate.place.id, factKey });
    }
    for (const entry of outcome.skipped) {
      skipped.push({ placeId: candidate.place.id, ...entry });
    }
    return { ...candidate, place: outcome.place };
  });

  return { candidates: next, applied, skipped };
}
