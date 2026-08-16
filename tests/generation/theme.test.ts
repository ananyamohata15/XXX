/**
 * The theme vocabulary and its invariants (XXX-40, Session 14).
 *
 * The `ARC_TEMPLATES` pattern: literal specs, asserted per row rather than
 * trusted. The composition rule of record — meals are connective tissue,
 * never the theme — is enforced here rather than only written down.
 */

import { describe, expect, it } from "vitest";
import {
  DAY_THEME_MODES,
  EXPERIENCE_SPECS,
  THEME_INVARIANTS,
  THEME_ZONES,
  THREAD_SPECS,
  VENUE_THEME,
  experienceSpec,
  themeId,
  themeZoneSlugs,
  threadSpec,
  type DayTheme,
} from "@/shared/theme";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { buildSkeleton } from "@/server/generation/compose";
import { COMPOSE_PARAMS } from "@/server/generation/compose-params";
import { GOLDEN_PERSONAS, gravityDominance } from "@/shared/persona";
import { haversineKm } from "@/shared/day-grammar/travel";
import { CATEGORY_FAMILY, PLACE_CATEGORIES } from "@/shared/vocabulary";

const DATE = "2026-08-15"; // a Saturday

describe("theme specs hold their invariants, per row", () => {
  it("no thread spine is built from a food category", () => {
    // Per SPEC and per CATEGORY. A set-level check ("some spine is clean")
    // passes forever on the one row that happens to be — CLAUDE.md's rule.
    for (const spec of THREAD_SPECS) {
      for (const category of spec.spine.categories) {
        expect(THEME_INVARIANTS.forbiddenCategories).not.toContain(category);
        expect(GRAMMAR_PARAMS.pacing.foodCategories).not.toContain(category);
      }
    }
  });

  it("no composite anchor is built from a food category", () => {
    for (const spec of EXPERIENCE_SPECS) {
      for (const category of spec.anchor.categories) {
        expect(THEME_INVARIANTS.forbiddenCategories).not.toContain(category);
        expect(GRAMMAR_PARAMS.pacing.foodCategories).not.toContain(category);
      }
    }
  });

  it("a thread spine is 2-3 stops — fewer is a venue day with extra words", () => {
    for (const spec of THREAD_SPECS) {
      expect(spec.spine.minStops).toBeGreaterThanOrEqual(
        THEME_INVARIANTS.threadMinStops,
      );
      expect(spec.spine.maxStops).toBeLessThanOrEqual(
        THEME_INVARIANTS.threadMaxStops,
      );
      expect(spec.spine.maxStops).toBeGreaterThanOrEqual(spec.spine.minStops);
      // A spine is same-family by construction — that is what makes it a
      // thread and what `pickContrast` structurally forbids for a venue day.
      const families = new Set(
        spec.spine.categories.map((c) => CATEGORY_FAMILY[c]),
      );
      expect(families.size).toBe(1);
    }
  });

  it("a composite block is genuinely multi-hour and BOUNDED by its spec", () => {
    for (const spec of EXPERIENCE_SPECS) {
      expect(spec.anchor.dwell.min).toBeGreaterThanOrEqual(
        THEME_INVARIANTS.compositeMinDwellMinutes,
      );
      // The owner-swap ruled at CP1: the spec governs instead of the category
      // table, and `dwell.overstay` fires against THIS max. Bounded by
      // curation, never unbounded.
      expect(spec.anchor.dwell.max).toBeGreaterThan(spec.anchor.dwell.min);
      expect(spec.anchor.microActivities.length).toBeGreaterThan(0);
    }
  });

  it("every spec category is in the vocabulary", () => {
    for (const spec of THREAD_SPECS) {
      for (const c of spec.spine.categories) expect(PLACE_CATEGORIES).toContain(c);
    }
    for (const spec of EXPERIENCE_SPECS) {
      for (const c of spec.anchor.categories) expect(PLACE_CATEGORIES).toContain(c);
      if (spec.provisioning !== undefined) {
        expect(PLACE_CATEGORIES).toContain(spec.provisioning.category);
      }
    }
  });

  it("every zone a spec names exists", () => {
    const slugs = new Set(THEME_ZONES.map((z) => z.slug));
    for (const spec of EXPERIENCE_SPECS) {
      for (const zone of spec.zones) expect(slugs).toContain(zone);
    }
    for (const spec of THREAD_SPECS) {
      for (const zone of spec.zones ?? []) expect(slugs).toContain(zone);
    }
  });
});

describe("the islands zone reaches what golden Day 7 needs", () => {
  /**
   * Pool coordinates measured at Session 14 CP0. The zone was drawn to reach
   * these; if someone shrinks the radius, this says which venue dies.
   */
  const ISLAND_IDENTITIES = [
    { name: "Toronto Islands", lat: 43.6221, lng: -79.3785 },
    { name: "Gibraltar Point Lighthouse", lat: 43.6136, lng: -79.3852 },
    { name: "Hanlan's Point Beach", lat: 43.6168, lng: -79.3919 },
    { name: "Ward's Island Willow Square", lat: 43.6313, lng: -79.3561 },
  ];

  it("covers every island identity the day names", () => {
    const zone = THEME_ZONES.find((z) => z.slug === "toronto_islands");
    expect(zone).toBeDefined();
    for (const place of ISLAND_IDENTITIES) {
      const km = haversineKm(
        { lat: place.lat, lng: place.lng },
        { lat: zone!.lat, lng: zone!.lng },
      );
      expect(km).toBeLessThanOrEqual(zone!.radiusM / 1000);
    }
  });
});

describe("theme identity and geography", () => {
  it("names every mode in the trace", () => {
    const themes: DayTheme[] = [
      VENUE_THEME,
      { mode: "thread", threadId: "history-of-toronto" },
      { mode: "experience", experienceId: "toronto-islands" },
    ];
    expect(themes.map(themeId)).toEqual([
      "venue",
      "thread:history-of-toronto",
      "experience:toronto-islands",
    ]);
    expect(themes.map((t) => t.mode).sort()).toEqual([...DAY_THEME_MODES].sort());
  });

  it("a venue theme has no geography of its own — the lens keeps it", () => {
    expect(themeZoneSlugs(VENUE_THEME)).toEqual([]);
  });

  it("an experience carries its own zones", () => {
    expect(
      themeZoneSlugs({ mode: "experience", experienceId: "toronto-islands" }),
    ).toEqual(["toronto_islands"]);
  });

  it("refuses an unknown id loudly rather than returning a default", () => {
    // Honest absence: a typo must not silently become a venue day.
    expect(() => threadSpec("nope" as never)).toThrow(/unknown thread/);
    expect(() => experienceSpec("nope" as never)).toThrow(/unknown experience/);
  });
});

/**
 * The family licence — one mechanism, two clients (XXX-40, Session 14 CP1).
 *
 * These pin the DEVIATION as much as the feature: the ruled affinity-margin
 * form was built, measured, and found to be a knife-edge with five of eight
 * personas sitting exactly on it. The count form replaced it.
 */
describe("persona intensity as a licence", () => {
  const dominanceOf = (key: string) =>
    gravityDominance(
      GOLDEN_PERSONAS[key],
      PLACE_CATEGORIES,
      (c) => CATEGORY_FAMILY[c],
      COMPOSE_PARAMS.persona.dominantFamilyPositions,
    );

  it("fires for the concentrated travellers and nobody else", () => {
    // Measured, not chosen: these three have two or more stated interests
    // pointing into one texture. The other five have one.
    const licensed = Object.keys(GOLDEN_PERSONAS).filter(
      (k) => dominanceOf(k).dominant,
    );
    expect(licensed.sort()).toEqual([
      "day-3-winter",
      "persona-scenic",
      "persona-shopper",
    ]);
  });

  it("names the founder's own example — the shopper", () => {
    const shopper = dominanceOf("persona-shopper");
    expect(shopper.category).toBe("shopping");
    expect(shopper.positionsInFamily).toBe(2); // shopping + local_life
    expect(shopper.dominant).toBe(true);
  });

  it("has no knife-edge — the reason the ruled margin form was replaced", () => {
    // The defect this design avoids: with the affinity-margin form, FIVE of
    // eight personas measured exactly 0.400, so `>=` vs `>` decided whether
    // the licence fired for seven of eight or for two. A count over 0..3
    // cannot land between two adjacent values.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const d = dominanceOf(key);
      expect(Number.isInteger(d.positionsInFamily)).toBe(true);
      expect(d.positionsInFamily).toBeLessThanOrEqual(3);
    }
    const threshold = COMPOSE_PARAMS.persona.dominantFamilyPositions;
    expect(Number.isInteger(threshold)).toBe(true);
  });

  it("cannot license a day below the texture floor", () => {
    // The licence is a BOOKEND, not an alternation. The first build left this
    // to the validator and the skeleton invariant caught it within one run:
    // persona-scenic came back with two families. Now the composer refuses to
    // license a close until the day already holds three textures.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const persona = GOLDEN_PERSONAS[key];
      const skeleton = buildSkeleton(
        {
          city: "toronto",
          date: DATE,
          persona,
          budgetBand: null,
          transport: ["walk", "transit"],
          seed: 42,
        },
        { seed: 42 },
      );
      const families = new Set(
        skeleton.intents.map((i) => CATEGORY_FAMILY[i.categories[0]]),
      );
      expect(families.size, key).toBeGreaterThanOrEqual(
        GRAMMAR_PARAMS.pacing.minTextureFamilies,
      );
    }
  });
});
