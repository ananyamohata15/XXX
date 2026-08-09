/**
 * Determinism (XXX-5): same input, identical output. The generation gate
 * rejects days on this function's word, and the regeneration loop feeds
 * its messages back into the prompt — a validator that varied between
 * runs would make both non-reproducible.
 *
 * The permutation property matters as much as the repeat property: rules
 * must read the day's SCHEDULE, never the order the slots happened to
 * arrive in an array.
 */

import { describe, expect, it } from "vitest";
import { validateDay } from "@/shared/day-grammar/validate";
import { HaversineStubProvider, haversineKm } from "@/shared/day-grammar/travel";
import { GOLDEN_DAYS } from "@/shared/fixtures/golden";
import { contextFor } from "@/shared/fixtures/golden/support";
import { TRAP_FIXTURES } from "@/shared/fixtures/golden/traps";

const ALL = [
  ...GOLDEN_DAYS.map((g) => ({ key: g.key, golden: g, travel: undefined })),
  ...TRAP_FIXTURES.map((t) => ({ key: t.key, golden: t.golden, travel: t.travel })),
];

/** Deterministic shuffle — a seeded LCG, so a failure is reproducible. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("validateDay is deterministic", () => {
  it.each(ALL.map((a) => [a.key, a] as const))(
    "%s produces identical output on repeat runs",
    (_key, entry) => {
      const ctx = () =>
        contextFor(entry.golden, entry.travel ?? new HaversineStubProvider());
      const first = validateDay(entry.golden.day, ctx());
      const second = validateDay(entry.golden.day, ctx());
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    },
  );

  it.each(ALL.map((a) => [a.key, a] as const))(
    "%s is invariant under slot-array permutation",
    (_key, entry) => {
      const ctx = () =>
        contextFor(entry.golden, entry.travel ?? new HaversineStubProvider());
      const baseline = JSON.stringify(validateDay(entry.golden.day, ctx()));

      for (const seed of [1, 7, 42, 1337, 90210]) {
        const permuted = {
          ...entry.golden.day,
          slots: shuffled(entry.golden.day.slots, seed),
        };
        expect(
          JSON.stringify(validateDay(permuted, ctx())),
          `seed ${seed}`,
        ).toBe(baseline);
      }
    },
  );
});

describe("the travel stub is deterministic and honest about itself", () => {
  it("returns the same estimate for the same query", () => {
    const provider = new HaversineStubProvider();
    const query = {
      origin: { lat: 43.6532, lng: -79.3832 },
      destination: { lat: 43.6488, lng: -79.3715 },
      mode: "walk" as const,
      departureLocal: "10:00",
    };
    const a = provider.estimate(query);
    expect(provider.estimate(query)).toEqual(a);
  });

  it("stamps tier 3 and its own name on every estimate", () => {
    const estimate = new HaversineStubProvider().estimate({
      origin: { lat: 43.65, lng: -79.38 },
      destination: { lat: 43.66, lng: -79.4 },
      mode: "transit",
      departureLocal: "10:00",
    });
    expect(estimate?.provenance).toEqual({
      source: "stub_haversine",
      tier: 3,
    });
  });

  it("reads long rather than short — a false pass is worse than a false flag", () => {
    // Founder-stated: Kensington to Graffiti Alley is "~12 min walk".
    const minutes = new HaversineStubProvider().estimate({
      origin: { lat: 43.6551, lng: -79.4014 },
      destination: { lat: 43.6479, lng: -79.399 },
      mode: "walk",
      departureLocal: "13:00",
    })?.minutes;
    expect(minutes).toBeGreaterThanOrEqual(12);
  });

  it("treats sub-150-metre hops as no travel at all", () => {
    const estimate = new HaversineStubProvider().estimate({
      origin: { lat: 43.6503, lng: -79.3596 },
      destination: { lat: 43.6503, lng: -79.3592 },
      mode: "walk",
      departureLocal: "19:00",
    });
    expect(estimate?.minutes).toBe(0);
  });

  it("measures known distances correctly", () => {
    // Toronto City Hall to Niagara Falls, ~62 km straight line.
    const km = haversineKm(
      { lat: 43.6532, lng: -79.3832 },
      { lat: 43.079, lng: -79.0783 },
    );
    expect(km).toBeGreaterThan(66);
    expect(km).toBeLessThan(70);
  });
});
