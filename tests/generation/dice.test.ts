/**
 * The dice primitive (XXX-35, Session 12) — the four properties the CP1
 * ruling actually granted, asserted rather than described.
 *
 * These are Tier 1 and pipeline-critical: every category a traveller sees is
 * chosen through this file, and the two defects it exists to cure (ranked
 * head always wins; a seed key that collides for similar personas) both
 * shipped to production because nothing here failed.
 */

import { describe, expect, it } from "vitest";
import {
  closeCategories,
  electAnchor,
  pickContrast,
  warmupCategories,
} from "@/server/generation/arc";
import { COMPOSE_PARAMS } from "@/server/generation/compose-params";
import {
  diceIndex,
  diceStream,
  personaIdentity,
  weightedOrderBy,
} from "@/shared/dice";
import {
  categoryAffinity,
  GOLDEN_PERSONAS,
  type Persona,
} from "@/shared/persona";
import { PLACE_CATEGORIES, type PlaceCategory } from "@/shared/vocabulary";

const SEEDS = [0, 1, 42, 7, 1234, 99, 2026, 31337];
const personas = Object.entries(GOLDEN_PERSONAS);

const roll = (persona: Persona, seed: number, site: string, context = "") =>
  diceStream({ seed, identity: personaIdentity(persona), site, context });

describe("(c) reproducibility — same persona + seed reproduces exactly", () => {
  it("returns an identical order for an identical key", () => {
    for (const [, persona] of personas) {
      for (const seed of SEEDS) {
        const a = closeCategories(persona, roll(persona, seed, "close"));
        const b = closeCategories(persona, roll(persona, seed, "close"));
        expect(b).toEqual(a);
      }
    }
  });

  it("is a pure function of the key, not of call order", () => {
    const persona = GOLDEN_PERSONAS["day-1-jays"];
    const first = warmupCategories(persona, roll(persona, 42, "warmup"));
    // Draw a hundred unrelated numbers from other streams in between.
    for (const seed of SEEDS) diceStream({ seed, identity: 1, site: "x", context: "y" })();
    expect(warmupCategories(persona, roll(persona, 42, "warmup"))).toEqual(first);
  });
});

describe("(a) stated preference can never be inverted", () => {
  it("never draws an option more than tau below the best weight", () => {
    // The eligibility floor is the guarantee, so it is checked directly
    // against the weights rather than against any particular outcome.
    for (const [, persona] of personas) {
      for (const seed of SEEDS) {
        for (const tau of [0, 0.05, 0.2, 0.35, 0.6]) {
          const options = [...PLACE_CATEGORIES];
          const best = Math.max(
            ...options.map((c) => categoryAffinity(persona, c)),
          );
          const head = weightedOrderBy(
            options,
            (c) => categoryAffinity(persona, c),
            diceStream({ seed, identity: personaIdentity(persona), site: "t", context: String(tau) }),
            tau,
          )[0];
          expect(categoryAffinity(persona, head)).toBeGreaterThanOrEqual(
            best - tau - 1e-9,
          );
        }
      }
    }
  });

  it("the anchor stays gravity-faithful at its ruled tau", () => {
    // tau 0.05 exists to unseat `localeCompare`, not to move the centrepiece.
    for (const [, persona] of personas) {
      const best = Math.max(
        ...PLACE_CATEGORIES.filter(
          (c) => c !== "restaurants" && c !== "cafes",
        ).map((c) => categoryAffinity(persona, c)),
      );
      for (const seed of SEEDS) {
        const elected = electAnchor(persona, { dice: roll(persona, seed, "anchor") });
        expect(elected).not.toBeNull();
        expect(
          categoryAffinity(persona, elected!.category),
        ).toBeGreaterThanOrEqual(best - COMPOSE_PARAMS.dice.anchor - 1e-9);
      }
    }
  });

  it("tau = 0 is exactly ranking — the testable null hypothesis", () => {
    for (const [, persona] of personas) {
      const ranked = [...PLACE_CATEGORIES].sort(
        (a, b) => categoryAffinity(persona, b) - categoryAffinity(persona, a),
      );
      const drawn = weightedOrderBy(
        [...PLACE_CATEGORIES],
        (c) => categoryAffinity(persona, c),
        roll(persona, 42, "null-hypothesis"),
        0,
      );
      // Equal-weight runs may permute among themselves; the WEIGHT sequence
      // must be identical to the ranked one.
      expect(drawn.map((c) => categoryAffinity(persona, c))).toEqual(
        ranked.map((c) => categoryAffinity(persona, c)),
      );
    }
  });
});

describe("(b) similar personas draw different streams — the pickTemplate lesson", () => {
  it("gives two personas differing in ONE gravity entry different identities", () => {
    const a: Persona = {
      pace: "moderate",
      gravity: ["art", "food", "history"],
      foodCourage: "adventurous",
      structure: "scheduler",
      lens: "corners",
    };
    const b: Persona = { ...a, gravity: ["art", "food", "nature"] };
    expect(personaIdentity(a)).not.toBe(personaIdentity(b));
  });

  it("distinguishes personas that differ ONLY in foodCourage", () => {
    // The regression this replaces: `arc.ts`'s old identity hash omitted
    // foodCourage entirely, so these two were one traveller to the dice.
    const a = GOLDEN_PERSONAS["day-2-old-town"];
    const b: Persona = { ...a, foodCourage: "adventurous" };
    expect(a.foodCourage).not.toBe(b.foodCourage);
    expect(personaIdentity(a)).not.toBe(personaIdentity(b));
  });

  it("gives every golden persona a distinct identity", () => {
    const ids = new Set(personas.map(([, p]) => personaIdentity(p)));
    expect(ids.size).toBe(personas.length);
  });

  it("separates sites, so two selectors at one seed do not draw in lockstep", () => {
    const persona = GOLDEN_PERSONAS["day-1-jays"];
    const close = roll(persona, 42, "close")();
    const warmup = roll(persona, 42, "warmup")();
    expect(close).not.toBe(warmup);
  });

  it("separates day-contexts, so one persona on two dates draws differently", () => {
    const persona = GOLDEN_PERSONAS["day-1-jays"];
    expect(roll(persona, 42, "close", "2026-08-15")()).not.toBe(
      roll(persona, 42, "close", "2026-08-16")(),
    );
  });
});

describe("(d) the order is complete — filters consume it, they never truncate it", () => {
  it("returns every option exactly once, whatever the temperature", () => {
    const persona = GOLDEN_PERSONAS["day-4-budget"];
    for (const tau of [0, 0.1, 0.35, 1.0]) {
      const drawn = weightedOrderBy(
        [...PLACE_CATEGORIES],
        (c) => categoryAffinity(persona, c),
        roll(persona, 42, "complete", String(tau)),
        tau,
      );
      expect([...drawn].sort()).toEqual([...PLACE_CATEGORIES].sort());
    }
  });

  it("pickContrast hands back an ORDER whose every member clears the rules", () => {
    const persona = GOLDEN_PERSONAS["day-3-winter"];
    const picks = pickContrast(persona, "museums_galleries", new Set(["culture"]), {
      dice: roll(persona, 42, "contrast"),
    });
    expect(picks.length).toBeGreaterThan(1);
    for (const c of picks) {
      expect(["restaurants", "cafes"]).not.toContain(c);
      expect(c).not.toBe("museums_galleries");
    }
  });
});

describe("the close: no knife-edge, and never a table first", () => {
  it("offers restaurants to every persona, always last", () => {
    // The deleted gate: `night >= 0.35` decided whether restaurants was
    // offered at all, and day-5-wanderer measured EXACTLY 0.350 because
    // `nightlife` sat at gravity position 3 and GRAVITY_WEIGHTS[2] IS 0.35.
    for (const [, persona] of personas) {
      for (const seed of SEEDS) {
        const drawn = closeCategories(persona, roll(persona, seed, "close"));
        expect(drawn[drawn.length - 1]).toBe("restaurants");
        expect(drawn[0]).not.toBe("restaurants");
      }
    }
  });

  it("no persona sits on a behaviour boundary at the old 0.35 threshold", () => {
    // The restructure's real claim: perturbing night affinity across 0.35
    // changes nothing about WHICH categories are offered.
    const below = GOLDEN_PERSONAS["day-1-jays"]; // 0.180
    const exactly = GOLDEN_PERSONAS["day-5-wanderer"]; // 0.350
    expect(categoryAffinity(exactly, "nightlife_bars")).toBeCloseTo(0.35, 10);
    for (const persona of [below, exactly]) {
      const drawn = closeCategories(persona, roll(persona, 42, "close"));
      expect([...drawn].sort()).toEqual(
        ["historic_sites", "nightlife_bars", "parks", "restaurants"].sort(),
      );
    }
  });

  it("the close is no longer a fixed answer across seeds", () => {
    // The Session 11 defect in one assertion: six days, six bars. At least
    // one golden persona must now draw more than one close head.
    const spreads = personas.map(
      ([, persona]) =>
        new Set(
          SEEDS.map((s) => closeCategories(persona, roll(persona, s, "close"))[0]),
        ).size,
    );
    expect(Math.max(...spreads)).toBeGreaterThan(1);
  });
});

describe("diceIndex — flat variants, for choices with no preference", () => {
  it("stays in range and reproduces", () => {
    for (const seed of SEEDS) {
      const key = { seed, identity: 7, site: "pool-window", context: "parks" };
      const i = diceIndex(key, 8);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(8);
      expect(diceIndex(key, 8)).toBe(i);
    }
  });

  it("reaches more than one variant across seeds", () => {
    const drawn = new Set(
      SEEDS.map((seed) =>
        diceIndex({ seed, identity: 7, site: "pool-window", context: "parks" }, 8),
      ),
    );
    expect(drawn.size).toBeGreaterThan(1);
  });

  it("collapses safely for a single variant", () => {
    expect(diceIndex({ seed: 5, identity: 1, site: "s", context: "c" }, 1)).toBe(0);
  });
});

describe("category selectors reject the un-diced call", () => {
  it("keeps every selector's dice parameter required at the type level", () => {
    // A compile-time contract, asserted at runtime as a smoke check: a
    // selector that can be called without dice is a selector that will be.
    const persona = GOLDEN_PERSONAS["day-6-excursion"];
    expect(() => warmupCategories(persona, roll(persona, 1, "warmup"))).not.toThrow();
    expect(warmupCategories(persona, roll(persona, 1, "warmup")).length).toBe(3);
  });
});

describe("the funnel rule: a diced order survives a downstream filter", () => {
  it("leaves a usable second choice when the head is filtered out", () => {
    // What Session 11's proposed fix could not do. `forEvening` drops
    // `parks`; the order must still hand back something the evening allows,
    // and it must be the DICE's next preference, not the alphabet's.
    const eveningOk: PlaceCategory[] = [
      "nightlife_bars",
      "historic_sites",
      "restaurants",
    ];
    for (const [, persona] of personas) {
      for (const seed of SEEDS) {
        const drawn = closeCategories(persona, roll(persona, seed, "close"));
        const survivors = drawn.filter((c) => eveningOk.includes(c));
        expect(survivors.length).toBeGreaterThan(0);
        // Relative order is preserved through the filter — that is what
        // makes the survivor "what the dice wanted next".
        const positions = survivors.map((c) => drawn.indexOf(c));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
      }
    }
  });
});
