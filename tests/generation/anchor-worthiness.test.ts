/**
 * Anchor worthiness — the VENUE calibre question (XXX-35, Session 13 Step 2).
 *
 * `anchorDwellFor` fixed the clock: every centre now gets at least 75
 * minutes. It did nothing about WHICH venue fills them, and the founder's
 * complaint was about the venue: a pocket park, and a cheese counter, seated
 * as days' centrepieces.
 *
 * This is the interim signal until XXX-31 lands a real quality signal. Its
 * tests are as much about what it REFUSES to claim as about what it decides.
 */

import { describe, expect, it } from "vitest";
import {
  ANCHOR_MIN_RATING_COUNT,
  anchorCalibre,
  matchesCuratedName,
  normalizeName,
  partitionByCalibre,
} from "@/shared/anchor-calibre";
import type { PlaceCategory } from "@/shared/vocabulary";

const judge = (
  name: string,
  userRatingCount: number | null,
  category: PlaceCategory = "parks",
) => anchorCalibre({ name, category, userRatingCount });

describe("tier order: curation outranks fame, fame outranks silence", () => {
  it("admits a founder-named venue whatever its rating count", () => {
    // The whole point of operator trust: a quiet place the founder knows is
    // a destination must not be filtered out by a popularity bar.
    const verdict = judge("Toronto Islands", 3);
    expect(verdict.worthy).toBe(true);
    expect(verdict.basis).toBe("founder-curated");
    expect(verdict.tier).toBe(1);
  });

  it("admits on fame when the rating count clears the bar", () => {
    const verdict = judge("Some Big Museum", ANCHOR_MIN_RATING_COUNT);
    expect(verdict.worthy).toBe(true);
    expect(verdict.basis).toBe("rating-count");
    expect(verdict.tier).toBe(2);
  });

  it("rejects a measured shortfall — a stop, not a centrepiece", () => {
    // Severn Creek Park, the Session 12 failure, in its own shape.
    const verdict = judge("Severn Creek Park", 41);
    expect(verdict.worthy).toBe(false);
    expect(verdict.basis).toBe("below-bar");
    expect(verdict.tier).toBe(2);
  });
});

describe("honest absence is not a rejection", () => {
  it("returns null — not false — when calibre was never measured", () => {
    // Constraint 4. A venue nobody shortlisted has no Details fetch and so
    // no rating count; saying "not worthy" would be inventing a measurement.
    const verdict = judge("Unshortlisted Place", null);
    expect(verdict.worthy).toBeNull();
    expect(verdict.basis).toBe("unknown");
    expect(verdict.tier).toBe(3);
  });

  it("keeps unmeasured venues eligible when partitioning a menu", () => {
    const menu = [
      { name: "Measured Small", count: 12 },
      { name: "Never Measured", count: null as number | null },
      { name: "Measured Big", count: 9000 },
    ];
    const { worthy, unworthy } = partitionByCalibre(menu, (c) => ({
      name: c.name,
      category: "parks" as PlaceCategory,
      userRatingCount: c.count,
    }));
    expect(worthy.map((w) => w.name)).toEqual([
      "Never Measured",
      "Measured Big",
    ]);
    expect(unworthy.map((u) => u.name)).toEqual(["Measured Small"]);
  });
});

describe("the bar is a boundary, and it is stated", () => {
  it("is inclusive at exactly the bar", () => {
    expect(judge("X", ANCHOR_MIN_RATING_COUNT).worthy).toBe(true);
    expect(judge("X", ANCHOR_MIN_RATING_COUNT - 1).worthy).toBe(false);
  });

  it("ADMITS Berczy Park — the known limitation, pinned deliberately", () => {
    // Berczy Park is a downtown plaza with a dog fountain and roughly 4,000
    // ratings. The CP1 matrix seated it as a nature-first persona's
    // centrepiece and this heuristic seats it again, because fame is not
    // calibre. Pinned as a TEST so the limitation is a known quantity rather
    // than a surprise: when XXX-31's real signal lands, this expectation is
    // what should change, deliberately.
    const verdict = judge("Berczy Park", 4000);
    expect(verdict.worthy).toBe(true);
    expect(verdict.basis).toBe("rating-count");
  });
});

describe("curated names match the way a founder would expect", () => {
  it("normalizes punctuation, case and apostrophes", () => {
    expect(normalizeName("St. Lawrence Market")).toBe("st lawrence market");
    expect(normalizeName("Hanlan's Point")).toBe("hanlans point");
  });

  it("matches only on exact normalized equality", () => {
    expect(matchesCuratedName("St Lawrence Market", "St. Lawrence Market")).toBe(
      true,
    );
    // A longer pool identity is a DIFFERENT identity and needs its own
    // curated line. Curating two spellings is cheap; see below for what
    // loose matching cost.
    expect(
      matchesCuratedName(
        "St. Lawrence Market (North Building)",
        "St. Lawrence Market",
      ),
    ).toBe(false);
  });

  it("refuses the four false admits the real pool produced", () => {
    // These are not hypotheticals. Running the curation worksheet against
    // the Toronto pool with bidirectional containment matched every one of
    // them, and each would have entered a day as a TIER 1 founder-curated
    // centrepiece — a guess laundered as operator trust.
    expect(matchesCuratedName("Toronto", "Toronto Islands")).toBe(false);
    expect(matchesCuratedName("Toronto", "Toronto Zoo")).toBe(false);
    expect(matchesCuratedName("Mackenzie's High Park", "High Park")).toBe(false);
    expect(
      matchesCuratedName("Kensington Market Sourdough", "Kensington Market"),
    ).toBe(false);
  });

  it("does not match an unrelated venue", () => {
    expect(matchesCuratedName("Olympic Cheese", "St. Lawrence Market")).toBe(
      false,
    );
    expect(matchesCuratedName("Severn Creek Park", "High Park")).toBe(false);
  });

  it("respects category — a curated park does not admit a market", () => {
    expect(judge("High Park", 5, "parks").basis).toBe("founder-curated");
    expect(judge("High Park", 5, "markets").basis).toBe("below-bar");
  });
});
