/**
 * The theme vocabulary and its invariants (XXX-40, Session 14).
 *
 * The `ARC_TEMPLATES` pattern: literal specs, asserted per row rather than
 * trusted. The composition rule of record — meals are connective tissue,
 * never the theme — is enforced here rather than only written down.
 */

import { describe, expect, it } from "vitest";
import { DISTRICTS } from "@/shared/districts";
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
import { holdsAThread, templatesHolding } from "@/server/generation/arc";
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
    // A theme may draw from a hand-drawn THEME_ZONE (the islands) or from a
    // district (a zone day). Both are real geography; an unknown slug is a
    // typo in a spec, and `zonesFor` throws on one rather than silently
    // handing back the lens's zones and building a mainland island day.
    const slugs = new Set([
      ...THEME_ZONES.map((z) => z.slug),
      ...DISTRICTS.map((d) => d.slug),
    ]);
    for (const spec of EXPERIENCE_SPECS) {
      for (const zone of spec.zones ?? []) expect(slugs).toContain(zone);
    }
    for (const spec of THREAD_SPECS) {
      for (const zone of spec.zones ?? []) expect(slugs).toContain(zone);
    }
  });

  it("an experience with NO zones is a real state, not an oversight", () => {
    // The picnic's whole structural change. If every spec grew a zone list
    // again, `themeZoneSlugs`'s `?? []` would be dead code and the fallback
    // path would rot untested — which is how a branch stops working without
    // anyone noticing.
    const unbound = EXPERIENCE_SPECS.filter((s) => s.zones === undefined);
    expect(unbound.map((s) => s.id)).toContain("park-picnic");
    for (const spec of unbound) {
      expect(themeZoneSlugs({ mode: "experience", experienceId: spec.id })).toEqual([]);
    }
  });

  it("a picnic needs no timetable, and that is what makes it the second tenant", () => {
    const picnic = EXPERIENCE_SPECS.find((s) => s.id === "park-picnic");
    expect(picnic?.legs).toBeUndefined();
    // The causality the islands spec proved, on a day with no crossing.
    expect(picnic?.provisioning?.category).toBe("grocery");
    expect(picnic?.absorbsMeals).toBe(1);
    expect(picnic?.requiresGoodWeather).toBe(true);
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
      { mode: "experience", experienceId: "park-picnic" },
      { mode: "zone", zoneSlug: "yorkville" },
    ];
    expect(themes.map(themeId)).toEqual([
      "venue",
      "thread:history-of-toronto",
      "experience:toronto-islands",
      "experience:park-picnic",
      "zone:yorkville",
    ]);
    // EVERY mode must be nameable in a trace — a day whose theme the record
    // cannot name is the attribution defect XXX-43 fixed for personas.
    expect([...new Set(themes.map((t) => t.mode))].sort()).toEqual(
      [...DAY_THEME_MODES].sort(),
    );
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

/**
 * THE THREAD EXAM (XXX-40, Session 14 Step 2).
 *
 * Mechanical this session, per the brief: golden day 8 is founder-drafted
 * later via the bootstrap, so the AC here is structural rather than a
 * comparison against a verified document.
 */
describe("a thread day is a spine, not a venue day with a label", () => {
  const HISTORY: DayTheme = { mode: "thread", threadId: "history-of-toronto" };
  const threadSkeleton = (personaKey: string) =>
    buildSkeleton(
      {
        city: "toronto",
        date: DATE,
        persona: GOLDEN_PERSONAS[personaKey],
        budgetBand: null,
        transport: ["walk", "transit"],
        seed: 42,
      },
      { seed: 42, theme: HISTORY },
    );

  it("puts the spine in 2-3 discretionary positions, for EVERY persona", () => {
    // Per persona, not one sample. Measured before the template restriction
    // landed: `relaxed-a` has no contrast step, so day-3-winter and
    // persona-scenic drew a "history tour" whose whole tour was one historic
    // site — the exact shape the founder ruled cannot carry a day. A
    // single-persona check would have passed straight through it.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const persona = GOLDEN_PERSONAS[key];
      // A wanderer cannot hold a thread and says so — see below. Asserting a
      // good spine for one would be asserting a shape we deliberately refuse
      // to fabricate.
      if (templatesHolding(persona, holdsAThread).length === 0) continue;
      const spine = threadSkeleton(key).intents.filter(
        (i) => i.role === "anchor" || i.role === "contrast",
      );
      expect(spine.length, key).toBeGreaterThanOrEqual(
        THEME_INVARIANTS.threadMinStops,
      );
      expect(spine.length, key).toBeLessThanOrEqual(
        THEME_INVARIANTS.threadMaxStops,
      );
    }
  });

  it("draws the spine from the thread's own categories", () => {
    const built = threadSkeleton("day-2-old-town");
    const spine = built.intents.filter(
      (i) => i.role === "anchor" || i.role === "contrast",
    );
    expect(spine.length).toBeGreaterThanOrEqual(2);
    expect(spine.length).toBeLessThanOrEqual(3);
    for (const stop of spine) {
      expect(stop.categories).toEqual(["historic_sites", "museums_galleries"]);
    }
  });

  it("elects no venue anchor — the narrative IS the anchor", () => {
    // The founder's ruling: a single historic site cannot carry a day, but a
    // history tour of Toronto can.
    expect(threadSkeleton("day-2-old-town").electedAnchor).toBeNull();
  });

  it("interleaves meals exactly as an ordinary day does", () => {
    const built = threadSkeleton("day-2-old-town");
    const meals = built.intents.filter((i) => i.kind === "meal");
    expect(meals.length).toBeGreaterThanOrEqual(2);
    // Connective tissue: a meal never sits in the spine.
    for (const meal of meals) {
      expect(meal.role).toBe("meal");
      expect(meal.categories).not.toContain("historic_sites");
    }
  });

  it("deliberately repeats the spine's family — the rule threads exist to break", () => {
    // `pickContrast` structurally forbids a second stop in the anchor's
    // family, which is right for a venue day and is exactly what makes a
    // thread need its own machinery.
    const built = threadSkeleton("day-2-old-town");
    const spineFamilies = built.intents
      .filter((i) => i.role === "anchor" || i.role === "contrast")
      .map((i) => CATEGORY_FAMILY[i.categories[0]]);
    expect(new Set(spineFamilies).size).toBe(1);
    expect(spineFamilies[0]).toBe("culture");
  });

  it("refuses a thread for a wanderer instead of faking a one-stop tour", () => {
    // Measured, not assumed: NO wanderer template carries a `contrast` step,
    // because the CP1 ruling gave wanderers three intents and negative
    // space. A 2-3 stop scheduled spine is in tension with that shape by
    // design, so the honest answer is infeasible — not a "history tour" that
    // visits one historic site.
    expect(
      templatesHolding(GOLDEN_PERSONAS["day-5-wanderer"], holdsAThread),
    ).toHaveLength(0);
    // And every scheduler CAN hold one.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const persona = GOLDEN_PERSONAS[key];
      if (persona.structure === "wanderer") continue;
      expect(templatesHolding(persona, holdsAThread).length, key).toBeGreaterThan(0);
    }
  });

  it("still holds the day's texture floor overall", () => {
    // The spine repeats a family ON PURPOSE; the finished day must still have
    // three textures, which the meals and the close supply.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      if (templatesHolding(GOLDEN_PERSONAS[key], holdsAThread).length === 0) {
        continue;
      }
      const families = new Set(
        threadSkeleton(key).intents.map((i) => CATEGORY_FAMILY[i.categories[0]]),
      );
      // Measured across all eight: three or four. Asserted at the real
      // floor rather than a defensive one — a weakened assertion is a test
      // that stops noticing.
      expect(families.size, key).toBeGreaterThanOrEqual(
        GRAMMAR_PARAMS.pacing.minTextureFamilies,
      );
    }
  });
});

/**
 * THE VENUE BYTE-IDENTITY AC (XXX-40, Session 14 CP1 §1.1).
 *
 * The theme layer must not have changed themeless days. This is the
 * regression that proves it, and it is written as an equality on the whole
 * skeleton rather than on a few fields — a spot-check would pass while a
 * field nobody thought of drifted.
 */
describe("a venue day is byte-identical to a themeless day", () => {
  it("holds for every exam persona", () => {
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const request = {
        city: "toronto" as const,
        date: DATE,
        persona: GOLDEN_PERSONAS[key],
        budgetBand: null,
        transport: ["walk" as const, "transit" as const],
        seed: 42,
      };
      const themeless = buildSkeleton(request, { seed: 42 });
      const explicit = buildSkeleton(request, { seed: 42, theme: VENUE_THEME });
      expect(JSON.stringify(explicit), key).toBe(JSON.stringify(themeless));
    }
  });
});

/**
 * THE ANCHORLESS-DAY TRAP, through the THEME door (XXX-40, Session 14 Step 3
 * ruling 4).
 *
 * Session 11's defect: the matrix lost its anchor in 3 of 6 days and every
 * one still returned status "ok". The founder's words are on the record
 * twice — *"the day isnt anchored on anything"*.
 *
 * It came back in Session 14 because both guards asked about the ELECTION
 * RECORD (`skeleton.electedAnchor !== null`), and a themed day has none by
 * design. The first live islands generation shipped without its composite
 * block, reporting *"This day holds up — 8 notes."*
 *
 * The rule this pins: **a guard asks about the DAY, never about the record
 * of how the day was decided.** There must not be a third visit.
 */
describe("the anchorless-day trap, through the theme door", () => {
  it("a themed skeleton has NO elected anchor — the state the guards missed", () => {
    for (const theme of [
      { mode: "thread", threadId: "history-of-toronto" } as const,
      { mode: "experience", experienceId: "toronto-islands" } as const,
    ]) {
      const built = buildSkeleton(
        {
          city: "toronto",
          date: DATE,
          persona: GOLDEN_PERSONAS["day-2-old-town"],
          budgetBand: null,
          transport: ["walk", "transit"],
          seed: 42,
        },
        { seed: 42, theme },
      );
      // null here is CORRECT — the theme owns the centre. What was wrong was
      // reading it as "this day needs no centre".
      expect(built.electedAnchor).toBeNull();
      // ...and the day still HAS an anchor intent, which is the thing a
      // guard must actually look at.
      expect(built.intents.some((i) => i.role === "anchor")).toBe(true);
    }
  });

  it("an experience block is sized to run through the day, with room to arrive", () => {
    // Both halves of ruling 3. The first live run had a 240-minute window for
    // a 240-minute dwell: the only legal start was its first minute, and the
    // provisioning stop before it ended one minute later.
    const built = buildSkeleton(
      {
        city: "toronto",
        date: "2026-07-18",
        persona: {
          pace: "relaxed",
          gravity: ["nature", "food", "local_life"],
          foodCourage: "adventurous",
          structure: "scheduler",
          lens: "corners",
        },
        budgetBand: { min: 0, max: 140, currency: "CAD" },
        transport: ["walk", "transit"],
        seed: 42,
      },
      { seed: 42, theme: { mode: "experience", experienceId: "toronto-islands" } },
    );
    const anchor = built.intents.find((i) => i.role === "anchor")!;
    const windowMinutes = anchor.window.end - anchor.window.start;
    // The block dominates the day rather than fitting between two meals.
    expect(anchor.dwellMinutes).toBeGreaterThanOrEqual(360); // 6h+
    // And its window is strictly larger than its dwell, so it can be REACHED.
    expect(windowMinutes).toBeGreaterThan(anchor.dwellMinutes);
  });

  it("absorbs the middle meal — the picnic is lunch", () => {
    // Ruling 2. The remaining meals are the one before the block and the one
    // after it; the provisioning stop is the absorbed meal's evidence.
    const built = buildSkeleton(
      {
        city: "toronto",
        date: "2026-07-18",
        persona: {
          pace: "relaxed",
          gravity: ["nature", "food", "local_life"],
          foodCourage: "adventurous",
          structure: "scheduler",
          lens: "corners",
        },
        budgetBand: null,
        transport: ["walk", "transit"],
        seed: 42,
      },
      { seed: 42, theme: { mode: "experience", experienceId: "toronto-islands" } },
    );
    const meals = built.intents.filter((i) => i.kind === "meal");
    expect(meals.map((m) => m.label)).toEqual(["breakfast", "dinner"]);
    expect(built.intents.some((i) => i.role === "provision")).toBe(true);
  });
});
