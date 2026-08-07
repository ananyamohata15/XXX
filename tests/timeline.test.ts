import { describe, expect, it } from "vitest";
import { torontoDay } from "@/shared/fixtures/toronto-day";
import {
  fixtureDaySchema,
  lookupTravel,
  minutesToTime,
  reflowDay,
  timeToMinutes,
  travelKey,
  type SlotView,
  type TravelMatrix,
} from "@/shared/timeline";
import { TIERS } from "@/shared/vocabulary";

/**
 * Honest tests only (XXX-18/XXX-19): the fixture's shape and the pure
 * reflow logic. Gesture feel was judged at the CHECKPOINT 3 kill-gate on
 * real hardware and is not pretended into unit tests.
 */

describe("fixture: the Toronto day (XXX-18)", () => {
  it("parses through the fixture schema", () => {
    expect(fixtureDaySchema.safeParse(torontoDay).success).toBe(true);
  });

  it("has exactly one anchor, and it is the last slot", () => {
    const anchors = torontoDay.slots.filter((s) => s.origin === "user");
    expect(anchors).toHaveLength(1);
    expect(torontoDay.slots[torontoDay.slots.length - 1].origin).toBe("user");
  });

  it("covers every consecutive main-slot pair in the travel matrix", () => {
    // The default day must never show "Travel not computed".
    for (let i = 0; i < torontoDay.slots.length - 1; i++) {
      const leg = lookupTravel(
        torontoDay.travel,
        torontoDay.slots[i].placeId,
        torontoDay.slots[i + 1].placeId,
      );
      expect(leg, `missing leg after slot ${torontoDay.slots[i].id}`).not.toBeNull();
    }
  });

  it("rejects an anchor that carries concierge judgment", () => {
    const bad = structuredClone(torontoDay);
    bad.slots[bad.slots.length - 1].reason = {
      text: "should not be here",
      source: "concierge",
      tier: TIERS.judgment,
    };
    expect(fixtureDaySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a concierge slot with no reason", () => {
    const bad = structuredClone(torontoDay);
    bad.slots[0].reason = null;
    expect(fixtureDaySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects overlapping slots", () => {
    const bad = structuredClone(torontoDay);
    bad.slots[1].startTime = "09:00"; // brunch runs until 09:45
    expect(fixtureDaySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a travel key that does not join two known places", () => {
    const bad = structuredClone(torontoDay);
    bad.travel[travelKey("mildreds", "nowhere")] = {
      mode: "walk",
      minutes: 5,
    };
    expect(fixtureDaySchema.safeParse(bad).success).toBe(false);
  });
});

describe("time helpers", () => {
  it("round-trips HH:MM through minutes", () => {
    for (const t of ["00:00", "08:30", "12:05", "23:59"]) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });

  it("travelKey is symmetric and lookupTravel honors it", () => {
    expect(travelKey("b", "a")).toBe(travelKey("a", "b"));
    const matrix: TravelMatrix = {
      [travelKey("a", "b")]: { mode: "walk", minutes: 7 },
    };
    expect(lookupTravel(matrix, "b", "a")).toEqual({ mode: "walk", minutes: 7 });
    expect(lookupTravel(matrix, "a", "c")).toBeNull();
  });
});

const slot = (
  id: string,
  origin: "concierge" | "user",
  startTime: string,
  endTime: string,
  placeId: string,
): SlotView => ({
  id,
  origin,
  kind: "activity",
  startTime,
  endTime,
  placeId,
  reason:
    origin === "concierge"
      ? { text: "because", source: "concierge", tier: TIERS.judgment }
      : null,
  alternates: [],
});

describe("reflowDay (the pure fake logic standing in for E5)", () => {
  it("reproduces a tight forward layout in the default order", () => {
    const result = reflowDay(torontoDay.slots, torontoDay.travel, torontoDay.dayStart);
    // Order unchanged — the authored day has air everywhere, nothing slides.
    expect(result.slots.map((s) => s.slotId)).toEqual(
      torontoDay.slots.map((s) => s.id),
    );
    // First slot opens the day; durations are preserved everywhere.
    expect(result.slots[0].startTime).toBe(torontoDay.dayStart);
    result.slots.forEach((r, i) => {
      const original = torontoDay.slots[i];
      expect(
        timeToMinutes(r.endTime) - timeToMinutes(r.startTime),
        `duration of ${r.slotId}`,
      ).toBe(
        timeToMinutes(original.endTime) - timeToMinutes(original.startTime),
      );
    });
    // The anchor's own times are untouchable.
    const anchor = result.slots[result.slots.length - 1];
    expect(anchor.startTime).toBe("19:00");
    expect(anchor.endTime).toBe("21:00");
    expect(result.anchorOverrunMinutes).toBe(0);
    // Non-anchor starts land on the 5-minute grid.
    for (const r of result.slots.slice(0, -1)) {
      expect(timeToMinutes(r.startTime) % 5, `grid for ${r.slotId}`).toBe(0);
    }
  });

  it("recomputes times for a reorder, preserving durations", () => {
    const reordered = [...torontoDay.slots];
    [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
    const result = reflowDay(reordered, torontoDay.travel, torontoDay.dayStart);
    expect(result.slots.map((s) => s.slotId)).toEqual(reordered.map((s) => s.id));
    result.slots.forEach((r, i) => {
      const original = reordered[i];
      expect(timeToMinutes(r.endTime) - timeToMinutes(r.startTime)).toBe(
        timeToMinutes(original.endTime) - timeToMinutes(original.startTime),
      );
    });
  });

  it("slides a slot that would collide with the anchor past it", () => {
    const a = slot("a", "concierge", "09:00", "11:30", "pa");
    const b = slot("b", "concierge", "09:00", "10:00", "pb"); // 60 min
    const anchor = slot("anchor", "user", "12:00", "13:00", "px");
    const result = reflowDay([a, b, anchor], {}, "09:00");
    // b would run 11:30–12:30, crossing the anchor's 12:00 — it slides past.
    expect(result.slots.map((s) => s.slotId)).toEqual(["a", "anchor", "b"]);
    expect(result.slots[2].startTime).toBe("13:00");
    expect(result.slots[2].endTime).toBe("14:00");
    expect(result.anchorOverrunMinutes).toBe(0);
  });

  it("reports a late arrival at the anchor instead of moving it", () => {
    const a = slot("a", "concierge", "09:00", "11:55", "pa");
    const anchor = slot("anchor", "user", "12:00", "13:00", "px");
    const travel: TravelMatrix = {
      [travelKey("pa", "px")]: { mode: "transit", minutes: 20 },
    };
    const result = reflowDay([a, anchor], travel, "09:00");
    expect(result.slots[1].startTime).toBe("12:00"); // anchor did not move
    expect(result.anchorOverrunMinutes).toBe(15); // 11:55 + 20 = 12:15
  });

  it("treats unknown travel as honest absence: null leg, no invented minutes", () => {
    const a = slot("a", "concierge", "09:00", "10:00", "pa");
    const b = slot("b", "concierge", "10:00", "11:00", "pb");
    const result = reflowDay([a, b], {}, "09:00");
    expect(result.legs).toEqual([null]);
    // b starts the moment a ends — no guessed travel padding.
    expect(result.slots[1].startTime).toBe("10:00");
  });
});
