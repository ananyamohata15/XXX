/**
 * The arc, the anchor election, and the seat-choice objective (XXX-35).
 *
 * These are the Tier-1 fixture tests for the three things Session 11 built
 * into composition. They exist because the founder's two recorded verdicts
 * name failures that no rule could see: a day with no centre, a day whose
 * free time was residue, and lunch pinned to a window's opening edge.
 */

import { describe, expect, it } from "vitest";
import {
  ARC_TEMPLATES,
  TEMPLATE_INVARIANTS,
  electAnchor,
  pickContrast,
  pickTemplate,
  templatesFor,
} from "@/server/generation/arc";
import {
  buildSkeleton,
  composeDay,
  seatCost,
  type ComposeInput,
} from "@/server/generation/compose";
import { COMPOSE_PARAMS } from "@/server/generation/compose-params";
import type { Candidate, GenerationRequest, Selection } from "@/server/generation/types";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { present } from "@/shared/fixtures/golden/support";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { timeToMinutes } from "@/shared/time";
import { CATEGORY_FAMILY, TIERS, type PlaceCategory } from "@/shared/vocabulary";

const DATE = "2026-09-19"; // a Saturday

const request = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  city: "toronto",
  date: DATE,
  persona: GOLDEN_PERSONAS["day-2-old-town"],
  budgetBand: null,
  transport: ["walk", "transit"],
  seed: 42,
  ...over,
});

describe("arc templates are a grammar of shapes", () => {
  it.each(ARC_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s holds every template invariant",
    (_id, template) => {
      const anchors = template.steps.filter((s) => s === "anchor").length;
      expect(anchors).toBe(TEMPLATE_INVARIANTS.anchorCount);

      expect(template.steps[template.steps.length - 1]).toBe(
        TEMPLATE_INVARIANTS.lastStep,
      );

      // "2hrs free → meal" is the ending the founder rejected. No template
      // may be able to express it.
      expect(template.steps[template.steps.length - 2]).not.toBe("open");

      const meals = template.steps.filter((s) => s === "meal").length;
      expect(meals).toBeGreaterThanOrEqual(
        template.structure === "wanderer"
          ? TEMPLATE_INVARIANTS.minMealStepsWanderer
          : TEMPLATE_INVARIANTS.minMealStepsScheduler,
      );
    },
  );

  it("offers more than one shape per persona — the homogenization guard", () => {
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      expect(templatesFor(GOLDEN_PERSONAS[key]).length).toBeGreaterThan(1);
    }
  });

  it("varies the shape by seed, and is deterministic within a seed", () => {
    const persona = GOLDEN_PERSONAS["day-2-old-town"];
    expect(pickTemplate(persona, 42).id).toBe(pickTemplate(persona, 42).id);
    const shapes = new Set(
      Array.from({ length: 12 }, (_, i) => pickTemplate(persona, i).id),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });
});

describe("anchor election", () => {
  it("elects the persona's first interest, never a meal", () => {
    expect(electAnchor(GOLDEN_PERSONAS["day-3-winter"]).category).toBe(
      "museums_galleries", // art-first
    );
    expect(electAnchor(GOLDEN_PERSONAS["day-6-excursion"]).category).toBe(
      "parks", // nature-first
    );
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const elected = electAnchor(GOLDEN_PERSONAS[key]);
      expect(
        GRAMMAR_PARAMS.pacing.foodCategories.includes(elected.category),
      ).toBe(false);
    }
  });

  it("labels itself Tier 3 and names its elector", () => {
    const skeleton = buildSkeleton(request());
    expect(skeleton.electedAnchor).not.toBeNull();
    expect(skeleton.electedAnchor!.tier).toBe(TIERS.judgment);
    expect(skeleton.electedAnchor!.source).toBe("arc_elector_v1");
    expect(skeleton.electedAnchor!.reason.length).toBeGreaterThan(10);
  });

  it("is PRE-EMPTED by a user anchor — the day already has a centre", () => {
    const skeleton = buildSkeleton(
      request({
        anchors: [
          {
            label: "Jays game",
            coords: { lat: 43.6414, lng: -79.3894 },
            startTime: "18:30",
            endTime: "22:00",
            highCrowd: true,
          },
        ],
      }),
    );
    expect(skeleton.electedAnchor).toBeNull();
  });

  it("every persona and seed still produces exactly one anchor intent", () => {
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      for (const seed of [0, 1, 7, 42, 1234]) {
        const skeleton = buildSkeleton(
          request({ persona: GOLDEN_PERSONAS[key], seed }),
        );
        const anchors = skeleton.intents.filter((i) => i.role === "anchor");
        expect(
          anchors.length,
          `${key} seed=${seed} template=${skeleton.templateId}`,
        ).toBe(1);
      }
    }
  });

  it("never drops the anchor, whatever the template did to its slice", () => {
    // The first draft of buildSkeleton lost the centrepiece whenever a
    // template placed it in a segment too short to hold it, while the trace
    // still claimed one was elected. That is the un-anchored day the
    // founder rejected, delivered silently.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      for (const seed of [0, 3, 11, 42, 99, 512]) {
        const skeleton = buildSkeleton(
          request({ persona: GOLDEN_PERSONAS[key], seed }),
        );
        expect(
          skeleton.droppedSteps.map((d) => d.step),
          `${key} seed=${seed}`,
        ).not.toContain("anchor");
      }
    }
  });
});

describe("texture: contrast never repeats the anchor's family", () => {
  it("picks a different family from the anchor", () => {
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const persona = GOLDEN_PERSONAS[key];
      const anchor = electAnchor(persona).category;
      const contrast = pickContrast(
        persona,
        anchor,
        new Set([CATEGORY_FAMILY[anchor]]),
      );
      if (contrast === null) continue;
      expect(CATEGORY_FAMILY[contrast]).not.toBe(CATEGORY_FAMILY[anchor]);
    }
  });

  it("does not hand a daytime slot to a bar on an affinity tie", () => {
    // day-2's persona has zero affinity for both parks and nightlife, and
    // alphabetical order used to give 14:20 to `nightlife_bars`.
    const persona = GOLDEN_PERSONAS["day-2-old-town"];
    const pick = pickContrast(persona, "historic_sites", new Set(["culture", "market"]));
    expect(pick).toBe("parks");
  });

  it("skeletons keep at least three texture families where the day allows", () => {
    // The rule that rejects A-B-A-B only fires below three families, so the
    // arc must actually reach three or the rule is doing nothing.
    for (const key of Object.keys(GOLDEN_PERSONAS)) {
      const skeleton = buildSkeleton(request({ persona: GOLDEN_PERSONAS[key] }));
      const families = new Set(
        skeleton.intents.map((i) => CATEGORY_FAMILY[i.categories[0]]),
      );
      expect(families.size, `${key}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("free time is placed, not residue", () => {
  it("reserves its minutes so the next stop is pushed later on purpose", () => {
    const skeleton = buildSkeleton(
      request({ persona: GOLDEN_PERSONAS["day-3-winter"], seed: 5 }),
    );
    // Not every template carries an open step; the ones that do must place
    // it after a real intent, never as a trailing nothing.
    for (const open of skeleton.opens) {
      expect(open.minutes).toBeGreaterThan(0);
      if (open.afterIntentId !== null) {
        expect(skeleton.intents.map((i) => i.id)).toContain(open.afterIntentId);
      }
    }
  });
});

describe("seat-choice objective", () => {
  const window = { start: timeToMinutes("11:30"), end: timeToMinutes("14:30") };

  it("prefers the window's centre over its opening edge", () => {
    const edge = seatCost({
      start: window.start,
      dwell: 60,
      arrival: window.start,
      window,
      latestEnd: window.end,
    });
    const centred = seatCost({
      start: timeToMinutes("12:45"),
      dwell: 60,
      arrival: window.start,
      window,
      latestEnd: window.end,
    });
    // The founder's complaint, as an inequality: an 11:30 lunch must cost
    // more than a 12:45 one when both are legal and reachable.
    expect(centred).toBeLessThan(edge);
  });

  it("prices waiting, so centering cannot manufacture dead time", () => {
    // Arriving AT the centre, the centre is free. Arriving at the window's
    // open, reaching the centre costs 75 minutes of standing around — and
    // the idle term is what stops the composer buying it at any price.
    const arriveEarly = seatCost({
      start: timeToMinutes("12:45"),
      dwell: 60,
      arrival: window.start,
      window,
      latestEnd: window.end,
    });
    const arriveLate = seatCost({
      start: timeToMinutes("12:45"),
      dwell: 60,
      arrival: timeToMinutes("12:45"),
      window,
      latestEnd: window.end,
    });
    expect(arriveLate).toBeLessThan(arriveEarly);
    expect(COMPOSE_PARAMS.seating.wIdle).toBeGreaterThan(0);
  });

  it("penalizes eating the tail a later stop needs", () => {
    const early = seatCost({
      start: timeToMinutes("12:00"),
      dwell: 60,
      arrival: timeToMinutes("12:00"),
      window,
      latestEnd: window.end,
    });
    const late = seatCost({
      start: timeToMinutes("13:30"),
      dwell: 60,
      arrival: timeToMinutes("13:30"),
      window,
      latestEnd: window.end,
    });
    expect(late).toBeGreaterThan(early);
  });

  it("is pure: identical inputs give an identical number", () => {
    const input = {
      start: timeToMinutes("12:35"),
      dwell: 75,
      arrival: timeToMinutes("11:50"),
      window,
      latestEnd: window.end,
    };
    expect(seatCost(input)).toBe(seatCost(input));
  });
});

describe("seating moves meals off the window edge (the A/B, on fixtures)", () => {
  const candidate = (
    id: string,
    category: PlaceCategory,
    lat: number,
    lng: number,
  ): Candidate => ({
    place: {
      id,
      name: id,
      neighborhood: "Test",
      coords: { lat, lng },
      tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
      category: present(category, "concierge", TIERS.observed),
      hours: present(
        {
          sunday: [{ open: "07:00", close: "23:00" }],
          monday: [{ open: "07:00", close: "23:00" }],
          tuesday: [{ open: "07:00", close: "23:00" }],
          wednesday: [{ open: "07:00", close: "23:00" }],
          thursday: [{ open: "07:00", close: "23:00" }],
          friday: [{ open: "07:00", close: "23:00" }],
          saturday: [{ open: "07:00", close: "23:00" }],
        },
        "google_places",
        TIERS.verified,
      ),
      businessStatus: present("operational", "google_places", TIERS.verified),
    },
    category,
    googlePlaceId: null,
    rating: null,
    userRatingCount: null,
    detailsFetched: false,
    score: 1,
  });

  const pool = [
    candidate("cafe1", "cafes", 43.6532, -79.3832),
    candidate("market1", "markets", 43.6487, -79.3716),
    candidate("historic1", "historic_sites", 43.648, -79.3745),
    candidate("museum1", "museums_galleries", 43.6677, -79.3948),
    candidate("park1", "parks", 43.6465, -79.3733),
    candidate("bar1", "nightlife_bars", 43.6445, -79.4),
    candidate("resto1", "restaurants", 43.6503, -79.3592),
    candidate("resto2", "restaurants", 43.6531, -79.367),
  ];
  const byId = new Map(pool.map((c) => [c.place.id, c]));

  function compose(legacy: boolean) {
    const req = request();
    const skeleton = buildSkeleton(req);
    const used = new Set<string>();
    const selections: Selection[] = [];
    for (const intent of skeleton.intents) {
      const pick = pool.find(
        (c) => intent.categories.includes(c.category) && !used.has(c.place.id),
      );
      if (pick) {
        used.add(pick.place.id);
        selections.push({ intentId: intent.id, placeId: pick.place.id });
      }
    }
    const input: ComposeInput = {
      request: req,
      skeleton,
      selections,
      candidatesById: byId,
      travel: new HaversineStubProvider(),
      outdoorLatestEnd: timeToMinutes("20:30"),
      seatingLegacyEarliest: legacy,
    };
    return { composed: composeDay(input), skeleton };
  }

  it("seats meals nearer their window centres than the old composer did", () => {
    const legacy = compose(true);
    const objective = compose(false);

    const deviation = (
      composed: ReturnType<typeof compose>,
    ): number => {
      const windows = new Map(
        composed.skeleton.intents.map((i) => [`s-${i.id}`, i]),
      );
      const meals = composed.composed.day.slots.filter((s) => s.kind === "meal");
      let total = 0;
      for (const slot of meals) {
        const intent = windows.get(slot.id);
        if (intent === undefined) continue;
        const centre = (intent.window.start + intent.window.end) / 2;
        const mid =
          (timeToMinutes(slot.startTime) + timeToMinutes(slot.endTime)) / 2;
        total += Math.abs(mid - centre);
      }
      return total / Math.max(1, meals.length);
    };

    expect(deviation(objective)).toBeLessThan(deviation(legacy));
  });

  it("the legacy seam reproduces earliest-legal seating exactly", () => {
    // Without this the A/B histograms would be comparing the new composer
    // to a guess about the old one.
    const legacy = compose(true);
    for (const slot of legacy.composed.day.slots) {
      const intent = legacy.skeleton.intents.find(
        (i) => `s-${i.id}` === slot.id,
      );
      if (intent === undefined) continue;
      // Earliest legal is either the window's open or the arrival, snapped.
      expect(timeToMinutes(slot.startTime)).toBeLessThanOrEqual(
        (intent.window.start + intent.window.end) / 2,
      );
    }
  });
});
