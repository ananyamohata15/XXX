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
  FOUNDER_ANCHOR_WORTHY,
  anchorCalibre,
  matchesCuratedName,
  normalizeName,
  partitionByCalibre,
  prefilterToken,
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

/**
 * The prefilter that decides whether `matchesCuratedName` is ever CONSULTED
 * (XXX-40, Session 14 CP0).
 *
 * `curation-resolve.ts` normalized the search term and then queried raw pool
 * names, so every possessive identity read as absent — and Session 13's
 * close-out recorded `Hanlan's Point` as a pool gap on the strength of it.
 * It is in the pool. `Mildred's Temple Kitchen` was reported absent the same
 * way and is also in the pool.
 *
 * Hanlan's is the fixture on purpose: it is the identity the defect actually
 * lied about, and golden Day 7 is built on it.
 */
describe("the prefilter cannot disagree with the pool's own spelling", () => {
  it("picks a token that survives every apostrophe form", () => {
    // The three spellings a source might use for one name. All must share
    // the token, or the search finds nothing and calls it absence.
    expect(prefilterToken("Hanlan's Point")).toBe("hanlan");
    expect(prefilterToken("Hanlan’s Point")).toBe("hanlan");
    expect(prefilterToken("Hanlans Point")).toBe("hanlans");

    // The regression, stated as the query it produces: the OLD token was
    // "Hanlans", which is not a substring of the pool's "Hanlan's Point
    // Beach". The new one is.
    const poolName = "Hanlan's Point Beach";
    expect(poolName.toLowerCase()).toContain(prefilterToken("Hanlan's Point"));
    expect(poolName.toLowerCase()).not.toContain("hanlans");
  });

  it("survives the other identity the defect hid", () => {
    const poolName = "Mildred's Temple Kitchen";
    expect(poolName.toLowerCase()).toContain(
      prefilterToken("Mildred's Temple Kitchen"),
    );
  });

  it("is a substring of the normalized form too, not just the raw name", () => {
    // Both sides of the comparison must contain it — that is the whole
    // property. A token drawn from one spelling of one side is the defect.
    for (const name of [
      "Hanlan's Point",
      "St. Lawrence Market",
      "El Catrin Destileria",
      "Sneaky Dee's",
      "Longo’s",
    ]) {
      const token = prefilterToken(name);
      expect(token.length).toBeGreaterThan(0);
      expect(name.toLowerCase()).toContain(token);
      expect(normalizeName(name)).toContain(token);
    }
  });

  it("stays selective — it takes the longest run, not the first", () => {
    expect(prefilterToken("St. Lawrence Market")).toBe("lawrence");
    expect(prefilterToken("The Porch")).toBe("porch");
  });
});

describe("the curated list is wired the way the lookup reads it", () => {
  /**
   * `anchorCalibre` looks a candidate up under the CANDIDATE'S OWN category.
   * An entry filed under a key the pool does not agree with never fires and
   * fails silently — which looks identical to a list nobody is consulting.
   * Session 13's curation hit this immediately: the founder ticked Casa Loma
   * under museums, and the pool maps it to historic_sites.
   *
   * These are the properties that keep such a mistake loud.
   */
  it("admits each curated venue under the category it is filed against", () => {
    for (const [category, names] of Object.entries(FOUNDER_ANCHOR_WORTHY)) {
      for (const name of names ?? []) {
        const verdict = anchorCalibre({
          name,
          category: category as PlaceCategory,
          userRatingCount: 0, // far below the bar: only tier 1 can admit it
        });
        expect(verdict.worthy, `${category} / ${name}`).toBe(true);
        expect(verdict.basis, `${category} / ${name}`).toBe("founder-curated");
        expect(verdict.tier).toBe(1);
      }
    }
  });

  it("does NOT leak a curated venue into a category it was not filed under", () => {
    // Casa Loma is curated under historic_sites AND museums_galleries (the
    // founder ruled it is both). It must not thereby become anchor-worthy as
    // a park or a market.
    expect(anchorCalibre({ name: "Casa Loma", category: "parks", userRatingCount: 0 }).worthy).toBe(false);
    expect(anchorCalibre({ name: "Art Gallery of Ontario", category: "markets", userRatingCount: 0 }).worthy).toBe(false);
  });

  it("stores every entry in a form the exact matcher can actually match", () => {
    // A curated name that normalizes to empty, or that carries stray
    // whitespace, is an entry that silently never fires.
    for (const names of Object.values(FOUNDER_ANCHOR_WORTHY)) {
      for (const name of names ?? []) {
        expect(normalizeName(name).length, name).toBeGreaterThan(0);
        expect(name, name).toBe(name.trim());
        expect(matchesCuratedName(name, name)).toBe(true);
      }
    }
  });

  it("still refuses Berczy Park, which the founder declined to tick", () => {
    // The list ADMITS; it does not deny. Berczy Park clears the rating bar
    // on fame and would still be seated — the founder ticking none of the
    // twelve offered parks makes that a live gap, not a hypothetical one.
    // Pinned so the day a deny-list lands, this expectation changes on
    // purpose rather than by accident.
    expect(anchorCalibre({ name: "Berczy Park", category: "parks", userRatingCount: 4000 }).worthy).toBe(true);
    expect((FOUNDER_ANCHOR_WORTHY.parks ?? []).includes("Berczy Park")).toBe(false);
  });
});
