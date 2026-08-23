import { describe, expect, it } from "vitest";
import {
  ageDays,
  applyFounderFacts,
  horizonDays,
  isGoverning,
  FOUNDER_SOURCE,
  type FounderFact,
} from "@/shared/founder-groundtruth";
import { hardFilter } from "@/server/generation/filters";
import type {
  GrammarFact,
  GrammarPlace,
  HoursByWeekday,
} from "@/shared/day-grammar/types";
import type { Candidate } from "@/server/generation/types";
import { WEEKDAYS } from "@/shared/vocabulary";

/**
 * Tier 1 for the pipeline change (Session 10 CP1). The override is the
 * one place a stored founder fact can beat a live Google answer, so its
 * precedence and its expiry arithmetic are pinned here rather than
 * discovered later in a generation.
 */

const NOW = "2026-08-09T12:00:00.000Z";
const GOOGLE = "google_places";

const googleFact = <T>(value: T, fetchedAt = NOW): GrammarFact<T> => ({
  status: "present",
  value,
  source: GOOGLE,
  tier: 1,
  fetchedAt,
});

const week = (intervals: { open: string; close: string }[]): HoursByWeekday =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, intervals])) as HoursByWeekday;

const place = (over: Partial<GrammarPlace> = {}): GrammarPlace => ({
  id: "p1",
  name: "Test Venue",
  neighborhood: "Kensington",
  coords: { lat: 43.654, lng: -79.4 },
  tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
  category: googleFact("restaurants" as const),
  hours: googleFact(week([{ open: "09:00", close: "17:00" }])),
  businessStatus: googleFact("operational" as const),
  ...over,
});

const daysAgo = (n: number): string =>
  new Date(Date.parse(NOW) - n * 24 * 3600_000).toISOString();

describe("horizons", () => {
  it("pins closed_permanently forever, on the asymmetric-stakes argument", () => {
    const fact: FounderFact = {
      factKey: "business_status",
      value: "closed_permanently",
      fetchedAt: daysAgo(5000),
    };
    expect(horizonDays(fact)).toBeNull();
    expect(isGoverning(fact, NOW)).toBe(true);
  });

  it("expires a founder 'it is open' at 180 days, not before", () => {
    const at180: FounderFact = {
      factKey: "business_status",
      value: "operational",
      fetchedAt: daysAgo(180),
    };
    const at181: FounderFact = { ...at180, fetchedAt: daysAgo(181) };
    expect(isGoverning(at180, NOW)).toBe(true);
    expect(isGoverning(at181, NOW)).toBe(false);
  });

  it("expires hours at 180 days and prices at 90", () => {
    expect(
      horizonDays({ factKey: "hours_corrections", value: {}, fetchedAt: NOW }),
    ).toBe(180);
    expect(
      horizonDays({
        factKey: "price_range",
        value: { min: 1, max: 2, currency: "CAD" },
        fetchedAt: NOW,
      }),
    ).toBe(90);
  });

  it("counts age in whole days and never negative", () => {
    expect(ageDays(daysAgo(3), NOW)).toBe(3);
    expect(ageDays(daysAgo(-5), NOW)).toBe(0);
  });
});

describe("precedence", () => {
  it("beats a FRESHER Google fact — channel decides, not timestamp", () => {
    // The trap policy: Google is re-fetched every generation, so it is
    // always newer. If freshness won, the override would never govern.
    const subject = place({ businessStatus: googleFact("operational", NOW) });
    const outcome = applyFounderFacts(
      subject,
      [
        {
          factKey: "business_status",
          value: "closed_permanently",
          fetchedAt: daysAgo(30),
        },
      ],
      "saturday",
      NOW,
    );
    expect(outcome.place.businessStatus).toEqual({
      status: "present",
      value: "closed_permanently",
      source: FOUNDER_SOURCE,
      tier: 1,
      fetchedAt: daysAgo(30),
    });
    expect(outcome.applied).toEqual(["business_status"]);
  });

  it("an expired fact governs nothing and says why", () => {
    const subject = place();
    const outcome = applyFounderFacts(
      subject,
      [
        {
          factKey: "hours_corrections",
          value: { saturday: [] },
          fetchedAt: daysAgo(400),
        },
      ],
      "saturday",
      NOW,
    );
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped).toEqual([
      { factKey: "hours_corrections", reason: "expired", ageDays: 400 },
    ]);
    expect(outcome.place.hours?.source).toBe(GOOGLE);
  });
});

describe("sparse hours corrections", () => {
  it("replaces only the generated weekday and keeps the rest", () => {
    const subject = place();
    const outcome = applyFounderFacts(
      subject,
      [
        {
          factKey: "hours_corrections",
          value: { saturday: [{ open: "11:00", close: "15:00" }] },
          fetchedAt: daysAgo(1),
        },
      ],
      "saturday",
      NOW,
    );
    const hours = outcome.place.hours;
    expect(hours?.status).toBe("present");
    if (hours?.status !== "present") throw new Error("unreachable");
    expect(hours.value.saturday).toEqual([{ open: "11:00", close: "15:00" }]);
    expect(hours.value.sunday).toEqual([{ open: "09:00", close: "17:00" }]);
    expect(hours.source).toBe(FOUNDER_SOURCE);
  });

  it("an empty interval array means closed that weekday", () => {
    const outcome = applyFounderFacts(
      place(),
      [
        {
          factKey: "hours_corrections",
          value: { saturday: [] },
          fetchedAt: daysAgo(1),
        },
      ],
      "saturday",
      NOW,
    );
    const hours = outcome.place.hours;
    if (hours?.status !== "present") throw new Error("unreachable");
    expect(hours.value.saturday).toEqual([]);
  });

  it("a Tuesday correction is not relevant to a Saturday", () => {
    const outcome = applyFounderFacts(
      place(),
      [
        {
          factKey: "hours_corrections",
          value: { tuesday: [] },
          fetchedAt: daysAgo(1),
        },
      ],
      "saturday",
      NOW,
    );
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped[0].reason).toBe("weekday-not-corrected");
    expect(outcome.place.hours?.source).toBe(GOOGLE);
  });

  it("governs nothing when there are no base hours to correct", () => {
    // Building a whole week from one known weekday would invent six days
    // of closure. Honest absence beats a convenient guess.
    const outcome = applyFounderFacts(
      place({ hours: undefined }),
      [
        {
          factKey: "hours_corrections",
          value: { saturday: [{ open: "11:00", close: "15:00" }] },
          fetchedAt: daysAgo(1),
        },
      ],
      "saturday",
      NOW,
    );
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped[0].reason).toBe("no-base-hours");
    expect(outcome.place.hours).toBeUndefined();
  });
});

describe("the override reaching the hard filters", () => {
  const candidateOf = (p: GrammarPlace): Candidate => ({
    place: p,
    category: "restaurants",
    googlePlaceId: "g1",
    rating: 4.5,
    userRatingCount: 100,
    cuisines: [],
    detailsFetched: true,
    score: 1,
  });

  it("a founder permanent-closure drops the venue Google still calls open", () => {
    const overridden = applyFounderFacts(
      place(),
      [
        {
          factKey: "business_status",
          value: "closed_permanently",
          fetchedAt: daysAgo(2),
        },
      ],
      "saturday",
      NOW,
    ).place;
    const { kept, dropped } = hardFilter(
      [candidateOf(overridden)],
      "2026-08-15", // a Saturday
      { start: 600, end: 1200 },
      () => 60,
    );
    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toBe("not operational");
  });

  it("a founder 'closed Saturday' makes the visit unschedulable that day", () => {
    const overridden = applyFounderFacts(
      place(),
      [
        {
          factKey: "hours_corrections",
          value: { saturday: [] },
          fetchedAt: daysAgo(2),
        },
      ],
      "saturday",
      NOW,
    ).place;
    const { kept } = hardFilter(
      [candidateOf(overridden)],
      "2026-08-15",
      { start: 600, end: 1200 },
      () => 60,
    );
    expect(kept).toHaveLength(0);
  });
});
