/**
 * THE DAY-7 SHAPE EXAM (XXX-38, Session 14 Step 2).
 *
 * Golden Day 7 — The Islands Day, founder-verified 2026-08-15 — is this
 * session's acceptance target. The AC is **shape and constraint compliance,
 * not venue-for-venue match**: given the islands persona, date and the
 * experience theme, the engine must produce an islands-SHAPED day.
 *
 * Each assertion below is one of the document's own "traps for a naive
 * generator", turned around. That is deliberate: the traps are the founder
 * saying what a wrong day looks like, and an exam written from them cannot
 * drift away from what he actually rejected.
 *
 * Runs against the SKELETON rather than a live pool. The composite block,
 * the provisioning stop and their causal order are all decided in
 * `buildSkeleton`, so a pool would add cost without adding evidence — and
 * the live confirm at Step 3 is where venue-level truth is bought.
 */

import { describe, expect, it } from "vitest";
import { buildSkeleton } from "@/server/generation/compose";
import type { GenerationRequest } from "@/server/generation/types";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import {
  lastDeparture,
  nextDeparture,
  seasonCovers,
} from "@/shared/city-facts";
import { FERRY_HANLANS_SUMMER_2026 } from "@/server/city-facts/ferry-seed";
import { experienceSpec, type DayTheme } from "@/shared/theme";
import { CATEGORY_FAMILY } from "@/shared/vocabulary";

/**
 * Golden Day 7's own persona line, verbatim from the document:
 * "pace=relaxed / interests=nature>food>local-life / food=adventurous /
 *  structure=scheduler-loose / corners".
 *
 * `scheduler-loose` lands on `scheduler` — the binary the codebase has —
 * and that choice is recorded rather than silent, as day-4's was.
 */
const ISLANDS_PERSONA = {
  pace: "relaxed" as const,
  gravity: ["nature", "food", "local_life"] as const,
  foodCourage: "adventurous" as const,
  structure: "scheduler" as const,
  lens: "corners" as const,
};

/** "mid-July Sat" — the document's own circumstance line. */
const JULY_SATURDAY = "2026-07-18";
const THEME: DayTheme = { mode: "experience", experienceId: "toronto-islands" };
const SEED = 42;

const islandsRequest = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  city: "toronto",
  date: JULY_SATURDAY,
  persona: { ...ISLANDS_PERSONA, gravity: [...ISLANDS_PERSONA.gravity] },
  budgetBand: { min: 0, max: 140, currency: "CAD" },
  transport: ["walk", "transit"],
  seed: SEED,
  ...over,
});

const skeleton = (over: Partial<GenerationRequest> = {}) =>
  buildSkeleton(islandsRequest(over), { seed: SEED, theme: THEME });

describe("golden Day 7 — the islands day has an islands SHAPE", () => {
  it("centres on a composite block of at least four hours", () => {
    // TRAP: "Capping the island at parks' 150-min dwell (composite anchor
    // must express 6-8h)". parks.max is 150, so this assertion fails the
    // moment the category table takes the wheel back.
    const anchor = skeleton().intents.find((i) => i.role === "anchor");
    expect(anchor).toBeDefined();
    expect(anchor!.composite).toBeDefined();
    expect(anchor!.dwellMinutes).toBeGreaterThanOrEqual(240);
    expect(anchor!.dwellMinutes).toBeGreaterThan(
      GRAMMAR_PARAMS.dwellMinutes.parks.max,
    );
  });

  it("is bounded by the spec, not unbounded — the owner-swap, not an exemption", () => {
    const spec = experienceSpec("toronto-islands");
    const anchor = skeleton().intents.find((i) => i.role === "anchor")!;
    expect(anchor.composite).toEqual(spec.anchor.dwell);
    expect(anchor.dwellMinutes).toBeLessThanOrEqual(spec.anchor.dwell.max);
  });

  it("provisions BEFORE the anchor — the causality, not just the stop", () => {
    // TRAP: "Skipping provisioning (the grocery stop exists BECAUSE of the
    // picnic — causality)". Order is the whole assertion: a supplies stop
    // after the picnic is not a late stop, it is an incoherent day.
    const intents = skeleton().intents;
    const provision = intents.findIndex((i) => i.role === "provision");
    const anchor = intents.findIndex((i) => i.role === "anchor");
    expect(provision).toBeGreaterThanOrEqual(0);
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(provision).toBeLessThan(anchor);
    expect(intents[provision].categories).toEqual(["grocery"]);
  });

  it("keeps meals as connective tissue rather than the point of the day", () => {
    // The composition rule of record. The day still eats — it just is not
    // ABOUT eating.
    const intents = skeleton().intents;
    const anchor = intents.find((i) => i.role === "anchor")!;
    for (const category of anchor.categories) {
      expect(GRAMMAR_PARAMS.pacing.foodCategories).not.toContain(category);
    }
    expect(intents.some((i) => i.kind === "meal")).toBe(true);
  });

  it("does not elect a venue anchor — the experience owns the centre", () => {
    // Electing a second centre beside the composite block would be the
    // duplicate ownership XXX-27 exists to prevent.
    expect(skeleton().electedAnchor).toBeNull();
  });

  it("draws from the islands, which no lens can reach", () => {
    // The zone door. Session 14 CP0 measured that golden Day 7's `corners`
    // persona cannot reach the islands at any seed through the lens.
    const spec = experienceSpec("toronto-islands");
    expect(spec.zones).toContain("toronto_islands");
  });
});

describe("golden Day 7 — the ferry is a fact, and the season is a gate", () => {
  const timetable = FERRY_HANLANS_SUMMER_2026;
  const season = {
    validFrom: timetable.validFrom,
    validTo: timetable.validTo,
  };

  it("has a boat for the crossing the day actually makes", () => {
    // TRAP: "Ferry as dead time (it's an experience leg with skyline views)".
    // The leg is scheduled from a tier-1 fact rather than estimated.
    expect(seasonCovers(season, JULY_SATURDAY)).toBe(true);
    expect(nextDeparture(timetable.value.outbound, "11:30")).toBe("11:45");
  });

  it("knows the last boat, which is what the evening is planned around", () => {
    // TRAP: "Last-ferry ignorance (Hanlan's 23:00 final)".
    expect(lastDeparture(timetable.value.inbound)).toBe("23:00");
  });

  it("WINTER makes the day infeasible, not merely different", () => {
    // TRAP: "WINTER = Ward's route ONLY — Hanlan's runs mid-Apr-mid-Oct, so
    // this day is SEASONALLY INVALID Nov-Mar on the ferry itself, not just
    // the beach." Absence of the route is the honest failure; a day composed
    // without the boat would be the silent fallback constraint 4 forbids.
    expect(seasonCovers(season, "2026-01-17")).toBe(false);
    expect(seasonCovers(season, "2026-12-05")).toBe(false);
  });
});

describe("golden Day 7 — the sunset beat survives the ephemeris", () => {
  it("the closing beat is an outdoor category, so daylight rules bind it", () => {
    // The founder's ruling: "Hanlan's beach is west-facing — the best sunset
    // spot on the islands", caught FROM the island. That only means anything
    // if the block's categories are outdoor-tagged, which Session 14 CP0
    // found they were not: retrieval derived `outdoor` from
    // `category === "parks"`, so a viewpoint was invisible to every daylight
    // rule. This is the assertion that fails if that regresses.
    const spec = experienceSpec("toronto-islands");
    for (const category of spec.anchor.categories) {
      expect(CATEGORY_FAMILY[category]).toBe("outdoor");
    }
    expect(spec.anchor.microActivities.join(" ")).toMatch(/sunset/i);
  });

  it("names its micro-activities as narration rather than as slots", () => {
    // "contains named micro-activities as narration, not slots" — the brief,
    // verbatim. They ride on the block; they are not intents.
    const built = skeleton();
    const anchor = built.intents.find((i) => i.role === "anchor")!;
    expect(anchor.composite).toBeDefined();
    const spec = experienceSpec("toronto-islands");
    expect(spec.anchor.microActivities.length).toBeGreaterThanOrEqual(3);
    // No micro-activity became a stop of its own.
    expect(built.intents.filter((i) => i.role === "anchor")).toHaveLength(1);
  });
});
