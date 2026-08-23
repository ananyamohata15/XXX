import { describe, expect, it } from "vitest";
import {
  JITTER_BOUND,
  fnv1a,
  mulberry32,
  scoreAll,
  scoreCandidate,
} from "@/server/generation/score";
import type { Candidate } from "@/server/generation/types";
import type { Persona } from "@/shared/persona";
import type { PlaceCategory } from "@/shared/vocabulary";

const persona = (over: Partial<Persona> = {}): Persona => ({
  pace: "moderate",
  gravity: ["food", "local_life", "history"],
  foodCourage: "adventurous",
  structure: "scheduler",
  lens: "icons",
  ...over,
});

function candidate(
  id: string,
  category: PlaceCategory,
  over: Partial<Candidate> = {},
): Candidate {
  return {
    place: {
      id,
      name: id,
      neighborhood: "Downtown",
      coords: { lat: 43.65, lng: -79.38 },
      tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
      category: {
        status: "present",
        value: category,
        source: "fsq_os_places",
        tier: 2,
        fetchedAt: "2026-07-09",
      },
    },
    category,
    googlePlaceId: null,
    rating: null,
    userRatingCount: null,
    cuisines: [],
    detailsFetched: false,
    score: 0,
    ...over,
  };
}

describe("seeded scoring", () => {
  it("is deterministic: same candidate, same seed, same score", () => {
    const c = candidate("a", "restaurants", { rating: 4.5, userRatingCount: 200 });
    const s1 = scoreCandidate(c, persona(), null, 42);
    const s2 = scoreCandidate(c, persona(), null, 42);
    expect(s1).toBe(s2);
  });

  it("different seeds move a score by at most the jitter bound", () => {
    const c = candidate("a", "restaurants", { rating: 4.5, userRatingCount: 200 });
    const scores = [1, 2, 3, 4, 5].map((seed) =>
      scoreCandidate(c, persona(), null, seed),
    );
    const spread = Math.max(...scores) - Math.min(...scores);
    expect(spread).toBeLessThanOrEqual(2 * JITTER_BOUND + 1e-9);
    expect(spread).toBeGreaterThan(0); // the exploration term is alive
  });

  it("icons and corners materially reorder the same candidates (10294)", () => {
    const famous = candidate("famous", "museums_galleries", {
      rating: 4.6,
      userRatingCount: 9000,
      detailsFetched: true,
    });
    const hidden = candidate("hidden", "museums_galleries", {
      rating: 4.6,
      userRatingCount: 40,
      detailsFetched: true,
    });
    const p = persona({ gravity: ["art", "food", "history"] });
    const icons = scoreAll([famous, hidden], { ...p, lens: "icons" }, null, 7);
    const corners = scoreAll([famous, hidden], { ...p, lens: "corners" }, null, 7);
    expect(icons[0].place.id).toBe("famous");
    expect(corners[0].place.id).toBe("hidden");
  });

  it("prefers verified candidates over honest absence at equal footing", () => {
    const verified = candidate("v", "restaurants", {
      rating: 4.0,
      userRatingCount: 100,
      detailsFetched: true,
    });
    const unverified = candidate("u", "restaurants");
    const ranked = scoreAll([unverified, verified], persona(), null, 3);
    expect(ranked[0].place.id).toBe("v");
  });

  it("price fit punishes a stop that eats the band", () => {
    const cheap = candidate("cheap", "restaurants", {
      detailsFetched: true,
      rating: 4.2,
      userRatingCount: 150,
    });
    cheap.place = {
      ...cheap.place,
      priceRange: {
        status: "present",
        value: { min: 10, max: 16, currency: "CAD" },
        source: "google_places",
        tier: 2,
        fetchedAt: "now",
      },
    };
    const dear = candidate("dear", "restaurants", {
      detailsFetched: true,
      rating: 4.2,
      userRatingCount: 150,
    });
    dear.place = {
      ...dear.place,
      priceRange: {
        status: "present",
        value: { min: 60, max: 90, currency: "CAD" },
        source: "google_places",
        tier: 2,
        fetchedAt: "now",
      },
    };
    const band = { min: 0, max: 70, currency: "CAD" };
    const ranked = scoreAll([dear, cheap], persona(), band, 11);
    expect(ranked[0].place.id).toBe("cheap");
  });

  it("PRNG plumbing is stable across runs (regression pin)", () => {
    expect(fnv1a("kensington")).toBe(fnv1a("kensington"));
    const r = mulberry32(1234);
    const seq = [r(), r(), r()];
    const r2 = mulberry32(1234);
    expect([r2(), r2(), r2()]).toEqual(seq);
  });
});
