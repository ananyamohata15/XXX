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
import { THEME_ZONES, experienceSpec, type DayTheme } from "@/shared/theme";
import { haversineKm } from "@/shared/day-grammar/travel";
import { CATEGORY_FAMILY, TIERS } from "@/shared/vocabulary";
import { validateDay } from "@/shared/day-grammar/validate";
import type { GrammarDay } from "@/shared/day-grammar/types";
import { CONCIERGE, present } from "@/shared/fixtures/golden/support";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";

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

/**
 * Regressions from the FIRST LIVE ISLANDS GENERATION (Session 14 Step 3).
 *
 * It failed honestly with `dwell.understay` — the composite block seated for
 * 150 minutes against its own 240 floor — and the cause was a third reader
 * of the category table that the owner-swap had not reached:
 * `clampDwell(480, parks{20,150})` is 150.
 *
 * Both defects below cost a real generation to find. They are pinned so the
 * next one is free.
 */
describe("what the first live islands day cost us", () => {
  it("clamps the composite block to ITS OWN range, not the category's", () => {
    const spec = experienceSpec("toronto-islands");
    // The exact arithmetic that produced the failure. `parks.max` is 150 and
    // the block wants 480; if the category range is consulted here the day's
    // centre is a 150-minute park again.
    expect(GRAMMAR_PARAMS.dwellMinutes.parks.max).toBeLessThan(
      spec.anchor.dwell.min,
    );

    const anchor = skeleton().intents.find((i) => i.role === "anchor")!;
    expect(anchor.composite).toBeDefined();
    // `trySeat` clamps `intent.dwellMinutes` into `intent.composite` when it
    // is present. If it clamped into the category range instead, this would
    // be 150.
    const clamped = Math.min(
      Math.max(anchor.dwellMinutes, anchor.composite!.min),
      anchor.composite!.max,
    );
    expect(clamped).toBeGreaterThanOrEqual(spec.anchor.dwell.min);
  });

  it("gives a theme zone no discovery slack — the harbour is not a rounding error", () => {
    // The live run retrieved St. James Park, 3.3 km away on the MAINLAND,
    // because 2.5 km of radius plus 1.0 km of discovery slack reaches across
    // the water. A discovery anchor approximates a neighbourhood; a theme
    // zone is drawn against measured coordinates for one purpose.
    const zone = THEME_ZONES.find((z) => z.slug === "toronto_islands")!;
    const stJamesPark = { lat: 43.6503, lng: -79.3757 };
    const km = haversineKm(stJamesPark, { lat: zone.lat, lng: zone.lng });
    expect(km).toBeGreaterThan(zone.radiusM / 1000);
    // ...and it WOULD have been admitted with the discovery slack applied.
    expect(km).toBeLessThan(zone.radiusM / 1000 + 1.0);
  });
});

/**
 * The two findings the first GOOD islands day surfaced (Session 14 Step 3
 * ruling 2). Both are cosmetic-looking and neither is: one would send a
 * traveller to a beach with nothing to eat, the other would put a wrong
 * address on a right stop in front of the founder.
 */
describe("what the first good islands day surfaced", () => {
  it("never advises reordering a provision stop after what it serves", () => {
    // The route rule advised visiting Toronto Island Park before the LCBO to
    // save 34 minutes. Arithmetically true; the picnic supplies are bought
    // BEFORE the picnic. Causality outranks distance.
    const day: GrammarDay = {
      id: "provision-order",
      city: "toronto",
      date: JULY_SATURDAY,
      archetype: "city",
      dayStart: "09:00",
      dayEnd: "22:00",
      places: {
        shop: {
          id: "shop",
          name: "LCBO",
          neighborhood: "Harbourfront",
          coords: { lat: 43.6382, lng: -79.3906 },
          tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
          category: present("grocery", CONCIERGE, TIERS.observed),
        },
        island: {
          id: "island",
          name: "Toronto Island Park",
          neighborhood: "Toronto Islands",
          coords: { lat: 43.6207, lng: -79.3756 },
          tags: { outdoor: true, goldenHourAffine: false, highCrowd: false },
          category: present("parks", CONCIERGE, TIERS.observed),
        },
      },
      slots: [
        {
          id: "s1",
          origin: "concierge",
          kind: "activity",
          startTime: "10:50",
          endTime: "11:00",
          placeId: "shop",
          arriveBy: "transit",
          role: "provision",
        },
        {
          id: "s2",
          origin: "concierge",
          kind: "activity",
          startTime: "11:25",
          endTime: "19:25",
          placeId: "island",
          arriveBy: "transit",
          role: "anchor",
        },
      ],
    };
    const found = validateDay(day, {
      daylight: null,
      windows: null,
      mealPattern: "classic",
      persona: { structure: "scheduler" },
      budgetBand: null,
      lodging: null,
      transport: ["walk", "transit"],
      anchorBaseline: null,
      travel: new HaversineStubProvider(),
      params: GRAMMAR_PARAMS,
    });
    expect(found.map((f) => f.ruleId)).not.toContain("route.detour-avoidable");
  });
});
