import { describe, expect, it } from "vitest";
import { buildSkeleton } from "@/server/generation/compose";
import {
  themeInfeasibility,
  themeSpineCategories,
  type ThemeFeasibilityInput,
} from "@/server/generation/theme-select";
import type { GenerationRequest } from "@/server/generation/types";
import { buildGrammarContext } from "@/server/generation/context";
import { computeDaylight } from "@/server/weather/ephemeris";
import { excludeRefusedVenues } from "@/server/generation/engine";
import type { Candidate } from "@/server/generation/types";
import {
  CATEGORY_CONSTRAINT_LIMITATION,
  DRINKING_LABEL_PREFIXES,
  drinkingFocusOf,
  excludesAlcohol,
  isCategoryPermitted,
  isFullyExcluded,
  isVenuePermitted,
  owesLimitationNotice,
  permittedCategories,
} from "@/shared/constraints";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import type { GrammarContext } from "@/shared/day-grammar/types";
import { validateDay } from "@/shared/day-grammar/validate";
import { TRAP_FIXTURES } from "@/shared/fixtures/golden/traps";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import type { DayTheme } from "@/shared/theme";
import { PLACE_CATEGORIES, type PlaceCategory } from "@/shared/vocabulary";

const DATE = "2026-08-29";
const SEED = 42;

const requestFor = (
  personaKey: string,
  excluded?: PlaceCategory[],
): GenerationRequest => ({
  city: "toronto",
  date: DATE,
  persona: GOLDEN_PERSONAS[personaKey]!,
  budgetBand: null,
  transport: ["walk", "transit"],
  ...(excluded === undefined ? {} : { excludedCategories: excluded }),
});

describe("the constraint predicate — one owner for the question", () => {
  it("permits everything when nothing is excluded", () => {
    for (const c of PLACE_CATEGORIES) expect(isCategoryPermitted(c, [])).toBe(true);
  });

  it("preserves order when filtering", () => {
    // Order is load-bearing at every call site: the close palette is a
    // weighted DRAW whose sequence is the die's, and menu allocation
    // round-robins in list order. Filtering must remove without reordering,
    // or a constraint changes a day's shape beyond the removal itself.
    const list: PlaceCategory[] = [
      "nightlife_bars",
      "parks",
      "restaurants",
      "shopping",
    ];
    expect(permittedCategories(list, ["parks"])).toEqual([
      "nightlife_bars",
      "restaurants",
      "shopping",
    ]);
  });

  it("returns a copy, so a caller cannot mutate the palette it was given", () => {
    const list: PlaceCategory[] = ["parks", "cafes"];
    const out = permittedCategories(list, []);
    out.push("restaurants");
    expect(list).toEqual(["parks", "cafes"]);
  });

  it("knows the difference between narrowed and emptied", () => {
    expect(isFullyExcluded(["parks", "cafes"], ["parks"])).toBe(false);
    expect(isFullyExcluded(["parks"], ["parks"])).toBe(true);
    expect(isFullyExcluded([], ["parks"])).toBe(false);
  });
});

/**
 * ARM ONE — the byte-identity gate, at the seam that could break it.
 *
 * This session must not move composition for anyone who has not asked it to.
 * `buildSkeleton` is where the constraint chokes, so it is where a leak would
 * show first.
 */
describe("byte identity for a constraint-free request", () => {
  it("holds for every exam persona, character for character", () => {
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const bare = buildSkeleton(requestFor(key), { seed: SEED });
      const empty = buildSkeleton(requestFor(key, []), { seed: SEED });
      expect(JSON.stringify(empty), key).toBe(JSON.stringify(bare));
    }
  });

  it("holds when the excluded category is one the day never wanted", () => {
    // Excluding something absent from the palette must be a no-op, not a
    // near-no-op. If this drifts, the constraint is reshaping days silently.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const bare = buildSkeleton(requestFor(key), { seed: SEED });
      const irrelevant = buildSkeleton(requestFor(key, ["grocery"]), {
        seed: SEED,
      });
      const bareHasGrocery = bare.intents.some((i) =>
        i.categories.includes("grocery"),
      );
      if (!bareHasGrocery) {
        expect(JSON.stringify(irrelevant), key).toBe(JSON.stringify(bare));
      }
    }
  });
});

/**
 * ARM TWO — it actually fires.
 *
 * Session 14's rest stop passed five tests and fired zero times. An inert
 * constraint and a working one look identical from the byte-identity arm
 * alone, so the removal is asserted directly against real skeletons.
 */
describe("the constraint reaches the palette", () => {
  it("FIRES: no intent offers an excluded category, for any persona", () => {
    let sawItRemoved = false;
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const bare = buildSkeleton(requestFor(key), { seed: SEED });
      const offeredBars = bare.intents.some((i) =>
        i.categories.includes("nightlife_bars"),
      );
      const constrained = buildSkeleton(
        requestFor(key, ["nightlife_bars"]),
        { seed: SEED },
      );
      for (const intent of constrained.intents) {
        expect(intent.categories, `${key}/${intent.id}`).not.toContain(
          "nightlife_bars",
        );
      }
      if (offeredBars) sawItRemoved = true;
    }
    // The premise, asserted before the behaviour: if NO persona was ever
    // offered a bar, the loop above proved nothing at all.
    expect(
      sawItRemoved,
      "no exam persona was offered nightlife_bars — this test asserts nothing",
    ).toBe(true);
  });

  it("never lets the family licence promote an excluded category", () => {
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const constrained = buildSkeleton(
        requestFor(key, ["nightlife_bars", "shopping"]),
        { seed: SEED },
      );
      for (const intent of constrained.intents) {
        if (intent.licensedCategory !== undefined) {
          expect(["nightlife_bars", "shopping"]).not.toContain(
            intent.licensedCategory,
          );
        }
      }
    }
  });

  it("never elects an excluded category as the day's centre", () => {
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const skeleton = buildSkeleton(requestFor(key, ["parks", "nightlife_bars"]), {
        seed: SEED,
      });
      const elected = skeleton.electedAnchor?.category;
      if (elected !== undefined) {
        expect(["parks", "nightlife_bars"], key).not.toContain(elected);
      }
    }
  });
});

/** A theme REFUSES rather than substituting — the ratified constraint law. */
describe("theme refusal", () => {
  const HISTORY: DayTheme = { mode: "thread", threadId: "history-of-toronto" };
  const ISLANDS: DayTheme = {
    mode: "experience",
    experienceId: "toronto-islands",
  };
  const base = (over: Partial<ThemeFeasibilityInput> = {}): ThemeFeasibilityInput => ({
    persona: GOLDEN_PERSONAS["day-6-excursion"]!,
    routeRuns: () => true,
    goodWeather: true,
    canHold: () => true,
    excludes: () => false,
    ...over,
  });

  it("knows what a theme's spine is made of", () => {
    expect(themeSpineCategories(HISTORY).length).toBeGreaterThan(0);
    // Provisioning counts: the islands day buys lunch before the ferry.
    expect(themeSpineCategories(ISLANDS)).toContain("grocery");
  });

  it("REFUSES a theme whose spine needs an excluded category", () => {
    const spine = themeSpineCategories(HISTORY);
    const verdict = themeInfeasibility(
      HISTORY,
      base({ excludes: (c) => c === spine[0] }),
    );
    expect(verdict?.reason).toBe("excluded-category");
    // Concierge-shaped, and never a raw slug.
    expect(verdict?.detail).not.toMatch(/_/);
  });

  it("refuses when only the PROVISIONING stop is excluded", () => {
    // Checking the anchor alone would miss this, and the islands day would
    // silently lose the stop that makes it work.
    const verdict = themeInfeasibility(
      ISLANDS,
      base({ excludes: (c) => c === "grocery" }),
    );
    expect(verdict?.reason).toBe("excluded-category");
  });

  it("reports the reason the traveller can act on first", () => {
    // A day that also needs a ferry that is not running should say so, rather
    // than blaming a preference they cannot easily change their mind about.
    const verdict = themeInfeasibility(
      ISLANDS,
      base({ routeRuns: () => false, excludes: () => true }),
    );
    expect(verdict?.reason).toBe("route-out-of-season");
  });

  it("stays silent when nothing is excluded", () => {
    expect(themeInfeasibility(HISTORY, base())).toBeNull();
    expect(themeInfeasibility(ISLANDS, base())).toBeNull();
  });
});

/**
 * XXX-44 (Session 16) — the attribute under the category.
 *
 * Every assertion here states its PREMISE before its behaviour, per the
 * Session-14 lesson: five green tests once guarded a feature that fired zero
 * times, each one having early-returned past its own claim.
 */
describe("the drinking-focus signal", () => {
  it("FIRES on every declared prefix — none is dead", () => {
    // A rule asserts that a branch exists; assert it PER RULE, or a dead one
    // hides behind its live siblings. `Retail > … > Beer Store` matching
    // nothing would be the `Retail > Farmers Market` defect again.
    for (const prefix of DRINKING_LABEL_PREFIXES) {
      expect(drinkingFocusOf([prefix]), prefix).toBe("focused");
      expect(drinkingFocusOf([`${prefix} > Something`]), prefix).toBe("focused");
    }
  });

  it("catches the wine bar the CATEGORY gate cannot see", () => {
    // Clandestino's exact shape: mapped `restaurants`, labelled a bar.
    const labels = [
      "Dining and Drinking > Restaurant",
      "Dining and Drinking > Bar > Wine Bar",
    ];
    expect(drinkingFocusOf(labels)).toBe("focused");
    expect(isCategoryPermitted("restaurants", ["nightlife_bars"])).toBe(true);
    expect(isVenuePermitted("restaurants", "focused", ["nightlife_bars"])).toBe(
      false,
    );
  });

  it("does not over-capture on a prefix that merely shares a word", () => {
    // The punctuation is load-bearing, as it is in CATEGORY_BREADCRUMB_RULES:
    // "Bar" must not swallow "Barbecue Joint".
    expect(
      drinkingFocusOf(["Dining and Drinking > Restaurant > BBQ Joint"]),
    ).toBe("not-focused");
    expect(drinkingFocusOf(["Dining and Drinking > Barbecue"])).toBe(
      "not-focused",
    );
  });

  it("separates 'the directory says no' from 'we have no directory record'", () => {
    // not-focused is a positive Tier-2 observation; unknown is an absence.
    // Collapsing them is what makes an instrument lie about absence.
    expect(drinkingFocusOf(["Dining and Drinking > Restaurant"])).toBe(
      "not-focused",
    );
    expect(drinkingFocusOf([])).toBe("unknown");
  });

  it("risks the unknown and refuses the known — the ruled asymmetry", () => {
    expect(isVenuePermitted("restaurants", "unknown", ["nightlife_bars"])).toBe(
      true,
    );
    expect(
      isVenuePermitted("restaurants", "not-focused", ["nightlife_bars"]),
    ).toBe(true);
    expect(isVenuePermitted("restaurants", "focused", ["nightlife_bars"])).toBe(
      false,
    );
  });

  it("only applies the attribute test when ALCOHOL is what was refused", () => {
    // A traveller who excluded museums has said nothing about drinking, and a
    // day of theirs must be byte-identical to one from before this existed.
    expect(excludesAlcohol(["museums_galleries"])).toBe(false);
    expect(
      isVenuePermitted("restaurants", "focused", ["museums_galleries"]),
    ).toBe(true);
    expect(excludesAlcohol(["nightlife_bars"])).toBe(true);
  });

  it("owes the limitation notice only to a traveller who refused alcohol", () => {
    // Narrowed at XXX-44: this returned `excluded.length > 0`, so someone who
    // excluded only galleries was shown a paragraph about bars.
    expect(owesLimitationNotice([])).toBe(false);
    expect(owesLimitationNotice(["museums_galleries"])).toBe(false);
    expect(owesLimitationNotice(["nightlife_bars"])).toBe(true);
  });

  it("says what is still missing, and not what has been fixed", () => {
    // The old sentence apologised for wine bars slipping through. They no
    // longer do, and a caveat that has stopped being true is a silent limit.
    expect(CATEGORY_CONSTRAINT_LIMITATION).not.toMatch(/slip through/i);
    expect(CATEGORY_CONSTRAINT_LIMITATION).toMatch(/wine bars/i);
    expect(CATEGORY_CONSTRAINT_LIMITATION).toMatch(/pours/i);
  });
});

describe("the venue-level seam drops what the category seam cannot", () => {
  const candidate = (
    id: string,
    category: PlaceCategory,
    focus: "focused" | "not-focused" | null,
  ): Candidate => ({
    place: {
      id,
      name: id,
      neighborhood: "Old Town",
      coords: { lat: 43.65, lng: -79.37 },
      tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
      category: {
        status: "present",
        value: category,
        source: "fsq_os_places",
        tier: 2,
        fetchedAt: "2026-08-23T00:00:00-04:00",
      },
      ...(focus === null
        ? {}
        : {
            drinkingFocused: {
              status: "present" as const,
              value: focus === "focused",
              source: "fsq_os_places",
              tier: 2 as const,
              fetchedAt: "2026-08-23T00:00:00-04:00",
            },
          }),
    },
    category,
    googlePlaceId: null,
    rating: null,
    userRatingCount: null,
    cuisines: [],
    detailsFetched: false,
    score: 0,
  });

  const pool = [
    candidate("clandestino", "restaurants", "focused"),
    candidate("rasta-pasta", "restaurants", "not-focused"),
    candidate("lcbo", "grocery", "focused"),
    candidate("no-record", "restaurants", null),
    candidate("ruby-soho", "nightlife_bars", "focused"),
  ];

  it("PREMISE: the category gate alone would keep the wine bar and the LCBO", () => {
    // Without this premise the test below proves nothing — it would pass
    // just as well against a pool the category gate had already cleaned.
    const survivingCategoryGate = pool.filter((c) =>
      isCategoryPermitted(c.category, ["nightlife_bars"]),
    );
    expect(survivingCategoryGate.map((c) => c.place.id)).toEqual([
      "clandestino",
      "rasta-pasta",
      "lcbo",
      "no-record",
    ]);
  });

  it("FIRES: drops the labelled venues and keeps the rest", () => {
    const { kept, dropped } = excludeRefusedVenues(pool, ["nightlife_bars"]);
    expect(kept.map((c) => c.place.id)).toEqual(["rasta-pasta", "no-record"]);
    expect(dropped.map((d) => d.placeId)).toEqual([
      "clandestino",
      "lcbo",
      "ruby-soho",
    ]);
  });

  it("keeps the liquor store off a provisioning stop", () => {
    // Not decoration: the first live islands day provisioned at an LCBO, and
    // `grocery` is what an experience's `provisioning` draws from.
    const { kept } = excludeRefusedVenues(pool, ["nightlife_bars"]);
    expect(kept.some((c) => c.place.id === "lcbo")).toBe(false);
  });

  it("is byte-identical — the same array — for an unconstrained request", () => {
    const { kept, dropped } = excludeRefusedVenues(pool, []);
    expect(kept).toBe(pool);
    expect(dropped).toEqual([]);
  });
});

/**
 * XXX-47 (Session 16 CP2) — the backstop was never wired in.
 *
 * Session 15 shipped `constraint.excluded-category` described as *"the one
 * place that cannot be forgotten, because it sits after all of them and
 * rejects the day"*. The engine's only validation context never passed
 * `excludedCategories`, so `ctx.excludedCategories` was `null` on every
 * generation and the rule returned on its first line. It has never once been
 * able to reject a day.
 *
 * The 27-trap exam did not catch it because `contextFor` — the FIXTURE
 * context builder — does pass the field. Two context builders, one told and
 * one not: `support.ts`'s own comment anticipated this exact divergence and
 * named the opposite direction.
 *
 * `scripts/constraint-proof.ts` did not catch it either, and that is the
 * sharper lesson. Its assertion reads *"the grammar backstop did not need to
 * catch anything"* and treats silence as PASS. **A rule whose success
 * condition is silence cannot tell "it worked" from "it was never
 * connected."**
 *
 * These tests reproduce the defect at the seam, and the required parameter
 * makes the class of it a compile error rather than a silence.
 */
describe("the backstop reaches the engine's own context", () => {
  const barDay = () => {
    const trap = TRAP_FIXTURES.find((t) => t.key === "trap-excluded-category");
    if (trap === undefined) throw new Error("trap fixture missing");
    return trap.golden;
  };

  const engineShapedContext = (
    excludedCategories: readonly PlaceCategory[] | null,
  ): GrammarContext =>
    buildGrammarContext({
      // The exact argument list `generateDay` assembles, so this test fails
      // if the engine's call and this one ever drift apart in shape.
      environment: {
        // The real ephemeris, as the engine's own `fetchEnvironment` builds
        // it — the fixture's `DaylightTimes` is a narrower shape, and using
        // it here would make this context a different one from the engine's,
        // which is the exact divergence the test exists to catch.
        daylight: computeDaylight(barDay().day.city, barDay().day.date),
        windows: barDay().windows,
      },
      mealPattern: barDay().mealPattern!,
      persona: GOLDEN_PERSONAS["day-1-jays"]!,
      budgetBand: barDay().budgetBand,
      lodging: barDay().lodging,
      anchorBaseline: barDay().anchorBaseline,
      travel: new HaversineStubProvider(),
      transport: ["walk", "transit"],
      excludedCategories,
    });

  it("PREMISE: this day really does seat a bar", () => {
    // Without the premise the test below proves nothing — it would pass just
    // as well against a day with no bar in it.
    const day = barDay().day;
    const categories = Object.values(day.places).map((p) =>
      p.category?.status === "present" ? p.category.value : null,
    );
    expect(categories).toContain("nightlife_bars");
  });

  it("REPRODUCES the defect: an untold context passes the bar day", () => {
    const found = validateDay(barDay().day, engineShapedContext(null));
    expect(
      found.filter((v) => v.ruleId === "constraint.excluded-category"),
    ).toEqual([]);
  });

  it("FIXED: told the constraint, the same context rejects it", () => {
    const found = validateDay(
      barDay().day,
      engineShapedContext(["nightlife_bars"]),
    );
    const hit = found.find((v) => v.ruleId === "constraint.excluded-category");
    expect(hit?.severity).toBe("violation");
  });

  it("null still means UNKNOWN, not 'no constraints' — the transport precedent", () => {
    // The fix is that you can no longer reach `null` by saying nothing. The
    // meaning of `null` itself is unchanged, and must stay unchanged: a
    // context that was not told must not assert there were none.
    expect(engineShapedContext(null).excludedCategories).toBeNull();
    expect(engineShapedContext([]).excludedCategories).toEqual([]);
  });
});
