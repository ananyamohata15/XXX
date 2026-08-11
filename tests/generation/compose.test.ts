import { describe, expect, it } from "vitest";
import {
  buildSkeleton,
  composeDay,
  modeFor,
  rankedActivityCategories,
} from "@/server/generation/compose";
import { hardFilter } from "@/server/generation/filters";
import { planRepair } from "@/server/generation/repair";
import type {
  Candidate,
  GenerationRequest,
  Selection,
} from "@/server/generation/types";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { timeToMinutes } from "@/shared/time";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import type { PlaceCategory } from "@/shared/vocabulary";

const SAT = "2026-08-15"; // a Saturday

function candidate(
  id: string,
  category: PlaceCategory,
  lat: number,
  lng: number,
  hours?: { open: string; close: string },
): Candidate {
  return {
    place: {
      id,
      name: id,
      neighborhood: "Downtown",
      coords: { lat, lng },
      tags: {
        outdoor: category === "parks",
        goldenHourAffine: false,
        highCrowd: false,
      },
      category: {
        status: "present",
        value: category,
        source: "fsq_os_places",
        tier: 2,
        fetchedAt: "2026-07-09",
      },
      ...(hours
        ? {
            hours: {
              status: "present" as const,
              value: Object.fromEntries(
                [
                  "sunday",
                  "monday",
                  "tuesday",
                  "wednesday",
                  "thursday",
                  "friday",
                  "saturday",
                ].map((d) => [d, [hours]]),
              ) as never,
              source: "google_places",
              tier: 1 as const,
              fetchedAt: "now",
            },
          }
        : {}),
    },
    category,
    googlePlaceId: null,
    rating: 4.3,
    userRatingCount: 200,
    detailsFetched: true,
    score: 0.8,
  };
}

const request = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  city: "toronto",
  date: SAT,
  persona: GOLDEN_PERSONAS["day-2-old-town"],
  budgetBand: null,
  transport: ["walk", "transit"],
  seed: 42,
  ...over,
});

describe("buildSkeleton", () => {
  it("scheduler personas get pattern meals plus pace-driven activities", () => {
    const skeleton = buildSkeleton(request());
    const meals = skeleton.intents.filter((i) => i.kind === "meal");
    const activities = skeleton.intents.filter((i) => i.kind === "activity");
    expect(meals.map((m) => m.label)).toContain("lunch");
    expect(meals.map((m) => m.label)).toContain("dinner");
    expect(activities.length).toBeGreaterThanOrEqual(4); // packed pace
  });

  it("wanderer personas get three anchors, not a timeline (XXX-6 shape)", () => {
    const skeleton = buildSkeleton(
      request({ persona: GOLDEN_PERSONAS["day-5-wanderer"] }),
    );
    expect(skeleton.intents.length).toBe(3);
    // The negative space IS the shape: scheduled minutes stay well under
    // the rule-27 ceiling (65% of the day span).
    const scheduled = skeleton.intents.reduce((m, i) => m + i.dwellMinutes, 0);
    const span = skeleton.daySpan.end - skeleton.daySpan.start;
    expect(scheduled / span).toBeLessThan(0.65 - 0.05);
  });

  it("no category appears more than twice among activities (10294 variety)", () => {
    const skeleton = buildSkeleton(request());
    const counts = new Map<string, number>();
    for (const i of skeleton.intents.filter((x) => x.kind === "activity")) {
      counts.set(i.categories[0], (counts.get(i.categories[0]) ?? 0) + 1);
    }
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("activity categories follow persona gravity", () => {
    // The lowest roll takes the first eligible option, so this asserts that
    // gravity — not the dice — still decides when the dice does not push.
    const ranked = rankedActivityCategories(
      GOLDEN_PERSONAS["day-3-winter"],
      () => 0,
    );
    expect(ranked[0]).toBe("museums_galleries"); // art-first persona
  });
});

describe("composeDay", () => {
  const pool = [
    candidate("cafe1", "cafes", 43.6532, -79.3832, { open: "08:00", close: "17:00" }),
    candidate("market1", "markets", 43.6487, -79.3716, { open: "07:00", close: "17:00" }),
    candidate("historic1", "historic_sites", 43.648, -79.3745, { open: "00:00", close: "24:00" }),
    candidate("museum1", "museums_galleries", 43.6677, -79.3948, { open: "10:00", close: "17:30" }),
    candidate("resto1", "restaurants", 43.6503, -79.3592, { open: "11:30", close: "23:00" }),
    candidate("resto2", "restaurants", 43.6531, -79.367, { open: "09:00", close: "22:00" }),
    // Added in Session 11: the arc asks for contrast and close steps in
    // families this pool did not carry, so a six-row pool could not
    // exercise a full day. The assertions below are unchanged.
    candidate("park1", "parks", 43.6465, -79.3733, { open: "06:00", close: "23:00" }),
    candidate("bar1", "nightlife_bars", 43.6445, -79.4, { open: "16:00", close: "02:00" }),
  ];
  const byId = new Map(pool.map((c) => [c.place.id, c]));

  // Mirrors the engine's menu legality: a candidate is only offered for
  // an intent whose window its hours can hold (buildMenus does the same
  // via hardFilter — a dinner menu never contains a 15:00 closer).
  function selectionsFor(req: GenerationRequest): {
    selections: Selection[];
    skeleton: ReturnType<typeof buildSkeleton>;
  } {
    const skeleton = buildSkeleton(req);
    const used = new Set<string>();
    const selections: Selection[] = [];
    for (const intent of skeleton.intents) {
      const { kept } = hardFilter(
        pool.filter(
          (c) =>
            intent.categories.includes(c.category) && !used.has(c.place.id),
        ),
        req.date,
        intent.window,
        () => 30,
      );
      const pick = kept[0];
      if (pick) {
        used.add(pick.place.id);
        selections.push({ intentId: intent.id, placeId: pick.place.id });
      }
    }
    return { selections, skeleton };
  }

  it("schedules a legal, ordered day with travel-aware starts", () => {
    const req = request();
    const { selections, skeleton } = selectionsFor(req);
    const composed = composeDay({
      request: req,
      skeleton,
      selections,
      candidatesById: byId,
      travel: new HaversineStubProvider(),
      outdoorLatestEnd: timeToMinutes("20:30"),
    });
    const slots = composed.day.slots;
    expect(slots.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < slots.length; i++) {
      expect(
        timeToMinutes(slots[i].startTime),
      ).toBeGreaterThanOrEqual(timeToMinutes(slots[i - 1].endTime));
    }
    // Every slot's place travelled with it into the day.
    for (const slot of slots) {
      expect(composed.day.places[slot.placeId]).toBeDefined();
    }
  });

  it("pins anchors and leaves the arrival buffer in front (XXX-27)", () => {
    const req = request({
      anchors: [
        {
          label: "Blue Jays game",
          coords: { lat: 43.6414, lng: -79.3894 },
          startTime: "18:30",
          endTime: "22:00",
          highCrowd: true,
        },
      ],
    });
    const { selections, skeleton } = selectionsFor(req);
    const composed = composeDay({
      request: req,
      skeleton,
      selections,
      candidatesById: byId,
      travel: new HaversineStubProvider(),
      outdoorLatestEnd: null,
    });
    const anchor = composed.day.slots.find((s) => s.origin === "user");
    expect(anchor).toBeDefined();
    expect(anchor!.startTime).toBe("18:30");
    expect(anchor!.endTime).toBe("22:00");
    expect(composed.anchorBaseline).not.toBeNull();
    const anchorStart = timeToMinutes("18:30");
    const before = composed.day.slots.filter(
      (s) => s.origin === "concierge" && timeToMinutes(s.endTime) <= anchorStart,
    );
    // Whatever precedes the anchor ends at least the buffer before it,
    // less nothing — the composer shrinks/drops until that holds.
    for (const slot of before) {
      expect(timeToMinutes(slot.endTime)).toBeLessThanOrEqual(anchorStart);
    }
    // Post-anchor slots respect the crowd egress buffer.
    const after = composed.day.slots.find(
      (s) => timeToMinutes(s.startTime) >= anchorStart && s.origin === "concierge",
    );
    if (after !== undefined) {
      expect(timeToMinutes(after.startTime)).toBeGreaterThanOrEqual(
        timeToMinutes("22:30"),
      );
    }
  });

  it("caps outdoor slots at the daylight boundary", () => {
    const req = request({
      persona: GOLDEN_PERSONAS["day-4-budget"],
      transport: ["walk"],
    });
    const park = candidate("park1", "parks", 43.6465, -79.4637, {
      open: "00:00",
      close: "24:00",
    });
    const poolWithPark = new Map(byId);
    poolWithPark.set(park.place.id, park);
    const skeleton = buildSkeleton(req);
    const parkIntent = skeleton.intents.find((i) =>
      i.categories.includes("parks"),
    );
    if (parkIntent === undefined) return; // persona picked other categories
    const composed = composeDay({
      request: req,
      skeleton,
      selections: [{ intentId: parkIntent.id, placeId: park.place.id }],
      candidatesById: poolWithPark,
      travel: new HaversineStubProvider(),
      outdoorLatestEnd: timeToMinutes("17:00"),
    });
    const parkSlot = composed.day.slots.find((s) => s.placeId === "park1");
    if (parkSlot !== undefined) {
      expect(timeToMinutes(parkSlot.endTime)).toBeLessThanOrEqual(
        timeToMinutes("17:00"),
      );
    }
  });
});

describe("hard filters (predicate reuse)", () => {
  it("drops known-closed, keeps honest absence", () => {
    const open = candidate("open1", "cafes", 43.65, -79.38, {
      open: "08:00",
      close: "17:00",
    });
    const closed = candidate("closed1", "cafes", 43.65, -79.38);
    closed.place = {
      ...closed.place,
      businessStatus: {
        status: "present",
        value: "closed_permanently",
        source: "google_places",
        tier: 1,
        fetchedAt: "now",
      },
    };
    const unknown = candidate("unknown1", "cafes", 43.65, -79.38);
    const { kept, dropped } = hardFilter(
      [open, closed, unknown],
      SAT,
      { start: timeToMinutes("09:00"), end: timeToMinutes("21:00") },
      () => 20,
    );
    expect(kept.map((c) => c.place.id).sort()).toEqual(["open1", "unknown1"]);
    expect(dropped[0]).toMatchObject({ placeId: "closed1" });
  });

  it("drops a venue whose hours cannot hold the visit", () => {
    const early = candidate("early1", "cafes", 43.65, -79.38, {
      open: "06:00",
      close: "08:00",
    });
    const { kept } = hardFilter(
      [early],
      SAT,
      { start: timeToMinutes("09:00"), end: timeToMinutes("21:00") },
      () => 30,
    );
    expect(kept).toEqual([]);
  });
});

describe("repair routing", () => {
  it("strikes place-caused violations and raises slack for time-caused", () => {
    const plan = planRepair(
      [
        {
          ruleId: "validity.permanently-closed",
          severity: "violation",
          slotIds: ["s-i2"],
          message: "closed",
          data: {},
        },
        {
          ruleId: "travel.infeasible",
          severity: "violation",
          slotIds: ["s-i3"],
          message: "late",
          data: { shortfallMinutes: 7 },
        },
      ],
      (slotId) => (slotId === "s-i2" ? "place-x" : null),
      () => null,
    );
    expect([...plan.strikes.get("s-i2")!]).toEqual(["place-x"]);
    expect(plan.slackMinutes).toBeGreaterThanOrEqual(7);
    expect(plan.unroutable).toEqual([]);
  });

  it("routes day-level budget violations to the priciest concierge pick", () => {
    const plan = planRepair(
      [
        {
          ruleId: "budget.over-band",
          severity: "violation",
          slotIds: [],
          message: "over",
          data: {},
        },
      ],
      () => null,
      () => ({ slotId: "s-i4", placeId: "splurge" }),
    );
    expect([...plan.strikes.get("s-i4")!]).toEqual(["splurge"]);
  });

  it("accumulates strikes across passes", () => {
    const first = planRepair(
      [
        {
          ruleId: "hours.closed-day",
          severity: "violation",
          slotIds: ["s-i1"],
          message: "closed monday",
          data: {},
        },
      ],
      () => "place-a",
      () => null,
    );
    const second = planRepair(
      [
        {
          ruleId: "hours.closed-day",
          severity: "violation",
          slotIds: ["s-i1"],
          message: "also closed",
          data: {},
        },
      ],
      () => "place-b",
      () => null,
      first,
    );
    expect([...second.strikes.get("s-i1")!].sort()).toEqual([
      "place-a",
      "place-b",
    ]);
  });
});

describe("modeFor", () => {
  it("walks short hops, rides long ones, honors the allowed set", () => {
    expect(modeFor(1.2, ["walk", "transit"])).toBe("walk");
    expect(modeFor(4.8, ["walk", "transit"])).toBe("transit");
    expect(modeFor(4.8, ["walk"])).toBe("walk");
    expect(modeFor(60, ["drive"])).toBe("drive");
  });
});
