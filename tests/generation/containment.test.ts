/**
 * Container-vs-tenant detection (XXX-35, Session 13 Step 2, finding 2).
 *
 * Coordinates here are the pool's own, read from the Toronto FSQ extract by
 * `scripts/containment-probe.ts`. That matters: these are not invented
 * fixtures, they are the identities the engine actually seats, which is why
 * the founder's own case can be asserted rather than approximated.
 */

import { describe, expect, it } from "vitest";
import { CONTAINERS, tenancyOf } from "@/shared/containment";

/** Verbatim from the pool (scripts/containment-probe.ts, 2026-08-15). */
const POOL = {
  stLawrenceMarket: { name: "St Lawrence Market", coords: { lat: 43.64891, lng: -79.3717 } },
  northBuilding: {
    name: "St. Lawrence Market (North Building)",
    coords: { lat: 43.64879, lng: -79.37195 },
  },
  olympicCheese: { name: "Olympic Cheese", coords: { lat: 43.6487, lng: -79.37154 } },
  stonemill: {
    name: "Stonemill Bakehouse Limited St Lawrence Market-Lower Level",
    coords: { lat: 43.6494, lng: -79.37192 },
  },
  // The OTHER Olympic Cheese — same name, 20km north, a separate business.
  olympicCheeseNorth: {
    name: "Olympic Cheese",
    coords: { lat: 43.83252, lng: -79.3546 },
  },
  kensingtonFlea: {
    name: "Kensington Flea Market",
    coords: { lat: 43.65445, lng: -79.40125 },
  },
} as const;

describe("the founder's own case", () => {
  it("reads Olympic Cheese as a tenant of St Lawrence Market", () => {
    // *"Weird, its a shop in st lawerence, not worth 1hr 30 mins"*
    const verdict = tenancyOf(POOL.olympicCheese);
    expect(verdict.container?.name).toBe("St Lawrence Market");
    expect(verdict.distanceMetres).toBeLessThanOrEqual(60);
  });

  it("is a judgment, never a fact — tier 3 always", () => {
    // A neighbouring shop at the same address is indistinguishable from a
    // stall inside. Geometry cannot promote itself to certainty.
    expect(tenancyOf(POOL.olympicCheese).tier).toBe(3);
    expect(tenancyOf(POOL.kensingtonFlea).tier).toBe(3);
  });

  it("does NOT read the same-named business 20km north as a tenant", () => {
    // Two identities share the name "Olympic Cheese". Name alone would have
    // seated a Markham cheese shop inside a downtown market hall.
    const verdict = tenancyOf(POOL.olympicCheeseNorth);
    expect(verdict.container).toBeNull();
  });
});

describe("a container is not its own tenant", () => {
  it("returns no container for the market itself", () => {
    const verdict = tenancyOf(POOL.stLawrenceMarket);
    expect(verdict.container).toBeNull();
    expect(verdict.reason).toContain("IS the container");
  });

  it("reads the North Building as a tenant, which is honest", () => {
    // It is a separate hall 23m away and a legitimately separate identity.
    // Calling it a tenant is defensible; the seating rule that consumes this
    // is what decides whether that is the right thing to DO about it.
    const verdict = tenancyOf(POOL.northBuilding);
    expect(verdict.container?.name).toBe("St Lawrence Market");
  });

  it("reads a lower-level stall as a tenant", () => {
    expect(tenancyOf(POOL.stonemill).container?.name).toBe("St Lawrence Market");
  });
});

describe("the footprint excludes the street, which is the whole lesson", () => {
  it("does not enclose an unrelated market across town", () => {
    expect(tenancyOf(POOL.kensingtonFlea).container).toBeNull();
  });

  it("keeps every footprint tight enough to be a building, not a block", () => {
    // The probe found 62 places within 60m of one Kensington market — street
    // neighbours, not tenants. A footprint that grows past a building starts
    // swallowing the neighbourhood.
    for (const container of CONTAINERS) {
      expect(container.footprintMetres, container.name).toBeLessThanOrEqual(80);
      expect(container.note.length, container.name).toBeGreaterThan(10);
    }
  });
});
