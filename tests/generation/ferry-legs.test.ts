import { describe, expect, it } from "vitest";
import {
  annotateFerryLegs,
  lastDepartureOf,
  type AnnotatableSlot,
} from "@/server/generation/ferry-legs";
import type { FerryTimetable } from "@/shared/city-facts";
import type { ComposedLeg } from "@/server/generation/types";

const TIMETABLE: FerryTimetable = {
  routeKey: "ferry:hanlans",
  label: "Jack Layton Ferry Terminal ⇄ Hanlan's Point",
  crossingMinutes: 15,
  outbound: ["11:15", "13:00", "15:30"],
  inbound: ["12:00", "18:45", "22:15"],
};

const leg = (from: string, to: string): ComposedLeg => ({
  fromPlaceId: from,
  toPlaceId: to,
  minutes: 13,
  mode: "transit",
  source: "google_routes",
  tier: 2,
  exposureSwap: null,
});

/** mainland brunch → the island block → mainland dinner. */
const SLOTS: AnnotatableSlot[] = [
  { id: "s1", placeId: "brunch", startTime: "10:00" },
  {
    id: "s2",
    placeId: "hanlans",
    startTime: "13:20",
    compositeDwell: { min: 240, max: 330 },
  },
  { id: "s3", placeId: "dinner", startTime: "19:30" },
];

const LEGS = [leg("brunch", "hanlans"), leg("hanlans", "dinner")];

describe("annotateFerryLegs", () => {
  it("FIRES: names both crossings of an island day", () => {
    const out = annotateFerryLegs(LEGS, SLOTS, TIMETABLE);
    expect(out[0]!.via?.kind).toBe("ferry");
    expect(out[0]!.via?.label).toBe(TIMETABLE.label);
    expect(out[1]!.via?.kind).toBe("ferry");
  });

  it("carries the last boat — the fact the day hangs on", () => {
    const out = annotateFerryLegs(LEGS, SLOTS, TIMETABLE);
    expect(out[0]!.via?.lastDeparture).toBe("22:15");
  });

  it("does not touch a leg that is not a crossing", () => {
    const withMainland = [...LEGS, leg("dinner", "hotel")];
    const out = annotateFerryLegs(withMainland, SLOTS, TIMETABLE);
    expect(out[2]!.via).toBeUndefined();
  });

  it("leaves an ordinary day completely untouched", () => {
    // No composite block = no crossing. The overwhelmingly common case, and
    // it must cost nothing.
    const plain: AnnotatableSlot[] = [
      { id: "s1", placeId: "brunch", startTime: "10:00" },
      { id: "s2", placeId: "dinner", startTime: "19:30" },
    ];
    const out = annotateFerryLegs(LEGS, plain, TIMETABLE);
    expect(out.every((l) => l.via === undefined)).toBe(true);
  });

  it("claims nothing when there is no timetable", () => {
    const out = annotateFerryLegs(LEGS, SLOTS, null);
    expect(out.every((l) => l.via === undefined)).toBe(true);
  });

  it("does not mutate the legs it was given", () => {
    const input = [leg("brunch", "hanlans")];
    annotateFerryLegs(input, SLOTS, TIMETABLE);
    expect(input[0]!.via).toBeUndefined();
  });

  it("orders slots by time, not by array order", () => {
    const shuffled = [SLOTS[2]!, SLOTS[0]!, SLOTS[1]!];
    const out = annotateFerryLegs(LEGS, shuffled, TIMETABLE);
    expect(out[0]!.via?.kind).toBe("ferry");
    expect(out[1]!.via?.kind).toBe("ferry");
  });
});

describe("lastDepartureOf", () => {
  it("takes the latest across both directions", () => {
    expect(lastDepartureOf(TIMETABLE)).toBe("22:15");
  });

  it("says nothing rather than guessing when the timetable is empty", () => {
    // A pill claiming a last boat we do not know is worse than one that
    // omits it, because the traveller would plan around it.
    expect(
      lastDepartureOf({ ...TIMETABLE, outbound: [], inbound: [] }),
    ).toBeNull();
  });
});
