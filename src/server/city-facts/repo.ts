/**
 * city_facts repository + its Zod boundary (XXX-38/40, Session 14).
 *
 * External and stored payloads are untrusted input (CLAUDE.md: parse, don't
 * validate-and-hope), so the timetable is parsed on the way OUT of the
 * database as well as on the way in. A malformed row is a loud failure, not
 * a day quietly composed without a boat.
 *
 * Single-owner-per-fact: this module owns city-scoped facts. Nothing else
 * reads the table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  seasonCovers,
  type CityFact,
  type CityFactKind,
  type FerryTimetable,
} from "@/shared/city-facts";
import { TIER_VALUES, type Tier } from "@/shared/vocabulary";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ferryTimetableSchema = z.object({
  routeKey: z.string().min(1),
  label: z.string().min(1),
  crossingMinutes: z.number().int().positive(),
  outbound: z.array(z.string().regex(HHMM)).min(1),
  inbound: z.array(z.string().regex(HHMM)).min(1),
});

const cityFactRowSchema = z.object({
  city: z.string().min(1),
  fact_kind: z.string().min(1),
  subject_key: z.string().min(1),
  value: z.unknown(),
  source: z.string().min(1),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  fetched_at: z.string().min(1),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
});

const COLUMNS =
  "city, fact_kind, subject_key, value, source, tier, fetched_at, valid_from, valid_to";

export interface NewCityFact<T> {
  city: string;
  factKind: CityFactKind;
  subjectKey: string;
  value: T;
  source: string;
  tier: Tier;
  fetchedAt: string;
  validFrom: string | null;
  validTo: string | null;
}

export async function upsertCityFact<T>(
  client: SupabaseClient,
  fact: NewCityFact<T>,
): Promise<void> {
  const { error } = await client.from("city_facts").upsert(
    {
      city: fact.city,
      fact_kind: fact.factKind,
      subject_key: fact.subjectKey,
      value: fact.value,
      source: fact.source,
      tier: fact.tier,
      fetched_at: fact.fetchedAt,
      valid_from: fact.validFrom,
      valid_to: fact.validTo,
    },
    { onConflict: "city,fact_kind,subject_key,valid_from" },
  );
  if (error) {
    throw new Error(`city_facts upsert failed: ${error.message}`);
  }
}

/**
 * The ferry timetable governing `date`, or **null** — which is not an error
 * and is the whole point of the seasonal columns.
 *
 * Golden Day 7's trap list: *"WINTER = Ward's route ONLY — Hanlan's runs
 * mid-Apr–mid-Oct, so this day is SEASONALLY INVALID Nov–Mar on the ferry
 * itself, not just the beach."* A null here means the route does not run,
 * which makes the experience theme INFEASIBLE. The caller must fail honestly;
 * composing the day without the boat would be the silent fallback constraint
 * 4 forbids.
 */
export async function readFerryTimetable(
  client: SupabaseClient,
  city: string,
  routeKey: string,
  date: string,
): Promise<CityFact<FerryTimetable> | null> {
  const { data, error } = await client
    .from("city_facts")
    .select(COLUMNS)
    .eq("city", city)
    .eq("fact_kind", "ferry_timetable")
    .eq("subject_key", routeKey);
  if (error) {
    throw new Error(`city_facts read failed: ${error.message}`);
  }

  for (const raw of data ?? []) {
    const row = cityFactRowSchema.parse(raw);
    const season = { validFrom: row.valid_from, validTo: row.valid_to };
    if (!seasonCovers(season, date)) continue;
    // Parsed on the way OUT too: a row that drifted is a loud failure here
    // rather than an undefined `outbound` three layers downstream.
    const value = ferryTimetableSchema.parse(row.value);
    return {
      city: row.city,
      factKind: "ferry_timetable",
      subjectKey: row.subject_key,
      value,
      season,
      source: row.source,
      tier: TIER_VALUES.find((t) => t === row.tier)!,
      fetchedAt: row.fetched_at,
    };
  }
  return null;
}
