/**
 * The post-selection coherence pass (XXX-47, Session 16 CP2).
 *
 * Driven with a FAKE `evaluate`, so every property below is asserted without
 * a database, a pool or a travel matrix: the pass's contract is about moves
 * and thresholds, and testing it through a real compose would test the
 * composer instead.
 *
 * Each test states its premise before its behaviour. A pass that made no
 * moves would satisfy half of these vacuously, which is exactly the shape
 * Session 14's rest stop passed five tests in.
 */

import { describe, expect, it } from "vitest";
import { improveCoherence } from "@/server/generation/coherence";
import type { Candidate, Menu, Selection } from "@/server/generation/types";
import type { SlotRole } from "@/shared/vocabulary";

const PARAMS = { minSavingMinutes: 10, maxMoves: 3 };

const candidate = (id: string): Candidate => ({
  place: {
    id,
    name: id,
    neighborhood: "Test",
    coords: { lat: 43.65, lng: -79.38 },
    tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
  },
  category: "restaurants",
  googlePlaceId: null,
  rating: null,
  userRatingCount: null,
  cuisines: [],
  detailsFetched: false,
  score: 0,
});

const menu = (intentId: string, options: string[], role?: SlotRole): Menu => ({
  intent: {
    id: intentId,
    kind: "activity",
    label: intentId,
    window: { start: 600, end: 1200 },
    categories: ["restaurants"],
    dwellMinutes: 60,
    ...(role === undefined ? {} : { role }),
  },
  options: options.map(candidate),
});

const pick = (intentId: string, placeId: string): Selection => ({
  intentId,
  placeId,
});

/**
 * A travel model where a venue's cost is its distance from the letter "a" —
 * so `a1 a2 a3` is a coherent day and `a1 z9 a3` is a zig-zag. Crude on
 * purpose: the pass's job is to follow whatever number it is given, and a
 * realistic model here would test the model.
 */
const travelOf = (selections: readonly Selection[]): number =>
  selections.reduce(
    (sum, s) => sum + (s.placeId.startsWith("far") ? 100 : 10),
    0,
  );

const evaluator =
  (over: { invalid?: string[]; unfilled?: string[] } = {}) =>
  (selections: Selection[]) => {
    const ids = selections.map((s) => s.placeId);
    return {
      totalTravelMinutes: travelOf(selections),
      valid: !(over.invalid ?? []).some((bad) => ids.includes(bad)),
      unfilledCount: (over.unfilled ?? []).filter((u) => ids.includes(u)).length,
    };
  };

describe("the coherence pass", () => {
  it("PREMISE: the starting day really is worse than an available one", () => {
    // Without this the tests below prove nothing: a pass that never moves
    // passes every "does not break anything" assertion vacuously.
    expect(travelOf([pick("i1", "far-1")])).toBeGreaterThan(
      travelOf([pick("i1", "near-1")]) + PARAMS.minSavingMinutes,
    );
  });

  it("FIRES: substitutes a nearer venue from the slot's own menu", () => {
    const out = improveCoherence({
      selections: [pick("i1", "far-1"), pick("i2", "near-2")],
      menus: [menu("i1", ["far-1", "near-1"]), menu("i2", ["near-2"])],
      protectedIntentIds: new Set(),
      evaluate: evaluator(),
      params: PARAMS,
    });
    expect(out.selections).toEqual([pick("i1", "near-1"), pick("i2", "near-2")]);
    expect(out.savedMinutes).toBe(90);
    expect(out.moves).toHaveLength(1);
  });

  it("only ever proposes a venue the MENU already held", () => {
    // The whole honesty claim: nothing enters a day that selection could not
    // have chosen. A nearer venue that is not on the menu must not be reached.
    const out = improveCoherence({
      selections: [pick("i1", "far-1")],
      menus: [menu("i1", ["far-1"])],
      protectedIntentIds: new Set(),
      evaluate: evaluator(),
      params: PARAMS,
    });
    expect(out.moves).toEqual([]);
    expect(out.selections).toEqual([pick("i1", "far-1")]);
  });

  it("EXCHANGES two slots only when each menu holds the other's venue", () => {
    const legal = improveCoherence({
      selections: [pick("i1", "far-1"), pick("i2", "near-2")],
      menus: [
        menu("i1", ["far-1", "near-2"]),
        menu("i2", ["near-2", "far-1"]),
      ],
      protectedIntentIds: new Set(),
      // An exchange alone never changes this model's total, so force the
      // asymmetry through an invalid substitution target instead.
      evaluate: (s) => ({
        totalTravelMinutes:
          s[0].placeId === "near-2" && s[1].placeId === "far-1" ? 20 : 110,
        valid: true,
        unfilledCount: 0,
      }),
      params: PARAMS,
    });
    expect(legal.moves[0]?.kind).toBe("exchange");

    const oneWay = improveCoherence({
      selections: [pick("i1", "far-1"), pick("i2", "near-2")],
      // `near-2` is on i1's menu, but `far-1` is NOT on i2's — so the pairing
      // is not one selection could have produced, and the pass must not make it.
      menus: [menu("i1", ["far-1", "near-2"]), menu("i2", ["near-2"])],
      protectedIntentIds: new Set(),
      evaluate: (s) => ({
        totalTravelMinutes:
          s[0].placeId === "near-2" && s[1].placeId === "far-1" ? 20 : 110,
        valid: true,
        unfilledCount: 0,
      }),
      params: PARAMS,
    });
    expect(oneWay.moves.filter((m) => m.kind === "exchange")).toEqual([]);
  });

  it("REFUSES a saving the grammar rejects, and counts the refusal", () => {
    const out = improveCoherence({
      selections: [pick("i1", "far-1")],
      menus: [menu("i1", ["far-1", "near-1"])],
      protectedIntentIds: new Set(),
      evaluate: evaluator({ invalid: ["near-1"] }),
      params: PARAMS,
    });
    expect(out.moves).toEqual([]);
    expect(out.rejectedByGrammar).toBe(1);
  });

  it("REFUSES a saving bought by dropping a stop", () => {
    // The cheapest day is the empty one. A pass that optimises travel without
    // this guard would discover that.
    const out = improveCoherence({
      selections: [pick("i1", "far-1")],
      menus: [menu("i1", ["far-1", "near-1"])],
      protectedIntentIds: new Set(),
      evaluate: evaluator({ unfilled: ["near-1"] }),
      params: PARAMS,
    });
    expect(out.moves).toEqual([]);
    expect(out.rejectedByUnfilled).toBe(1);
  });

  it("does not move the day's centre", () => {
    const out = improveCoherence({
      selections: [pick("anchor", "far-1")],
      menus: [menu("anchor", ["far-1", "near-1"], "anchor")],
      protectedIntentIds: new Set(["anchor"]),
      evaluate: evaluator(),
      params: PARAMS,
    });
    expect(out.selections).toEqual([pick("anchor", "far-1")]);
  });

  it("never EXCHANGES a provisioning stop — causality outranks distance", () => {
    const out = improveCoherence({
      selections: [pick("prov", "far-1"), pick("i2", "near-2")],
      menus: [
        menu("prov", ["far-1", "near-2"], "provision"),
        menu("i2", ["near-2", "far-1"]),
      ],
      protectedIntentIds: new Set(),
      evaluate: (s) => ({
        totalTravelMinutes:
          s[0].placeId === "near-2" && s[1].placeId === "far-1" ? 20 : 110,
        valid: true,
        unfilledCount: 0,
      }),
      params: PARAMS,
    });
    expect(out.moves.filter((m) => m.kind === "exchange")).toEqual([]);
  });

  it("still SUBSTITUTES a nearer grocery — a different shop is not a different order", () => {
    const out = improveCoherence({
      selections: [pick("prov", "far-1")],
      menus: [menu("prov", ["far-1", "near-1"], "provision")],
      protectedIntentIds: new Set(),
      evaluate: evaluator(),
      params: PARAMS,
    });
    expect(out.moves.map((m) => m.kind)).toEqual(["substitute"]);
  });

  it("ignores a saving smaller than the threshold", () => {
    const out = improveCoherence({
      selections: [pick("i1", "a")],
      menus: [menu("i1", ["a", "b"])],
      protectedIntentIds: new Set(),
      evaluate: (s) => ({
        // Exactly the threshold, which must NOT be enough: the comparison is
        // strictly-greater, so a saving inside our own error is not taken.
        totalTravelMinutes: s[0].placeId === "a" ? 60 : 50,
        valid: true,
        unfilledCount: 0,
      }),
      params: PARAMS,
    });
    expect(out.moves).toEqual([]);
  });

  it("leaves an already-coherent day byte-identical", () => {
    const selections = [pick("i1", "near-1"), pick("i2", "near-2")];
    const out = improveCoherence({
      selections,
      menus: [menu("i1", ["near-1", "near-3"]), menu("i2", ["near-2"])],
      protectedIntentIds: new Set(),
      evaluate: evaluator(),
      params: PARAMS,
    });
    expect(out.selections).toEqual(selections);
    expect(out.savedMinutes).toBe(0);
  });

  it("does not improve a day that is already broken — that is repair's job", () => {
    const out = improveCoherence({
      selections: [pick("i1", "far-1")],
      menus: [menu("i1", ["far-1", "near-1"])],
      protectedIntentIds: new Set(),
      evaluate: evaluator({ invalid: ["far-1"] }),
      params: PARAMS,
    });
    expect(out.moves).toEqual([]);
    expect(out.trials).toBe(1); // the baseline, and nothing after it
  });

  it("never seats one venue twice", () => {
    const out = improveCoherence({
      selections: [pick("i1", "far-1"), pick("i2", "near-1")],
      menus: [menu("i1", ["far-1", "near-1"]), menu("i2", ["near-1"])],
      protectedIntentIds: new Set(),
      evaluate: evaluator(),
      params: PARAMS,
    });
    const ids = out.selections.map((s) => s.placeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stops at maxMoves — it is not a second selector", () => {
    const menus = ["i1", "i2", "i3", "i4", "i5"].map((id) =>
      menu(id, [`far-${id}`, `near-${id}`]),
    );
    const out = improveCoherence({
      selections: menus.map((m) => pick(m.intent.id, `far-${m.intent.id}`)),
      menus,
      protectedIntentIds: new Set(),
      evaluate: evaluator(),
      params: PARAMS,
    });
    expect(out.moves).toHaveLength(PARAMS.maxMoves);
  });

  it("is deterministic: identical inputs, identical day", () => {
    const run = () =>
      improveCoherence({
        selections: [pick("i1", "far-1"), pick("i2", "far-2")],
        menus: [
          menu("i1", ["far-1", "near-1"]),
          menu("i2", ["far-2", "near-2"]),
        ],
        protectedIntentIds: new Set(),
        evaluate: evaluator(),
        params: PARAMS,
      });
    expect(run().selections).toEqual(run().selections);
    expect(run().moves).toEqual(run().moves);
  });
});
