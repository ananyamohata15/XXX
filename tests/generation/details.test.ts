import { describe, expect, it } from "vitest";
import { applyDetails, periodsToHours } from "@/server/generation/details";
import type { Candidate } from "@/server/generation/types";

const base: Candidate = {
  place: {
    id: "p1",
    name: "Test Place",
    neighborhood: "Downtown",
    coords: { lat: 43.65, lng: -79.38 },
    tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
  },
  category: "restaurants",
  googlePlaceId: "gp1",
  rating: null,
  userRatingCount: null,
  detailsFetched: false,
  score: 0,
};

describe("periodsToHours", () => {
  it("maps a plain weekday period to its day", () => {
    const hours = periodsToHours([
      {
        open: { day: 6, hour: 7, minute: 0 },
        close: { day: 6, hour: 17, minute: 0 },
      },
    ]);
    expect(hours.saturday).toEqual([{ open: "07:00", close: "17:00" }]);
    expect(hours.monday).toEqual([]);
  });

  it("splits an overnight period into both true parts", () => {
    const hours = periodsToHours([
      {
        open: { day: 5, hour: 18, minute: 0 },
        close: { day: 6, hour: 2, minute: 0 },
      },
    ]);
    expect(hours.friday).toEqual([{ open: "18:00", close: "24:00" }]);
    expect(hours.saturday).toEqual([{ open: "00:00", close: "02:00" }]);
  });

  it("reads Google's 24/7 encoding as open every day", () => {
    const hours = periodsToHours([{ open: { day: 0, hour: 0, minute: 0 } }]);
    for (const day of Object.values(hours)) {
      expect(day).toEqual([{ open: "00:00", close: "24:00" }]);
    }
  });
});

describe("applyDetails provenance", () => {
  it("status and hours land tier 1; published price tier 2", () => {
    const applied = applyDetails(
      base,
      {
        id: "gp1",
        businessStatus: "OPERATIONAL",
        regularOpeningHours: {
          periods: [
            {
              open: { day: 1, hour: 9, minute: 0 },
              close: { day: 1, hour: 17, minute: 0 },
            },
          ],
        },
        priceRange: {
          startPrice: { currencyCode: "CAD", units: "20" },
          endPrice: { currencyCode: "CAD", units: "35" },
        },
        rating: 4.4,
        userRatingCount: 321,
      },
      "2026-08-15T12:00:00Z",
    );
    const place = applied.candidate.place;
    expect(place.businessStatus).toMatchObject({
      status: "present",
      value: "operational",
      tier: 1,
      source: "google_places",
    });
    expect(place.hours?.tier).toBe(1);
    expect(place.priceRange).toMatchObject({
      status: "present",
      value: { min: 20, max: 35, currency: "CAD" },
      tier: 2,
    });
    expect(applied.candidate.rating).toBe(4.4);
    expect(applied.candidate.detailsFetched).toBe(true);
  });

  it("a banded price level is tier 3 — judgment says so", () => {
    const applied = applyDetails(
      base,
      { id: "gp1", priceLevel: "PRICE_LEVEL_MODERATE" },
      "2026-08-15T12:00:00Z",
    );
    expect(applied.candidate.place.priceRange).toMatchObject({
      status: "present",
      value: { min: 15, max: 40, currency: "CAD" },
      tier: 3,
    });
  });

  it("absence is honest: nothing published → absent facts, not guesses", () => {
    const applied = applyDetails(base, { id: "gp1" }, "2026-08-15T12:00:00Z");
    expect(applied.candidate.place.businessStatus?.status).toBe("absent");
    expect(applied.candidate.place.hours?.status).toBe("absent");
    expect(applied.candidate.place.priceRange?.status).toBe("absent");
    expect(applied.googleName).toBeNull();
  });

  it("surfaces the request-scoped name and location for the link path", () => {
    const applied = applyDetails(
      base,
      {
        id: "gp1",
        displayName: { text: "Test Place TO" },
        location: { latitude: 43.651, longitude: -79.381 },
      },
      "2026-08-15T12:00:00Z",
    );
    expect(applied.googleName).toBe("Test Place TO");
    expect(applied.location).toEqual({ lat: 43.651, lng: -79.381 });
  });
});
