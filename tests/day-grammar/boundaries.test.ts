/**
 * Per-rule boundary cases (XXX-5 Step 2).
 *
 * Every rule with a threshold gets its edge tested from both sides. These
 * are the cases where an off-by-one becomes a rejected good day or an
 * accepted bad one — a slot ending exactly at close, a dwell exactly at
 * the ceiling, brunch at 11:59.
 */

import { describe, expect, it } from "vitest";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { validateDay } from "@/shared/day-grammar/validate";
import type {
  GrammarContext,
  GrammarDay,
  GrammarPlace,
  RuleId,
} from "@/shared/day-grammar/types";
import {
  CONCIERGE,
  FOUNDER,
  PLACES_API,
  at,
  cad,
  clearWindows,
  daylight,
  hours,
  present,
  slot,
  tags,
} from "@/shared/fixtures/golden/support";
import { TIERS } from "@/shared/vocabulary";

// A Saturday, so per-weekday hours have something to bite on.
const DATE = "2026-05-16";
const LIGHT = daylight(DATE, "05:18", "05:51", "06:32", "19:55", "20:37", "21:10");

const place = (over: Partial<GrammarPlace> & { id: string }): GrammarPlace => ({
  name: over.id,
  neighborhood: "Test",
  coords: at(43.6532, -79.3832),
  tags: tags(),
  category: present("restaurants", CONCIERGE, TIERS.observed),
  hours: present(hours({ default: [["09:00", "17:00"]] }), PLACES_API, TIERS.verified),
  businessStatus: present("operational", PLACES_API, TIERS.verified),
  priceRange: present(cad(0), FOUNDER, TIERS.verified),
  ...over,
});

function dayOf(places: GrammarPlace[], slots: GrammarDay["slots"]): GrammarDay {
  return {
    id: "boundary",
    city: "toronto",
    date: DATE,
    archetype: "city",
    dayStart: "08:00",
    dayEnd: "22:00",
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    slots,
  };
}

function ctxOf(over: Partial<GrammarContext> = {}): GrammarContext {
  return {
    daylight: LIGHT,
    windows: clearWindows(LIGHT),
    mealPattern: "classic",
    persona: { structure: "scheduler" },
    budgetBand: null,
    lodging: at(43.6532, -79.3832),
    anchorBaseline: null,
    travel: new HaversineStubProvider(),
    transport: ["walk", "transit"],
    params: GRAMMAR_PARAMS,
    ...over,
  };
}

const ruleIds = (day: GrammarDay, ctx: GrammarContext): RuleId[] =>
  validateDay(day, ctx).map((v) => v.ruleId);

describe("hours boundaries", () => {
  it("a slot ending exactly at close is legal", () => {
    const day = dayOf(
      [place({ id: "p" })],
      [slot({ id: "s1", place: "p", from: "16:00", to: "17:00" })],
    );
    expect(ruleIds(day, ctxOf())).not.toContain("hours.outside-open-window");
  });

  it("a slot ending one minute after close is not", () => {
    const day = dayOf(
      [place({ id: "p" })],
      [slot({ id: "s1", place: "p", from: "16:00", to: "17:01" })],
    );
    expect(ruleIds(day, ctxOf())).toContain("hours.outside-open-window");
  });

  it("a slot starting exactly at open is legal", () => {
    const day = dayOf(
      [place({ id: "p" })],
      [slot({ id: "s1", place: "p", from: "09:00", to: "10:00" })],
    );
    expect(ruleIds(day, ctxOf())).not.toContain("hours.outside-open-window");
  });

  it("an empty weekday entry is a closed day, not missing hours", () => {
    const day = dayOf(
      [place({ id: "p", hours: present(hours({ default: [["09:00", "17:00"]], saturday: [] }), PLACES_API, TIERS.verified) })],
      [slot({ id: "s1", place: "p", from: "10:00", to: "11:00" })],
    );
    const found = ruleIds(day, ctxOf());
    expect(found).toContain("hours.closed-day");
    expect(found).not.toContain("hours.unknown");
  });
});

describe("dwell boundaries", () => {
  const parksMax = GRAMMAR_PARAMS.dwellMinutes.parks.max;
  const parksMin = GRAMMAR_PARAMS.dwellMinutes.parks.min;
  const park = (id: string) =>
    place({
      id,
      category: present("parks", CONCIERGE, TIERS.observed),
      hours: present(hours({ default: [["06:00", "23:00"]] }), PLACES_API, TIERS.verified),
      tags: tags({ outdoor: false }),
    });

  it(`exactly ${parksMax} minutes is legal`, () => {
    const day = dayOf([park("p")], [slot({ id: "s1", place: "p", from: "10:00", to: "12:30" })]);
    expect(ruleIds(day, ctxOf())).not.toContain("dwell.overstay");
  });

  it(`${parksMax + 1} minutes is an overstay`, () => {
    const day = dayOf([park("p")], [slot({ id: "s1", place: "p", from: "10:00", to: "12:31" })]);
    expect(ruleIds(day, ctxOf())).toContain("dwell.overstay");
  });

  it(`exactly ${parksMin} minutes is legal`, () => {
    const day = dayOf([park("p")], [slot({ id: "s1", place: "p", from: "10:00", to: "10:20" })]);
    expect(ruleIds(day, ctxOf())).not.toContain("dwell.understay");
  });

  it(`${parksMin - 1} minutes is an understay`, () => {
    const day = dayOf([park("p")], [slot({ id: "s1", place: "p", from: "10:00", to: "10:19" })]);
    expect(ruleIds(day, ctxOf())).toContain("dwell.understay");
  });

  it("never applies to the user's own commitment, however long", () => {
    const day = dayOf(
      [park("p")],
      [slot({ id: "s1", place: "p", from: "08:00", to: "20:00", origin: "user" })],
    );
    const found = ruleIds(day, ctxOf());
    expect(found).not.toContain("dwell.overstay");
    expect(found).not.toContain("dwell.category-unknown");
  });
});

describe("meal pattern boundaries", () => {
  const diner = place({
    id: "d",
    hours: present(hours({ default: [["06:00", "23:00"]] }), PLACES_API, TIERS.verified),
  });

  it("brunch ending 11:59 falls inside the classic lunch window", () => {
    const day = dayOf(
      [diner],
      [slot({ id: "s1", place: "d", from: "11:30", to: "11:59", kind: "meal" })],
    );
    expect(ruleIds(day, ctxOf())).not.toContain("meal.outside-pattern-window");
  });

  it("brunch starting 11:29 does not", () => {
    const day = dayOf(
      [diner],
      [slot({ id: "s1", place: "d", from: "11:29", to: "12:30", kind: "meal" })],
    );
    expect(ruleIds(day, ctxOf())).toContain("meal.outside-pattern-window");
  });

  it("11:29 IS legal under coffee-then-brunch — the pattern is what decides", () => {
    const day = dayOf(
      [diner],
      [slot({ id: "s1", place: "d", from: "11:29", to: "12:30", kind: "meal" })],
    );
    expect(
      ruleIds(day, ctxOf({ mealPattern: "coffee_then_brunch" })),
    ).not.toContain("meal.outside-pattern-window");
  });

  it("no pattern means no window check, and says so", () => {
    const day = dayOf(
      [diner],
      [slot({ id: "s1", place: "d", from: "16:40", to: "17:25", kind: "meal" })],
    );
    const found = ruleIds(day, ctxOf({ mealPattern: null }));
    expect(found).toContain("meal.pattern-unknown");
    expect(found).not.toContain("meal.outside-pattern-window");
  });

  it("an anchor displaces the window it swallows, up to the cap", () => {
    const venue = place({
      id: "v",
      hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
      category: present("nightlife_bars", CONCIERGE, TIERS.observed),
    });
    const day = dayOf(
      [venue, diner],
      [
        slot({ id: "s1", place: "v", from: "18:30", to: "22:00", origin: "user" }),
        slot({ id: "s2", place: "d", from: "22:30", to: "23:30", kind: "meal" }),
      ],
    );
    // Dinner is 17:30–21:30; the anchor eats it, so it reopens at 22:00.
    expect(ruleIds(day, ctxOf())).not.toContain("meal.outside-pattern-window");
  });

  it("but not beyond the cap", () => {
    const venue = place({
      id: "v",
      hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
      category: present("nightlife_bars", CONCIERGE, TIERS.observed),
    });
    const day = dayOf(
      [venue, diner],
      [
        slot({ id: "s1", place: "v", from: "18:30", to: "22:00", origin: "user" }),
        // 120 minutes of displacement ends at 24:00; this starts after it.
        slot({ id: "s2", place: "d", from: "23:15", to: "24:00", kind: "meal" }),
      ],
    );
    expect(ruleIds(day, ctxOf())).not.toContain("meal.outside-pattern-window");
  });
});

describe("travel and anchor boundaries", () => {
  const near = place({
    id: "near",
    coords: at(43.6532, -79.3832),
    hours: present(hours({ default: [["06:00", "23:00"]] }), PLACES_API, TIERS.verified),
  });
  const far = place({
    id: "far",
    coords: at(43.6712, -79.3832), // ~2 km north
    hours: present(hours({ default: [["06:00", "23:00"]] }), PLACES_API, TIERS.verified),
  });

  it("arriving exactly at the anchor's buffer edge is legal", () => {
    // ~2 km walk reads 35 minutes on the stub; the buffer is 15.
    const day = dayOf(
      [near, far],
      [
        slot({ id: "s1", place: "near", from: "10:00", to: "11:00" }),
        slot({ id: "s2", place: "far", from: "11:50", to: "13:00", origin: "user" }),
      ],
    );
    expect(ruleIds(day, ctxOf())).not.toContain("anchor.arrival-late");
  });

  it("one minute later is not", () => {
    const day = dayOf(
      [near, far],
      [
        slot({ id: "s1", place: "near", from: "10:00", to: "11:01" }),
        slot({ id: "s2", place: "far", from: "11:50", to: "13:00", origin: "user" }),
      ],
    );
    expect(ruleIds(day, ctxOf())).toContain("anchor.arrival-late");
  });

  it("a shortfall inside the tier-3 tolerance is advisory, not a violation", () => {
    const day = dayOf(
      [near, far],
      [
        slot({ id: "s1", place: "near", from: "10:00", to: "11:00" }),
        slot({ id: "s2", place: "far", from: "11:30", to: "12:30" }),
      ],
    );
    const found = ruleIds(day, ctxOf());
    expect(found).toContain("travel.tight-transfer");
    expect(found).not.toContain("travel.infeasible");
  });

  it("the same shortfall IS a violation once the estimate is tier 1", () => {
    const routed = {
      estimate: () => ({
        minutes: 35,
        provenance: { source: "google_routes", tier: TIERS.verified },
      }),
    };
    const day = dayOf(
      [near, far],
      [
        slot({ id: "s1", place: "near", from: "10:00", to: "11:00" }),
        slot({ id: "s2", place: "far", from: "11:30", to: "12:30" }),
      ],
    );
    const found = ruleIds(day, ctxOf({ travel: routed }));
    expect(found).toContain("travel.infeasible");
    expect(found).not.toContain("travel.tight-transfer");
  });

  it("an unknown leg is refused, never counted as zero", () => {
    const day = dayOf(
      [near, place({ ...far, id: "far", coords: null })],
      [
        slot({ id: "s1", place: "near", from: "10:00", to: "11:00" }),
        slot({ id: "s2", place: "far", from: "11:00", to: "12:00" }),
      ],
    );
    expect(ruleIds(day, ctxOf())).toContain("travel.uncertifiable");
  });

  it("an unchanged anchor passes the baseline check", () => {
    const day = dayOf(
      [near],
      [slot({ id: "s1", place: "near", from: "10:00", to: "11:00", origin: "user" })],
    );
    const ctx = ctxOf({
      anchorBaseline: {
        s1: { startTime: "10:00", endTime: "11:00", placeId: "near" },
      },
    });
    expect(ruleIds(day, ctx)).not.toContain("anchor.mutated");
  });

  it("a swapped anchor place is a mutation even at the same times", () => {
    const day = dayOf(
      [near, far],
      [slot({ id: "s1", place: "far", from: "10:00", to: "11:00", origin: "user" })],
    );
    const ctx = ctxOf({
      anchorBaseline: {
        s1: { startTime: "10:00", endTime: "11:00", placeId: "near" },
      },
    });
    expect(ruleIds(day, ctx)).toContain("anchor.mutated");
  });

  it("egress from a crowd anchor is measured to the minute", () => {
    const stadium = place({
      id: "stadium",
      tags: tags({ highCrowd: true }),
      hours: present(hours({ default: [["06:00", "24:00"]] }), PLACES_API, TIERS.verified),
    });
    const buffer = GRAMMAR_PARAMS.anchors.crowdEgressBufferMinutes;
    const exact = dayOf(
      [stadium, near],
      [
        slot({ id: "s1", place: "stadium", from: "18:30", to: "22:00", origin: "user" }),
        slot({ id: "s2", place: "near", from: "22:30", to: "23:00" }),
      ],
    );
    expect(ruleIds(exact, ctxOf())).not.toContain("anchor.egress-buffer-short");
    expect(buffer).toBe(30);

    const oneShort = dayOf(
      [stadium, near],
      [
        slot({ id: "s1", place: "stadium", from: "18:30", to: "22:00", origin: "user" }),
        slot({ id: "s2", place: "near", from: "22:29", to: "23:00" }),
      ],
    );
    expect(ruleIds(oneShort, ctxOf())).toContain("anchor.egress-buffer-short");
  });
});

describe("daylight boundaries", () => {
  const park = place({
    id: "park",
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
    tags: tags({ outdoor: true }),
  });

  it("outdoors ending exactly at civil dusk is legal", () => {
    const day = dayOf([park], [slot({ id: "s1", place: "park", from: "19:40", to: "21:10" })]);
    expect(ruleIds(day, ctxOf())).not.toContain("daylight.outdoor-after-dark");
  });

  it("one minute past civil dusk is dark", () => {
    const day = dayOf([park], [slot({ id: "s1", place: "park", from: "19:40", to: "21:11" })]);
    expect(ruleIds(day, ctxOf())).toContain("daylight.outdoor-after-dark");
  });

  it("between sunset and dusk is twilight — advisory, not violation", () => {
    const day = dayOf([park], [slot({ id: "s1", place: "park", from: "19:40", to: "20:50" })]);
    const found = ruleIds(day, ctxOf());
    expect(found).toContain("daylight.outdoor-in-twilight");
    expect(found).not.toContain("daylight.outdoor-after-dark");
  });

  it("an indoor slot after dark is nobody's business", () => {
    const indoor = place({
      id: "indoor",
      hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
    });
    const day = dayOf([indoor], [slot({ id: "s1", place: "indoor", from: "21:00", to: "22:00" })]);
    expect(ruleIds(day, ctxOf())).not.toContain("daylight.outdoor-after-dark");
  });
});

describe("weather severity is conditional on there being somewhere better", () => {
  const park = place({
    id: "park",
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
    tags: tags({ outdoor: true }),
  });
  const day = dayOf([park], [slot({ id: "s1", place: "park", from: "10:00", to: "11:00" })]);

  it("is a violation when a long-enough clear window exists elsewhere", () => {
    const windows = {
      ...clearWindows(LIGHT),
      rainWindows: [{ startLocal: "09:00", endLocal: "12:00" }],
      outdoorFriendlyWindows: [{ startLocal: "13:00", endLocal: "18:00" }],
    };
    expect(ruleIds(day, ctxOf({ windows }))).toContain(
      "weather.outdoor-in-adverse-window",
    );
  });

  it("degrades to advisory when the whole day is wet — the loop must terminate", () => {
    const windows = {
      ...clearWindows(LIGHT),
      rainWindows: [{ startLocal: "06:00", endLocal: "21:00" }],
      outdoorFriendlyWindows: [],
    };
    const found = ruleIds(day, ctxOf({ windows }));
    expect(found).toContain("weather.outdoor-unavoidable-adverse");
    expect(found).not.toContain("weather.outdoor-in-adverse-window");
  });

  it("reports honestly when there is no forecast at all", () => {
    expect(ruleIds(day, ctxOf({ windows: null }))).toContain("weather.unknown");
  });
});

describe("midnight boundary", () => {
  const venue = place({
    id: "v",
    hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
    category: present("nightlife_bars", CONCIERGE, TIERS.observed),
  });

  it("refuses a slot the schema cannot store", () => {
    const day = dayOf([venue], [slot({ id: "s1", place: "v", from: "23:00", to: "01:00" })]);
    expect(ruleIds(day, ctxOf())).toContain("midnight.slot-inverted");
  });

  it("a slot ending exactly at 24:00 is storable and legal", () => {
    const day = dayOf([venue], [slot({ id: "s1", place: "v", from: "22:00", to: "24:00" })]);
    expect(ruleIds(day, ctxOf())).not.toContain("midnight.slot-inverted");
  });

  it("names a late-night tail rather than truncating it silently", () => {
    const day = dayOf([venue], [slot({ id: "s1", place: "v", from: "22:00", to: "23:30" })]);
    expect(ruleIds(day, ctxOf())).toContain("midnight.late-night-tail");
  });
});

describe("budget honesty", () => {
  const priced = place({
    id: "priced",
    priceRange: present(cad(40, 60), PLACES_API, TIERS.observed),
    hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
  });
  const unpriced = place({
    id: "unpriced",
    priceRange: undefined,
    hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
  });

  it("uses the midpoint of a range and reports headroom", () => {
    const day = dayOf([priced], [slot({ id: "s1", place: "priced", from: "12:00", to: "13:00", kind: "meal" })]);
    const found = validateDay(day, ctxOf({ budgetBand: cad(0, 80) }));
    const headroom = found.find((v) => v.ruleId === "budget.headroom");
    expect(headroom?.data.pricedTotal).toBe(50);
    expect(headroom?.data.headroom).toBe(30);
  });

  it("excludes an unpriced stop from the sum and counts it as uncertainty", () => {
    const day = dayOf(
      [priced, unpriced],
      [
        slot({ id: "s1", place: "priced", from: "12:00", to: "13:00", kind: "meal" }),
        slot({ id: "s2", place: "unpriced", from: "14:00", to: "15:00" }),
      ],
    );
    const found = validateDay(day, ctxOf({ budgetBand: cad(0, 80) }));
    expect(found.find((v) => v.ruleId === "budget.headroom")?.data.pricedTotal).toBe(50);
    expect(
      found.find((v) => v.ruleId === "budget.price-uncertain")?.data.unpricedSlotCount,
    ).toBe(1);
  });

  it("counts the transit fare when the day rides", () => {
    const day = dayOf(
      [priced],
      [slot({ id: "s1", place: "priced", from: "12:00", to: "13:00", kind: "meal", by: "transit" })],
    );
    const found = validateDay(day, ctxOf({ budgetBand: cad(0, 80) }));
    expect(found.find((v) => v.ruleId === "budget.headroom")?.data.pricedTotal).toBe(63.5);
  });

  it("says nothing at all when the traveller declined to state a budget", () => {
    const day = dayOf([priced], [slot({ id: "s1", place: "priced", from: "12:00", to: "13:00", kind: "meal" })]);
    const found = ruleIds(day, ctxOf({ budgetBand: null }));
    expect(found).not.toContain("budget.headroom");
    expect(found).not.toContain("budget.over-band");
  });
});

describe("the remaining rules, so every one of the 38 is exercised somewhere", () => {
  it("flags a place whose business status was never checked", () => {
    const unchecked = place({ id: "u", businessStatus: undefined });
    const day = dayOf([unchecked], [slot({ id: "s1", place: "u", from: "12:00", to: "13:00" })]);
    expect(ruleIds(day, ctxOf())).toContain("validity.status-unverified");
  });

  it("notes a golden-hour place scheduled at noon", () => {
    const lookout = place({
      id: "lookout",
      category: present("parks", CONCIERGE, TIERS.observed),
      hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
      tags: tags({ outdoor: true, goldenHourAffine: true }),
    });
    const day = dayOf([lookout], [slot({ id: "s1", place: "lookout", from: "12:00", to: "13:00" })]);
    expect(ruleIds(day, ctxOf())).toContain("daylight.golden-hour-missed");
  });

  it("stays quiet when the golden-hour place is scheduled in golden hour", () => {
    const lookout = place({
      id: "lookout",
      category: present("parks", CONCIERGE, TIERS.observed),
      hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
      tags: tags({ outdoor: true, goldenHourAffine: true }),
    });
    // Evening golden hour on this date is 19:55–20:37.
    const day = dayOf([lookout], [slot({ id: "s1", place: "lookout", from: "19:00", to: "20:30" })]);
    expect(ruleIds(day, ctxOf())).not.toContain("daylight.golden-hour-missed");
  });

  it("rejects a fifth food stop, and passes four, under both patterns", () => {
    // Rewritten in Session 11: this case used to prove `grazing` tolerated
    // five food stops. `grazing` was deleted (XXX-35 ruling 3) because
    // nothing could select it, so the case now proves what the surviving
    // patterns actually do — both cap at four.
    const diner = place({
      id: "d",
      hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
    });
    const eats = (id: string, from: string, to: string) =>
      slot({ id, place: "d", from, to, kind: "meal" });
    const four = [
      eats("s1", "08:00", "08:45"),
      eats("s2", "09:00", "09:45"),
      eats("s3", "12:00", "12:45"),
      eats("s4", "13:00", "13:45"),
    ];
    const fifth = eats("s5", "18:00", "18:45");

    for (const pattern of ["classic", "coffee_then_brunch"] as const) {
      expect(
        ruleIds(dayOf([diner], four), ctxOf({ mealPattern: pattern })),
      ).not.toContain("pacing.food-stops-exceeded");
      expect(
        ruleIds(dayOf([diner], [...four, fifth]), ctxOf({ mealPattern: pattern })),
      ).toContain("pacing.food-stops-exceeded");
    }
  });
});

describe("honest absence is reported, never assumed away", () => {
  it("distinguishes never-fetched from looked-and-not-published", () => {
    const neverFetched = place({ id: "a", hours: undefined });
    const lookedFor = place({ id: "b", hours: { status: "absent", source: PLACES_API, tier: TIERS.observed, fetchedAt: "2026-08-06T23:05:00-04:00" } });

    const dayA = dayOf([neverFetched], [slot({ id: "s1", place: "a", from: "12:00", to: "13:00" })]);
    const dayB = dayOf([lookedFor], [slot({ id: "s1", place: "b", from: "12:00", to: "13:00" })]);

    expect(
      validateDay(dayA, ctxOf()).find((v) => v.ruleId === "hours.unknown")?.data.factState,
    ).toBe("unfetched");
    expect(
      validateDay(dayB, ctxOf()).find((v) => v.ruleId === "hours.unknown")?.data.factState,
    ).toBe("absent");
  });

  it("treats a known-free price as a value, not an absence", () => {
    const free = place({
      id: "free",
      priceRange: present(cad(0), FOUNDER, TIERS.verified),
      hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
    });
    const day = dayOf([free], [slot({ id: "s1", place: "free", from: "12:00", to: "13:00" })]);
    expect(ruleIds(day, ctxOf({ budgetBand: cad(0, 50) }))).not.toContain(
      "budget.price-uncertain",
    );
  });
});

/**
 * The daylight and weather rules read `PlaceTags.outdoor`, and until
 * Session 14 the RETRIEVAL that produces that tag decided it with
 * `category === "parks"` (XXX-40, CP0 — the fifth load-bearing constant).
 *
 * So `scenic_viewpoints`, which joined the outdoor FAMILY in Session 13,
 * arrived with `outdoor: false` and every rule below simply did not see it.
 * Nothing failed; the venue was just absent from the checks that exist to
 * protect it. These tests pin the rules from the tag's side — the producer
 * is pinned in `tests/generation/compose.test.ts`.
 *
 * Golden Day 7's closing beat is a sunset from a west-facing beach, which is
 * why this is checked rather than assumed.
 */
describe("an outdoor viewpoint is subject to the daylight rules", () => {
  const lookout = (over: Partial<GrammarPlace> = {}): GrammarPlace =>
    place({
      id: "lookout",
      category: present("scenic_viewpoints", CONCIERGE, TIERS.observed),
      hours: present(hours({ default: [["00:00", "24:00"]] }), PLACES_API, TIERS.verified),
      tags: tags({ outdoor: true }),
      ...over,
    });

  it("flags a viewpoint seated after civil dusk", () => {
    // Civil dusk is 21:10 on this date; 21:30–22:00 is an outdoor stop with
    // nothing to look at, which is the failure the rule exists for.
    const day = dayOf(
      [lookout()],
      [slot({ id: "s1", place: "lookout", from: "21:30", to: "22:00" })],
    );
    expect(ruleIds(day, ctxOf())).toContain("daylight.outdoor-after-dark");
  });

  it("passes the same viewpoint in daylight", () => {
    const day = dayOf(
      [lookout()],
      [slot({ id: "s1", place: "lookout", from: "18:30", to: "19:30" })],
    );
    const found = ruleIds(day, ctxOf());
    expect(found).not.toContain("daylight.outdoor-after-dark");
    expect(found).not.toContain("daylight.outdoor-in-twilight");
  });

  it("would MISS both if the tag were false — the defect, pinned", () => {
    // The regression itself: same slot, same hour, tag as retrieval used to
    // produce it. Nothing is reported, which is exactly why it survived a
    // session — a silent false is indistinguishable from a good day.
    const day = dayOf(
      [lookout({ tags: tags() })],
      [slot({ id: "s1", place: "lookout", from: "21:30", to: "22:00" })],
    );
    expect(ruleIds(day, ctxOf())).not.toContain("daylight.outdoor-after-dark");
  });
});
