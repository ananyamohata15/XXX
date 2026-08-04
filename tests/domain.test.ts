import { describe, expect, it } from "vitest";
import {
  newFactSchema,
  newTripSchema,
  type NewFact,
  type NewTrip,
} from "@/server/domain/schemas";
import {
  createFact,
  createSlot,
  createTrip,
  getDayWithSlots,
} from "@/server/domain/repo";
import { createFakeSupabase } from "./fixtures/fake-supabase";

const PLACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const DAY_ID = "33333333-3333-4333-8333-333333333333";
const FETCHED_AT = "2026-08-03T12:00:00Z";

const presentFact: NewFact = {
  placeId: PLACE_ID,
  factKey: "price_range",
  status: "present",
  value: { min: 10, max: 25, currency: "CAD" },
  source: "founder_groundtruth",
  tier: 2,
  fetchedAt: FETCHED_AT,
};

describe("provenance guard (XXX-15)", () => {
  it("rejects a fact missing provenance in the type system", () => {
    // Compile-time arm of the guard: omitting any provenance field is a type
    // error before it is a runtime error. (The DB NOT NULL arm is proven
    // against the real database once — see SESSION_NOTES.)
    // @ts-expect-error source is required
    const noSource: NewFact = { ...presentFact, source: undefined };
    // @ts-expect-error tier is required
    const noTier: NewFact = { ...presentFact, tier: undefined };
    // @ts-expect-error fetchedAt is required
    const noFetchedAt: NewFact = { ...presentFact, fetchedAt: undefined };
    void [noSource, noTier, noFetchedAt];
  });

  it.each(["source", "tier", "fetchedAt"] as const)(
    "rejects a fact missing %s at runtime",
    (field) => {
      const bad = { ...presentFact, [field]: undefined };
      const { client } = createFakeSupabase();
      expect(() => createFact(client, bad as NewFact)).toThrow();
      expect(newFactSchema.safeParse(bad).success).toBe(false);
    },
  );

  it("rejects tier values outside 1|2|3", () => {
    expect(
      newFactSchema.safeParse({ ...presentFact, tier: 4 }).success,
    ).toBe(false);
  });
});

describe("facts: honest absence", () => {
  it("accepts an absent fact (looked, not published) with full provenance", async () => {
    const fake = createFakeSupabase();
    await createFact(fake.client, {
      placeId: PLACE_ID,
      factKey: "website",
      status: "absent",
      source: "google_places",
      tier: 1,
      fetchedAt: FETCHED_AT,
    });
    expect(fake.inserts).toEqual([
      {
        table: "facts",
        row: {
          place_id: PLACE_ID,
          fact_key: "website",
          status: "absent",
          value: null,
          source: "google_places",
          tier: 1,
          fetched_at: FETCHED_AT,
        },
      },
    ]);
  });

  it("rejects a present fact whose value is null", () => {
    expect(
      newFactSchema.safeParse({ ...presentFact, value: null }).success,
    ).toBe(false);
  });

  it("rejects an absent fact that smuggles a value", () => {
    expect(
      newFactSchema.safeParse({
        ...presentFact,
        status: "absent",
      }).success,
    ).toBe(false);
  });

  it("rejects a value that does not match its fact-key schema", () => {
    expect(
      newFactSchema.safeParse({
        ...presentFact,
        value: { min: 10, max: 25 }, // currency missing
      }).success,
    ).toBe(false);
  });

  it("rejects an unregistered fact key", () => {
    expect(
      newFactSchema.safeParse({ ...presentFact, factKey: "rating" }).success,
    ).toBe(false);
  });
});

describe("trips: circumstances only, honest budget absence", () => {
  const trip: NewTrip = {
    userId: USER_ID,
    city: "toronto",
    startDate: "2026-08-10",
    endDate: "2026-08-12",
    partySize: 2,
    transportModes: ["walk", "transit"],
    budget: { min: 100, max: 250, currency: "CAD" },
  };

  it("maps a budget range onto the column trio", async () => {
    const fake = createFakeSupabase();
    await createTrip(fake.client, trip);
    expect(fake.inserts[0].row).toMatchObject({
      budget_min: 100,
      budget_max: 250,
      budget_currency: "CAD",
    });
  });

  it("requires declining a budget to be explicit (null), not an omission", async () => {
    // @ts-expect-error budget must be stated, even as null
    const omitted: NewTrip = { ...trip, budget: undefined };
    expect(newTripSchema.safeParse(omitted).success).toBe(false);

    const fake = createFakeSupabase();
    await createTrip(fake.client, { ...trip, budget: null });
    expect(fake.inserts[0].row).toMatchObject({
      budget_min: null,
      budget_max: null,
      budget_currency: null,
    });
  });

  it.each([
    ["inverted budget", { ...trip, budget: { min: 5, max: 1, currency: "CAD" } }],
    ["empty transport modes", { ...trip, transportModes: [] }],
    ["inverted dates", { ...trip, startDate: "2026-08-13" }],
    ["zero party", { ...trip, partySize: 0 }],
  ])("rejects %s", (_label, bad) => {
    expect(newTripSchema.safeParse(bad).success).toBe(false);
  });
});

describe("slots: times own ordering, reason is pinned Tier 3", () => {
  const slot = {
    dayId: DAY_ID,
    origin: "concierge",
    kind: "activity",
    startTime: "10:00",
    endTime: "12:00",
    placeId: PLACE_ID,
    reason: null,
  } as const;

  it("writes all four reason columns null when no judgment is recorded", async () => {
    const fake = createFakeSupabase();
    await createSlot(fake.client, slot);
    expect(fake.inserts[0].row).toMatchObject({
      reason_text: null,
      reason_source: null,
      reason_tier: null,
      reason_created_at: null,
    });
  });

  it("pins reason_tier to 3 — callers cannot claim otherwise", async () => {
    const fake = createFakeSupabase();
    await createSlot(fake.client, {
      ...slot,
      reason: {
        text: "Quiet before the lunch rush.",
        source: "founder_groundtruth",
        createdAt: FETCHED_AT,
      },
    });
    expect(fake.inserts[0].row).toMatchObject({ reason_tier: 3 });
  });

  it("rejects a slot that ends before it starts", () => {
    const fake = createFakeSupabase();
    expect(() =>
      createSlot(fake.client, { ...slot, endTime: "09:00" }),
    ).toThrow();
  });
});

describe("reads for the fixture day", () => {
  it("returns a day with slots ordered by start_time", async () => {
    const day = { id: DAY_ID, trip_id: "t", date: "2026-08-10" };
    const later = { id: "s2", day_id: DAY_ID, start_time: "12:30:00" };
    const earlier = { id: "s1", day_id: DAY_ID, start_time: "10:00:00" };
    const fake = createFakeSupabase({
      rows: { days: [day], slots: [later, earlier] },
    });
    const result = await getDayWithSlots(fake.client, DAY_ID);
    expect(result.day.id).toBe(DAY_ID);
    expect(result.slots.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});
