import type { SupabaseClient } from "@supabase/supabase-js";
import {
  newDaySchema,
  newFactSchema,
  newPlaceSchema,
  newSlotSchema,
  newTripSchema,
  type NewDay,
  type NewFact,
  type NewPlace,
  type NewSlot,
  type NewTrip,
} from "./schemas";

/**
 * Repository functions for the core domain (XXX-15). Deliberately only what
 * XXX-18's fixture day needs: creates for the five entities, and the two
 * reads that prove a stored day round-trips. No speculative CRUD — updates,
 * deletes, upserts and slot_alternates arrive with the tickets that need
 * them (refresh upserts are E3).
 *
 * Every create parses its input with the Zod boundary schema first; rows the
 * schemas reject never reach the database.
 */

export interface PlaceRow {
  id: string;
  city: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  google_place_id: string | null;
  source: string;
  tier: number;
  fetched_at: string;
}

export interface FactRow {
  id: string;
  place_id: string;
  fact_key: string;
  status: "present" | "absent";
  value: unknown;
  source: string;
  tier: number;
  fetched_at: string;
}

export interface TripRow {
  id: string;
  user_id: string;
  city: string;
  start_date: string;
  end_date: string;
  party_size: number;
  transport_modes: string[];
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
}

export interface DayRow {
  id: string;
  trip_id: string;
  date: string;
  trace_id: string | null;
}

export interface SlotRow {
  id: string;
  day_id: string;
  origin: "concierge" | "user";
  kind: "meal" | "activity";
  start_time: string;
  end_time: string;
  place_id: string;
  reason_text: string | null;
  reason_source: string | null;
  reason_tier: number | null;
  reason_created_at: string | null;
}

async function insertReturning<Row>(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<Row> {
  const { data, error } = await client
    .from(table)
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  return data as Row;
}

export function createPlace(
  client: SupabaseClient,
  input: NewPlace,
): Promise<PlaceRow> {
  const p = newPlaceSchema.parse(input);
  return insertReturning<PlaceRow>(client, "places", {
    city: p.city,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    address: p.address,
    google_place_id: p.googlePlaceId,
    source: p.source,
    tier: p.tier,
    fetched_at: p.fetchedAt,
  });
}

export function createFact(
  client: SupabaseClient,
  input: NewFact,
): Promise<FactRow> {
  const f = newFactSchema.parse(input);
  return insertReturning<FactRow>(client, "facts", {
    place_id: f.placeId,
    fact_key: f.factKey,
    status: f.status,
    value: f.status === "present" ? f.value : null,
    source: f.source,
    tier: f.tier,
    fetched_at: f.fetchedAt,
  });
}

export function createTrip(
  client: SupabaseClient,
  input: NewTrip,
): Promise<TripRow> {
  const t = newTripSchema.parse(input);
  return insertReturning<TripRow>(client, "trips", {
    user_id: t.userId,
    city: t.city,
    start_date: t.startDate,
    end_date: t.endDate,
    party_size: t.partySize,
    transport_modes: t.transportModes,
    budget_min: t.budget?.min ?? null,
    budget_max: t.budget?.max ?? null,
    budget_currency: t.budget?.currency ?? null,
  });
}

export function createDay(
  client: SupabaseClient,
  input: NewDay,
): Promise<DayRow> {
  const d = newDaySchema.parse(input);
  return insertReturning<DayRow>(client, "days", {
    trip_id: d.tripId,
    date: d.date,
    trace_id: d.traceId,
  });
}

export function createSlot(
  client: SupabaseClient,
  input: NewSlot,
): Promise<SlotRow> {
  const s = newSlotSchema.parse(input);
  return insertReturning<SlotRow>(client, "slots", {
    day_id: s.dayId,
    origin: s.origin,
    kind: s.kind,
    start_time: s.startTime,
    end_time: s.endTime,
    place_id: s.placeId,
    reason_text: s.reason?.text ?? null,
    reason_source: s.reason?.source ?? null,
    // Judgment is definitionally Tier 3; callers cannot claim otherwise.
    reason_tier: s.reason ? 3 : null,
    reason_created_at: s.reason?.createdAt ?? null,
  });
}

/** A day with its slots in timeline order (ordering derives from start_time). */
export async function getDayWithSlots(
  client: SupabaseClient,
  dayId: string,
): Promise<{ day: DayRow; slots: SlotRow[] }> {
  const day = await client.from("days").select().eq("id", dayId).single();
  if (day.error) {
    throw new Error(`day ${dayId} not found: ${day.error.message}`);
  }
  const slots = await client
    .from("slots")
    .select()
    .eq("day_id", dayId)
    .order("start_time");
  if (slots.error) {
    throw new Error(`slots for day ${dayId} failed: ${slots.error.message}`);
  }
  return { day: day.data as DayRow, slots: (slots.data ?? []) as SlotRow[] };
}

/** A place with every current fact we hold for it, absence rows included. */
export async function getPlaceWithFacts(
  client: SupabaseClient,
  placeId: string,
): Promise<{ place: PlaceRow; facts: FactRow[] }> {
  const place = await client
    .from("places")
    .select()
    .eq("id", placeId)
    .single();
  if (place.error) {
    throw new Error(`place ${placeId} not found: ${place.error.message}`);
  }
  const facts = await client
    .from("facts")
    .select()
    .eq("place_id", placeId)
    .order("fact_key");
  if (facts.error) {
    throw new Error(
      `facts for place ${placeId} failed: ${facts.error.message}`,
    );
  }
  return {
    place: place.data as PlaceRow,
    facts: (facts.data ?? []) as FactRow[],
  };
}
