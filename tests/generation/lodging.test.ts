/**
 * Lodging topology and the rest stop (XXX-42, Session 14).
 *
 * The honest-absence arm is the one that must never break: a trip with no
 * lodging behaves EXACTLY as it did before this session, and says so on the
 * page rather than defaulting to downtown.
 */

import { describe, expect, it } from "vitest";
import { buildSkeleton, composeDay } from "@/server/generation/compose";
import { COMPOSE_PARAMS } from "@/server/generation/compose-params";
import type {
  Candidate,
  GenerationRequest,
  Selection,
} from "@/server/generation/types";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { timeToMinutes } from "@/shared/time";
import { isOutdoorCategory, type PlaceCategory } from "@/shared/vocabulary";

const SAT = "2026-08-15";
const DOWNTOWN = { lat: 43.6517, lng: -79.3817 };

const candidate = (
  id: string,
  category: PlaceCategory,
  lat: number,
  lng: number,
): Candidate => ({
  place: {
    id,
    name: id,
    neighborhood: "Downtown",
    coords: { lat, lng },
    tags: {
      outdoor: isOutdoorCategory(category),
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
  },
  category,
  googlePlaceId: null,
  rating: 4.2,
  userRatingCount: 400,
  detailsFetched: true,
  score: 0.8,
});

const request = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  city: "toronto",
  date: SAT,
  persona: GOLDEN_PERSONAS["day-2-old-town"],
  budgetBand: null,
  transport: ["walk", "transit"],
  seed: 42,
  ...over,
});

/** Seat every intent from a pool wide enough to fill them. */
function compose(req: GenerationRequest) {
  const skeleton = buildSkeleton(req, { seed: 42 });
  const byId = new Map<string, Candidate>();
  const selections: Selection[] = [];
  skeleton.intents.forEach((intent, i) => {
    // Spread the venues out so the legs cost real minutes.
    const c = candidate(
      `p${i}`,
      intent.categories[0],
      43.64 + i * 0.02,
      -79.38 - i * 0.02,
    );
    byId.set(c.place.id, c);
    selections.push({ intentId: intent.id, placeId: c.place.id });
  });
  return composeDay({
    request: req,
    skeleton,
    selections,
    candidatesById: byId,
    travel: new HaversineStubProvider(),
    outdoorLatestEnd: timeToMinutes("20:30"),
  });
}

describe("lodging is a place, so the day's first movement is real", () => {
  it("records the leg from lodging to the first stop", () => {
    const composed = compose(request({ lodging: DOWNTOWN }));
    const first = composed.legs[0];
    expect(first).toBeDefined();
    // It used to be priced and thrown away — recordLeg needed a prevPlaceId
    // and lodging had none, so the day's longest movement was invisible.
    expect(first.fromPlaceId).toBe("lodging");
    expect(composed.day.places.lodging).toBeDefined();
  });

  it("adds NOTHING when lodging is unknown — honest absence", () => {
    const composed = compose(request());
    expect(composed.day.places.lodging).toBeUndefined();
    expect(composed.legs.some((l) => l.fromPlaceId === "lodging")).toBe(false);
    expect(composed.restReason).toBeNull();
    expect(composed.day.slots.some((s) => s.role === "rest")).toBe(false);
  });
});

/**
 * These tests CONSTRUCT days that trigger each arm.
 *
 * The first draft did not, and every one of them passed anyway on an early
 * return. Measured against the real pool afterwards, the mechanism fired
 * **zero** times across all eight exam personas — so five green tests were
 * evidence of nothing. A test that guards its own assertion away is a test
 * that has stopped asking.
 */
describe("the rest stop fires on load, and says why", () => {
  /** Venues far enough apart that the legs are real travel. */
  function heavyDay(over: Partial<GenerationRequest> = {}) {
    const req = request({ lodging: DOWNTOWN, ...over });
    const skeleton = buildSkeleton(req, { seed: 42 });
    const byId = new Map<string, Candidate>();
    const selections: Selection[] = [];
    skeleton.intents.forEach((intent, i) => {
      // ~8 km apart: every hop is a substantial transit leg.
      const c = candidate(
        `p${i}`,
        intent.categories[0],
        43.62 + (i % 2) * 0.08,
        -79.32 - (i % 2) * 0.1,
      );
      byId.set(c.place.id, c);
      selections.push({ intentId: intent.id, placeId: c.place.id });
    });
    return composeDay({
      request: req,
      skeleton,
      selections,
      candidatesById: byId,
      travel: new HaversineStubProvider(),
      outdoorLatestEnd: timeToMinutes("20:30"),
    });
  }

  it("deals a rest stop at the hotel when the day is heavy", () => {
    const composed = heavyDay();
    const load = composed.legs.reduce((m, l) => m + l.minutes, 0);
    // The premise, asserted rather than assumed — if the fixture stops being
    // a heavy day this fails here instead of passing silently below.
    expect(load).toBeGreaterThanOrEqual(
      COMPOSE_PARAMS.rest.physicalLoadMinutes,
    );

    const rest = composed.day.slots.find((s) => s.role === "rest");
    expect(rest, "no rest stop on a heavy day with lodging").toBeDefined();
    expect(rest!.placeId).toBe("lodging");
    expect(composed.restReason).not.toBeNull();
    expect(composed.restReason!.trigger).toBe("physical-load");
  });

  it("puts it in the afternoon, next to the evening it prepares for", () => {
    // Load is a WHOLE-DAY fact and the afternoon decides placement — golden
    // Day 2's own reset is 17:00-19:00. Accumulating load to the gap instead
    // is what fired zero times: the big gaps sit early, before the walking.
    const rest = heavyDay().day.slots.find((s) => s.role === "rest");
    expect(rest).toBeDefined();
    expect(rest!.startTime >= COMPOSE_PARAMS.rest.fromHour).toBe(true);
  });

  it("never displaces a stop — it only uses a gap that already exists", () => {
    const composed = heavyDay();
    const rest = composed.day.slots.find((s) => s.role === "rest")!;
    const restStart = timeToMinutes(rest.startTime);
    const restEnd = timeToMinutes(rest.endTime);
    for (const slot of composed.day.slots.filter((s) => s.role !== "rest")) {
      const overlaps =
        timeToMinutes(slot.startTime) < restEnd &&
        restStart < timeToMinutes(slot.endTime);
      expect(overlaps, `${slot.id} overlaps the rest stop`).toBe(false);
    }
  });

  it("stops narrating that stretch as free time once it is a stop", () => {
    const composed = heavyDay();
    const rest = composed.day.slots.find((s) => s.role === "rest")!;
    const restStart = timeToMinutes(rest.startTime);
    const restEnd = timeToMinutes(rest.endTime);
    for (const period of composed.openPeriods) {
      const overlaps =
        timeToMinutes(period.startTime) < restEnd &&
        restStart < timeToMinutes(period.endTime);
      expect(overlaps, "a rest stop is still being called free time").toBe(
        false,
      );
    }
  });

  it("deals NOTHING on the same heavy day when lodging is unknown", () => {
    // The Session 11 advisory keeps speaking instead — this upgrades it, it
    // does not replace it.
    const composed = heavyDay({ lodging: null });
    expect(composed.day.slots.some((s) => s.role === "rest")).toBe(false);
    expect(composed.restReason).toBeNull();
  });
});
