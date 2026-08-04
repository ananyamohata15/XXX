import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  createDay,
  createFact,
  createPlace,
  createSlot,
  createTrip,
  getDayWithSlots,
  getPlaceWithFacts,
} from "@/server/domain/repo";

/**
 * Live verification against the real (production) database — CLAUDE.md
 * constraint 7: the fake client structurally cannot prove a DB constraint.
 * Runs only when LIVE_KEYS points at a Supabase api-keys JSON file
 * (`npx supabase projects api-keys -o json`); skipped everywhere else,
 * including CI. Results are recorded in SESSION_NOTES.md.
 */
const keysPath = process.env.LIVE_KEYS;

describe.runIf(!!keysPath)("live: core domain schema (XXX-15)", () => {
  const keys = keysPath
    ? (JSON.parse(readFileSync(keysPath, "utf8")) as {
        name: string;
        api_key: string;
      }[])
    : [];
  const serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
  if (keysPath && !serviceKey) throw new Error("service_role key not found");
  const client = createClient(
    "https://epruyruabdcciergbmcp.supabase.co",
    serviceKey ?? "unused",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  it("DB rejects a fact inserted without source (provenance NOT NULL)", async () => {
    // Deliberately bypasses the typed layer — that is the point: the types
    // forbid this shape, and the database must forbid it independently.
    const { error } = await client.from("facts").insert({
      place_id: "00000000-0000-4000-8000-000000000000",
      fact_key: "vibe",
      status: "present",
      value: "should never land",
      tier: 3,
      fetched_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/source/);
    expect(error?.message).toMatch(/not-null/);
    console.log(
      `provenance violation error: code=${error?.code} message=${error?.message}`,
    );
  });

  it("DB rejects a present fact with a null value (facts_value_matches_status)", async () => {
    // The CHECK strengthened at Checkpoint 2. PostgREST maps a JSON null to
    // SQL NULL for jsonb columns, so this exercises the `value is not null`
    // arm; the literal 'null'::jsonb (jsonb_typeof) arm cannot be expressed
    // through PostgREST and is proven once via direct SQL — see
    // SESSION_NOTES for both verbatim errors.
    const { error } = await client.from("facts").insert({
      place_id: "00000000-0000-4000-8000-000000000000",
      fact_key: "vibe",
      status: "present",
      value: null,
      source: "fixture_seed",
      tier: 3,
      fetched_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/facts_value_matches_status/);
    console.log(
      `check violation error: code=${error?.code} message=${error?.message}`,
    );
  });

  it("loads and reads back the minimal fixture through the typed layer", async () => {
    const existing = await client
      .from("places")
      .select("id")
      .eq("name", "Allan Gardens Conservatory")
      .eq("city", "toronto");
    if ((existing.data ?? []).length > 0) {
      console.log(
        `fixture already present (place ${existing.data![0].id}); not re-inserting`,
      );
      return;
    }

    const email = "fixture-user@projectxxx.example";
    const created = await client.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    let userId = created.data.user?.id;
    if (!userId) {
      const list = await client.auth.admin.listUsers();
      userId = list.data.users.find((u) => u.email === email)?.id;
    }
    if (!userId) throw new Error("could not create or find fixture user");

    const fetchedAt = new Date().toISOString();
    // Placeholder values; source is honestly 'fixture_seed' — tiers here
    // exercise the constraint, they do not claim real verification.
    const place = await createPlace(client, {
      city: "toronto",
      name: "Allan Gardens Conservatory",
      lat: 43.6612,
      lng: -79.3744,
      address: "160 Gerrard St E, Toronto, ON",
      googlePlaceId: null,
      source: "fixture_seed",
      tier: 2,
      fetchedAt,
    });

    const factInputs = [
      { factKey: "website", tier: 1, value: "https://example.org/allan-gardens" },
      { factKey: "price_range", tier: 2, value: { min: 0, max: 0, currency: "CAD" } },
      { factKey: "vibe", tier: 3, value: "Quiet glasshouse calm; best before noon." },
    ] as const;
    for (const f of factInputs) {
      await createFact(client, {
        placeId: place.id,
        factKey: f.factKey,
        status: "present",
        value: f.value,
        source: "fixture_seed",
        tier: f.tier,
        fetchedAt,
      });
    }

    const trip = await createTrip(client, {
      userId,
      city: "toronto",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      partySize: 2,
      transportModes: ["walk", "transit"],
      budget: { min: 100, max: 250, currency: "CAD" },
    });
    const day = await createDay(client, {
      tripId: trip.id,
      date: "2026-08-10",
      traceId: null,
    });
    await createSlot(client, {
      dayId: day.id,
      origin: "concierge",
      kind: "activity",
      startTime: "10:00",
      endTime: "12:00",
      placeId: place.id,
      reason: null,
    });
    await createSlot(client, {
      dayId: day.id,
      origin: "concierge",
      kind: "meal",
      startTime: "12:30",
      endTime: "13:30",
      placeId: place.id,
      reason: {
        text: "Close by and calm after the conservatory.",
        source: "fixture_seed",
        createdAt: fetchedAt,
      },
    });

    const readBack = await getDayWithSlots(client, day.id);
    expect(readBack.slots.map((s) => s.start_time)).toEqual([
      "10:00:00",
      "12:30:00",
    ]);
    expect(readBack.slots[1].reason_tier).toBe(3);

    const placeBack = await getPlaceWithFacts(client, place.id);
    expect(placeBack.facts.map((f) => f.tier).sort()).toEqual([1, 2, 3]);

    console.log(
      `fixture ids: place=${place.id} trip=${trip.id} day=${day.id} user=${userId}`,
    );
  });
});
