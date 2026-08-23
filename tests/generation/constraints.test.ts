import { describe, expect, it } from "vitest";
import { buildSkeleton } from "@/server/generation/compose";
import {
  themeInfeasibility,
  themeSpineCategories,
  type ThemeFeasibilityInput,
} from "@/server/generation/theme-select";
import type { GenerationRequest } from "@/server/generation/types";
import {
  isCategoryPermitted,
  isFullyExcluded,
  permittedCategories,
} from "@/shared/constraints";
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
