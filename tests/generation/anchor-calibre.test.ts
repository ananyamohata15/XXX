/**
 * Anchor calibre (XXX-35, Session 13 Step 2 — Session 12 mining finding 1).
 *
 * The founder's verdict: *"An anchor that lasts only 20 mins? The anchor
 * should be a highlight, not just anything random."*
 *
 * Session 12 named one mechanism — `dwellMinutes[c].min` doing double duty
 * as the grammar floor AND the composer's drop floor. Measuring it in
 * Session 13 found a second and larger one: the anchor took
 * `dwellMinutes[c].typical`, the dwell of an ORDINARY stop of that category.
 * A nature-first persona therefore drew a 60-minute centre in 200 of 200
 * skeletons — not because a window was tight, but because `parks.typical`
 * is 60 and that was the ceiling.
 *
 * These tests pin both floors apart and assert the centre is sized as a
 * centre.
 */

import { describe, expect, it } from "vitest";
import { anchorDwellFor, electAnchor } from "@/server/generation/arc";
import { buildSkeleton } from "@/server/generation/compose";
import { COMPOSE_PARAMS } from "@/server/generation/compose-params";
import { resolveSeed } from "@/server/generation/engine";
import type { GenerationRequest } from "@/server/generation/types";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { PLACE_CATEGORIES, type PlaceCategory } from "@/shared/vocabulary";

const DATE = "2026-09-19"; // a Saturday
const FLOOR = COMPOSE_PARAMS.anchor.minDwellMinutes;

const request = (
  over: Partial<GenerationRequest> = {},
): GenerationRequest & { seed: number } => ({
  city: "toronto",
  date: DATE,
  persona: GOLDEN_PERSONAS["day-6-excursion"],
  budgetBand: null,
  transport: ["walk", "transit"],
  seed: 42,
  ...over,
});

/** The categories an anchor may actually be elected from. */
const ELECTABLE = PLACE_CATEGORIES.filter(
  (c) => !GRAMMAR_PARAMS.pacing.foodCategories.includes(c),
);

describe("the two floors are two numbers", () => {
  it("anchor calibre is strictly above every category's grammar floor", () => {
    // If it were not, the split would be decorative: the grammar floor would
    // still be the only thing binding, which is the defect.
    for (const category of PLACE_CATEGORIES) {
      expect(
        FLOOR,
        `${category}.min=${GRAMMAR_PARAMS.dwellMinutes[category].min}`,
      ).toBeGreaterThan(GRAMMAR_PARAMS.dwellMinutes[category].min);
    }
  });

  it("a grammar floor still answers its own question, unchanged", () => {
    // The split must not have moved the grammar. A 20-minute park visit is
    // still a legal stop; it is just not a centrepiece.
    expect(GRAMMAR_PARAMS.dwellMinutes.parks.min).toBe(20);
    expect(GRAMMAR_PARAMS.dwellMinutes.restaurants.min).toBe(45);
  });
});

describe("a centrepiece is sized as a centrepiece", () => {
  it.each(ELECTABLE)("%s gets at least anchor calibre", (category) => {
    expect(anchorDwellFor(category)).toBeGreaterThanOrEqual(FLOOR);
  });

  it.each(ELECTABLE)(
    "%s never exceeds its own grammar maximum",
    (category) => {
      // The grammar still owns the ceiling. This only stops the centre from
      // being sized like an ordinary stop.
      expect(anchorDwellFor(category)).toBeLessThanOrEqual(
        GRAMMAR_PARAMS.dwellMinutes[category].max,
      );
    },
  );

  it("raises exactly the categories that were under-served, and no others", () => {
    // The shape a fix should have: it moves what was wrong and leaves the
    // rest alone. parks was the one the founder actually hit.
    const moved: PlaceCategory[] = [];
    for (const category of ELECTABLE) {
      if (
        anchorDwellFor(category) !==
        GRAMMAR_PARAMS.dwellMinutes[category].typical
      ) {
        moved.push(category);
      }
    }
    expect(moved).toEqual(["parks"]);
    expect(GRAMMAR_PARAMS.dwellMinutes.parks.typical).toBe(60);
    expect(anchorDwellFor("parks")).toBe(FLOOR);
  });

  it("elects an anchor whose dwell clears calibre, for every persona", () => {
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const elected = electAnchor(GOLDEN_PERSONAS[key], {
        dice: () => 0.5,
      });
      expect(elected, key).not.toBeNull();
      expect(elected!.dwellMinutes, `${key} → ${elected!.category}`).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

describe("no day seats a centre below calibre in silence", () => {
  it("every golden persona composes a centre of at least calibre", () => {
    // The regression that matters: this is the measurement that found the
    // 60-minute nature anchor, run as an assertion.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      for (let seed = 0; seed < 40; seed += 1) {
        const req = request({ persona: GOLDEN_PERSONAS[key], seed });
        const skeleton = buildSkeleton(req, { seed: resolveSeed(req) });
        const anchor = skeleton.intents.find((i) => i.role === "anchor");
        if (anchor === undefined) continue;
        expect(
          anchor.dwellMinutes,
          `${key} seed=${seed} template=${skeleton.templateId} category=${anchor.categories[0]}`,
        ).toBeGreaterThanOrEqual(FLOOR);
        expect(skeleton.anchorDegraded, `${key} seed=${seed}`).toBeNull();
      }
    }
  });

  it("reports a degraded centre rather than seating it quietly", () => {
    // A day squeezed into a span too short to hold a centrepiece. The old
    // composer fitted the anchor down to the CATEGORY floor and seated it
    // with no record anywhere; the new one has to say so.
    const req = request({ dayStart: "12:00", dayEnd: "15:00" });
    const skeleton = buildSkeleton(req, { seed: resolveSeed(req) });
    const anchor = skeleton.intents.find((i) => i.role === "anchor");
    if (anchor !== undefined && anchor.dwellMinutes < FLOOR) {
      expect(skeleton.anchorDegraded).not.toBeNull();
      expect(skeleton.anchorDegraded!.fittedMinutes).toBe(anchor.dwellMinutes);
      expect(skeleton.anchorDegraded!.floorMinutes).toBe(FLOOR);
    }
  });

  it("keeps a centre rather than dropping one — anchorless is worse", () => {
    // Degrading is reported, never resolved by deleting the day's centre.
    // "The day isnt anchored on anything" is the verdict this must not cause.
    const req = request({ dayStart: "12:00", dayEnd: "15:00" });
    const skeleton = buildSkeleton(req, { seed: resolveSeed(req) });
    expect(skeleton.droppedSteps.map((d) => d.step)).not.toContain("anchor");
  });
});
