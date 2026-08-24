/**
 * THE PICNIC SHAPE EXAM (XXX-48, Session 16 CP3).
 *
 * The founder asked for a picnic and got four table-family stops and no park.
 * Not because a picnic is hard — because `EXPERIENCE_IDS` held exactly one id
 * and it was an island, so derivation had nothing mainland to reach for and
 * fell through to `venue`.
 *
 * This exam is golden Day 7's, minus the ferry. That is the whole claim being
 * tested: **if the experience layer is a layer, a second tenant costs one row
 * and proves itself against the same assertions.** Where an assertion here
 * mirrors one in `day-7-shape.test.ts`, that is the point, not duplication —
 * the two days must exercise the same machinery, and only the timetable
 * should differ.
 *
 * Runs against the SKELETON, for the reason Day 7's exam records: the
 * composite block, the provisioning stop and their causal order are all
 * decided in `buildSkeleton`, so a pool would add cost without adding
 * evidence.
 */

import { describe, expect, it } from "vitest";
import { buildSkeleton } from "@/server/generation/compose";
import {
  environmentIsFair,
  selectTheme,
  themeInfeasibility,
  themeSpineCategories,
  type ThemeFeasibilityInput,
} from "@/server/generation/theme-select";
import type { GenerationRequest } from "@/server/generation/types";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { diceStream, personaIdentity } from "@/shared/dice";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import {
  experienceSpec,
  themeLabel,
  themeZoneSlugs,
  type DayTheme,
} from "@/shared/theme";
import { CATEGORY_FAMILY } from "@/shared/vocabulary";

const PICNIC: DayTheme = { mode: "experience", experienceId: "park-picnic" };
const SEED = 42;
/** A summer Saturday. Nothing about a picnic needs a timetable. */
const AUGUST_SATURDAY = "2026-08-15";

/**
 * The islands persona: nature-first, relaxed, scheduler. A picnic suits the
 * same traveller, which is why it is the second tenant rather than a day for
 * somebody else.
 */
const PICNIC_PERSONA = {
  pace: "relaxed" as const,
  gravity: ["nature", "food", "local_life"] as const,
  foodCourage: "adventurous" as const,
  structure: "scheduler" as const,
  lens: "corners" as const,
};

const picnicRequest = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  city: "toronto",
  date: AUGUST_SATURDAY,
  persona: { ...PICNIC_PERSONA, gravity: [...PICNIC_PERSONA.gravity] },
  budgetBand: { min: 0, max: 90, currency: "CAD" },
  transport: ["walk", "transit"],
  seed: SEED,
  ...over,
});

const skeleton = (over: Partial<GenerationRequest> = {}) =>
  buildSkeleton(picnicRequest(over), { seed: SEED, theme: PICNIC });

const feasibility = (
  over: Partial<ThemeFeasibilityInput> = {},
): ThemeFeasibilityInput => ({
  persona: GOLDEN_PERSONAS["day-6-excursion"]!,
  routeRuns: () => true,
  goodWeather: true,
  canHold: () => true,
  excludes: () => false,
  ...over,
});

describe("the picnic day has a picnic SHAPE", () => {
  it("centres on a composite block, not a 150-minute park stop", () => {
    // The same trap Day 7 names: `parks.max` is 150, so this fails the moment
    // the category table takes the wheel back from the spec.
    const anchor = skeleton().intents.find((i) => i.role === "anchor");
    expect(anchor).toBeDefined();
    expect(anchor!.composite).toBeDefined();
    expect(anchor!.dwellMinutes).toBeGreaterThan(
      GRAMMAR_PARAMS.dwellMinutes.parks.max,
    );
  });

  it("is BOUNDED by its spec — curation, not an exemption", () => {
    const spec = experienceSpec("park-picnic");
    const anchor = skeleton().intents.find((i) => i.role === "anchor")!;
    expect(anchor.composite).toEqual(spec.anchor.dwell);
    expect(anchor.dwellMinutes).toBeLessThanOrEqual(spec.anchor.dwell.max);
  });

  it("centres on a PARK — outdoor, never a table", () => {
    const anchor = skeleton().intents.find((i) => i.role === "anchor")!;
    expect(anchor.categories).toEqual(["parks"]);
    for (const c of anchor.categories) {
      expect(CATEGORY_FAMILY[c]).toBe("outdoor");
      expect(GRAMMAR_PARAMS.pacing.foodCategories).not.toContain(c);
    }
  });

  it("buys the picnic BEFORE it eats it — causality, seated", () => {
    // Golden Day 7's own trap list: "Skipping provisioning (the grocery stop
    // exists BECAUSE of the picnic — causality)".
    const intents = skeleton().intents;
    const provision = intents.find((i) => i.role === "provision");
    const anchor = intents.find((i) => i.role === "anchor")!;
    expect(provision).toBeDefined();
    expect(provision!.categories).toContain("grocery");
    expect(provision!.window.start).toBeLessThan(anchor.window.start);
  });

  it("absorbs the middle meal — the picnic IS lunch", () => {
    const spec = experienceSpec("park-picnic");
    expect(spec.absorbsMeals).toBe(1);
    const meals = skeleton().intents.filter((i) => i.kind === "meal");
    const anchor = skeleton().intents.find((i) => i.role === "anchor")!;
    // No meal is seated inside the block: a three-hour picnic cannot break
    // for a restaurant in the middle of itself.
    for (const meal of meals) {
      const insideBlock =
        meal.window.start >= anchor.window.start &&
        meal.window.end <= anchor.window.end;
      expect(insideBlock).toBe(false);
    }
  });

  it("needs NO timetable — which is what makes it the second tenant", () => {
    // The islands day is infeasible whenever the ferry does not run. A picnic
    // on the same refusing date is fine, and that difference is the layer
    // proving it is a layer rather than one hard-coded day.
    const noBoats = feasibility({ routeRuns: () => false });
    expect(themeInfeasibility(PICNIC, noBoats)).toBeNull();
    expect(
      themeInfeasibility(
        { mode: "experience", experienceId: "toronto-islands" },
        noBoats,
      )?.reason,
    ).toBe("route-out-of-season");
  });

  it("is bound to NO district — the blocker this ticket removed", () => {
    expect(experienceSpec("park-picnic").zones).toBeUndefined();
    // Same empty list a venue day returns, so `zonesFor` falls through to the
    // traveller's own geography with no new branch to remember.
    expect(themeZoneSlugs(PICNIC)).toEqual([]);
  });
});

describe("the picnic refuses honestly", () => {
  it("REFUSES rain, rather than silently becoming a venue day", () => {
    const wet = themeInfeasibility(PICNIC, feasibility({ goodWeather: false }));
    expect(wet?.reason).toBe("weather");
    // It names the day, so the refusal can be spoken without the surface
    // knowing what a `park-picnic` is.
    expect(wet?.detail).toContain(experienceSpec("park-picnic").label);
  });

  it("a REQUESTED picnic in the rain FAILS — never a downgrade", () => {
    const outcome = selectTheme({
      persona: GOLDEN_PERSONAS["day-6-excursion"]!,
      requested: PICNIC,
      feasibility: feasibility({ goodWeather: false }),
      dice: diceStream({
        seed: SEED,
        identity: personaIdentity(GOLDEN_PERSONAS["day-6-excursion"]!),
        site: "theme",
        context: AUGUST_SATURDAY,
      }),
    });
    expect(outcome.status).toBe("refused");
  });

  it("permits an UNKNOWN forecast — 'we did not look' is not 'it will rain'", () => {
    // The tasting room offers dates past the forecast horizon, and treating a
    // blind date as a wet one would make the picnic unreachable for exactly
    // the dates a founder vets on.
    expect(environmentIsFair({ windows: null })).toBeNull();
    expect(
      themeInfeasibility(PICNIC, feasibility({ goodWeather: null })),
    ).toBeNull();
  });

  it("refuses a traveller who will not go to a grocery — provisioning counts", () => {
    // The picnic inherits the islands' rule for free: a spine whose
    // provisioning stop is refused is as infeasible as one whose anchor is.
    expect(themeSpineCategories(PICNIC)).toContain("grocery");
    const refused = themeInfeasibility(
      PICNIC,
      feasibility({ excludes: (c) => c === "grocery" }),
    );
    expect(refused?.reason).toBe("excluded-category");
  });

  it("is called something a person would say", () => {
    expect(themeLabel("park-picnic")).toBe("A picnic in the park");
  });
});

describe("a picnic is REACHABLE — the defect was that it was not", () => {
  it("is derived for a nature-first traveller on a fair day", () => {
    // The founder's actual failure: derivation fell to `venue` because the
    // only experience was an island. This asserts the door is open, which is
    // the assertion whose absence was the whole ticket.
    const outcome = selectTheme({
      persona: { ...PICNIC_PERSONA, gravity: [...PICNIC_PERSONA.gravity] },
      requested: null,
      feasibility: feasibility({
        // No ferry today, so the islands cannot win by being the only
        // experience — the picnic has to be chosen on its own merits.
        routeRuns: () => false,
      }),
      dice: diceStream({
        seed: SEED,
        identity: personaIdentity({
          ...PICNIC_PERSONA,
          gravity: [...PICNIC_PERSONA.gravity],
        }),
        site: "theme",
        context: AUGUST_SATURDAY,
      }),
    });
    expect(outcome.status).toBe("selected");
    if (outcome.status !== "selected") return;
    expect(outcome.selection.theme).toEqual(PICNIC);
  });
});
