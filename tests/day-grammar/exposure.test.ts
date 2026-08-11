/**
 * Leg exposure (XXX-35 item 1) — the cap function and the rule.
 *
 * The gap this closes: before Session 11 every weather and daylight rule
 * read a slot span and none read a travel leg, so a 35-minute walk at
 * -8 °C between two indoor venues passed the entire grammar. It is the
 * founder's "Winter days with 30+ mins of walking is illogical".
 */

import { describe, expect, it } from "vitest";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import type { HourlyExposure } from "@/shared/scheduling-windows";
import {
  exposureAt,
  walkCapMinutes,
} from "@/shared/day-grammar/rules/exposure";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { validateDay } from "@/shared/day-grammar/validate";
import type {
  GrammarContext,
  GrammarDay,
  RuleId,
} from "@/shared/day-grammar/types";
import {
  CONCIERGE,
  PLACES_API,
  at,
  byId,
  cad,
  clearWindows,
  daylight,
  hours,
  present,
  slot,
  tags,
} from "@/shared/fixtures/golden/support";
import { TIERS } from "@/shared/vocabulary";

const P = GRAMMAR_PARAMS.exposure;

const pleasant = { apparentTempC: 18, precipProbPct: 0, precipMm: 0, usAqi: 20 };

describe("walkCapMinutes", () => {
  it("does not bind on a pleasant day", () => {
    expect(walkCapMinutes(pleasant, P).capMinutes).toBe(P.baseWalkCapMinutes);
    expect(walkCapMinutes(pleasant, P).drivers).toEqual([]);
  });

  it("answers the founder's two winter cases the way the corpus demands", () => {
    // 35 min at -8 °C must FAIL: "Winter days with 30+ mins of walking is
    // illogical" (recorded verdict, trace a825417a).
    const at8Below = walkCapMinutes({ ...pleasant, apparentTempC: -8 }, P);
    expect(35).toBeGreaterThan(at8Below.capMinutes);

    // 16 min at -10 °C must PASS: golden day-3's rink→PATH hop, which the
    // founder authored and verified as a good day.
    const at10Below = walkCapMinutes({ ...pleasant, apparentTempC: -10 }, P);
    expect(16).toBeLessThanOrEqual(at10Below.capMinutes);
  });

  it("takes the MINIMUM over every binding band, not an average", () => {
    const coldAndFilthy = walkCapMinutes(
      { apparentTempC: -12, precipProbPct: 90, precipMm: 2, usAqi: 180 },
      P,
    );
    expect(coldAndFilthy.capMinutes).toBe(
      Math.min(
        P.cold.severeCapMinutes,
        P.precipitation.capMinutes,
        P.air.severeCapMinutes,
      ),
    );
    expect(coldAndFilthy.drivers.length).toBeGreaterThan(1);
  });

  it("reads a missing reading as 'cannot bind', never as clean", () => {
    const noAqi = walkCapMinutes(
      { apparentTempC: 18, precipProbPct: null, precipMm: 0, usAqi: null },
      P,
    );
    expect(noAqi.capMinutes).toBe(P.baseWalkCapMinutes);
    expect(noAqi.drivers).toEqual([]);
  });

  it("binds on heat and on air quality — Delhi-ready from day one", () => {
    expect(
      walkCapMinutes({ ...pleasant, apparentTempC: 33 }, P).capMinutes,
    ).toBe(P.heat.severeCapMinutes);
    expect(walkCapMinutes({ ...pleasant, usAqi: 160 }, P).capMinutes).toBe(
      P.air.severeCapMinutes,
    );
    expect(walkCapMinutes({ ...pleasant, usAqi: 120 }, P).capMinutes).toBe(
      P.air.unhealthyCapMinutes,
    );
  });

  it("is pure and total across the whole plausible range", () => {
    for (let t = -40; t <= 50; t += 1) {
      const a = walkCapMinutes({ ...pleasant, apparentTempC: t }, P);
      const b = walkCapMinutes({ ...pleasant, apparentTempC: t }, P);
      expect(a.capMinutes).toBe(b.capMinutes);
      expect(a.capMinutes).toBeGreaterThan(0);
    }
  });
});

describe("exposureAt", () => {
  const hourly = clearWindows(
    daylight("2027-01-06", "07:18", "07:50", "08:37", "16:09", "16:56", "17:28"),
  ).hourlyExposure;

  it("finds the hour covering a time, half-open at the end", () => {
    expect(exposureAt(hourly, "09:00")?.startLocal).toBe("09:00");
    expect(exposureAt(hourly, "09:59")?.startLocal).toBe("09:00");
    expect(exposureAt(hourly, "10:00")?.startLocal).toBe("10:00");
  });

  it("returns null rather than the nearest hour when nothing covers it", () => {
    expect(exposureAt([], "12:00")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

const light = daylight(
  "2027-01-06",
  "07:18",
  "07:50",
  "08:37",
  "16:09",
  "16:56",
  "17:28",
);

/** Two indoor venues 2 km apart — a ~28-minute walk on the stub. */
function walkingDay(): GrammarDay {
  const place = (id: string, lat: number, lng: number) => ({
    id,
    name: id,
    neighborhood: "Test",
    coords: at(lat, lng),
    tags: tags(),
    category: present("museums_galleries" as const, CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["08:00", "22:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational" as const, PLACES_API, TIERS.verified),
    priceRange: present(cad(10, 20), PLACES_API, TIERS.observed),
  });
  return {
    id: "exposure-day",
    city: "toronto",
    date: "2027-01-06",
    archetype: "city",
    dayStart: "09:00",
    dayEnd: "18:00",
    places: byId([place("a", 43.6532, -79.3832), place("b", 43.6532, -79.359)]),
    slots: [
      slot({ id: "s1", place: "a", from: "10:00", to: "11:00" }),
      slot({ id: "s2", place: "b", from: "12:00", to: "13:00", by: "walk" }),
    ],
  };
}

function ctxOf(over: Partial<GrammarContext> = {}): GrammarContext {
  return {
    daylight: light,
    // −6 °C: inside the "cold" band, so a long walk is over the cap while
    // a short one is not.
    windows: clearWindows(light, 20, -6),
    mealPattern: null,
    persona: { structure: "scheduler" },
    budgetBand: null,
    lodging: null,
    anchorBaseline: null,
    travel: new HaversineStubProvider(),
    transport: ["walk", "transit"],
    params: GRAMMAR_PARAMS,
    ...over,
  };
}

const ruleIds = (day: GrammarDay, ctx: GrammarContext): RuleId[] =>
  validateDay(day, ctx).map((v) => v.ruleId);

describe("checkExposure", () => {
  it("rejects an over-cap walk when a sheltered mode can be priced", () => {
    const found = validateDay(walkingDay(), ctxOf());
    const hit = found.find((v) => v.ruleId === "exposure.leg-over-cap");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("violation");
    // The message must be actionable: the mode to use, and how cold it is.
    expect(hit!.message).toContain("transit");
    expect(hit!.data.preferredMode).toBe("transit");
    expect(hit!.data.capMinutes).toBe(P.cold.briskCapMinutes);
  });

  it("only ADVISES when the trip has no sheltered mode — loop termination", () => {
    const found = validateDay(walkingDay(), ctxOf({ transport: ["walk"] }));
    const hit = found.find((v) => v.ruleId === "exposure.leg-unavoidable");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("advisory");
    expect(ruleIds(walkingDay(), ctxOf({ transport: ["walk"] }))).not.toContain(
      "exposure.leg-over-cap",
    );
  });

  it("cannot claim an alternative exists when transport is unknown", () => {
    const found = validateDay(walkingDay(), ctxOf({ transport: null }));
    expect(found.find((v) => v.ruleId === "exposure.leg-unavoidable")).toBeDefined();
    expect(found.find((v) => v.ruleId === "exposure.leg-over-cap")).toBeUndefined();
  });

  it("says so when there is no weather — absence is not approval", () => {
    const found = validateDay(walkingDay(), ctxOf({ windows: null }));
    const hit = found.find((v) => v.ruleId === "exposure.unknown");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("advisory");
    expect(hit!.message).toMatch(/unchecked leg, not an approved one/);
    // And no cap claim is made either way.
    expect(found.find((v) => v.ruleId === "exposure.leg-over-cap")).toBeUndefined();
  });

  it("leaves a pleasant-day walk alone entirely", () => {
    const found = ruleIds(walkingDay(), ctxOf({ windows: clearWindows(light, 20, 18) }));
    expect(found).not.toContain("exposure.leg-over-cap");
    expect(found).not.toContain("exposure.leg-unavoidable");
    expect(found).not.toContain("exposure.unknown");
  });

  it("ignores legs the traveller is not outside for", () => {
    const day = walkingDay();
    day.slots[1].arriveBy = "transit";
    const found = ruleIds(day, ctxOf());
    expect(found).not.toContain("exposure.leg-over-cap");
    expect(found).not.toContain("exposure.leg-unavoidable");
  });
});

/**
 * WINTER REPLAY — the composition-level exposure proof, offline and free.
 *
 * The Tier 2/3 exam could not prove this live: it ran in August, the only
 * in-horizon dates are pleasant, and a pleasant hour binds no band, so all
 * ten live generations produced zero mode swaps. The rule was proven by
 * fixtures and unit tests and by nothing else, which is a thin place to
 * leave the founder's loudest complaint ("Winter days with 30+ mins of
 * walking is illogical").
 *
 * So the winter is synthesised instead of waited for: real composition,
 * real travel estimates, real cap arithmetic, a fabricated -8 °C hour.
 * Costs nothing and needs no forecast.
 */
describe("winter replay: composition swaps an over-cap walk (offline)", () => {
  const coldHours: HourlyExposure[] = Array.from({ length: 24 }, (_, h) => ({
    startLocal: `${String(h).padStart(2, "0")}:00`,
    endLocal: `${String((h + 1) % 24).padStart(2, "0")}:00`,
    apparentTempC: -8, // the founder's own number
    precipProbPct: 0,
    precipMm: 0,
    usAqi: null,
  }));

  it("prices -8 °C at the brisk-cold cap, so a 35-minute walk is over it", () => {
    const { capMinutes, drivers } = walkCapMinutes(
      {
        apparentTempC: -8,
        precipProbPct: 0,
        precipMm: 0,
        usAqi: null,
      },
      GRAMMAR_PARAMS.exposure,
    );
    // 25, not the 20 ruled at CP1: the bands were recalibrated in Step 2
    // because the CP1 ≤-10 row flagged golden day-3's rink→PATH hop, which
    // the founder authored and verified. The fixture set the floor, the
    // corpus set the ceiling, and -8 °C still caps well under 35.
    expect(capMinutes).toBe(GRAMMAR_PARAMS.exposure.cold.briskCapMinutes);
    expect(drivers).toContain("cold");
    expect(35).toBeGreaterThan(capMinutes);
  });

  it("leaves the same walk alone at +12 °C — the band is what binds", () => {
    const mild = walkCapMinutes(
      { apparentTempC: 12, precipProbPct: 0, precipMm: 0, usAqi: null },
      GRAMMAR_PARAMS.exposure,
    );
    expect(mild.capMinutes).toBe(GRAMMAR_PARAMS.exposure.baseWalkCapMinutes);
    expect(mild.drivers).toHaveLength(0);
    // This is exactly why the live August exam produced zero swaps, and
    // why its silence was evidence of nothing.
    expect(35).toBeLessThan(mild.capMinutes);
  });

  it("reads every hour of the synthetic winter day as cold", () => {
    for (const hour of ["09:30", "13:05", "16:59", "21:00"]) {
      const reading = exposureAt(coldHours, hour);
      expect(reading, `no reading covers ${hour}`).not.toBeNull();
      expect(walkCapMinutes(reading!, GRAMMAR_PARAMS.exposure).capMinutes).toBe(
        GRAMMAR_PARAMS.exposure.cold.briskCapMinutes,
      );
    }
  });
});
