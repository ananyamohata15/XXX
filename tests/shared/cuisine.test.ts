import { describe, expect, it } from "vitest";
import {
  CUISINE_PREFIXES,
  CUISINE_TAGS,
  cuisinesFromLabels,
  isCuisineTag,
  RESTAURANT_BRANCH,
} from "@/shared/cuisine";

/** Sugar: the fixtures read as the taxonomy actually stores them. */
const leaf = (sub: string) => `${RESTAURANT_BRANCH} > ${sub}`;

describe("cuisinesFromLabels", () => {
  it("reads an exact leaf, and its ancestor family with it", () => {
    // The source tree files Thai UNDER Asian, so both are true of the venue.
    expect(cuisinesFromLabels([leaf("Asian Restaurant > Thai Restaurant")])).toEqual([
      "thai",
      "asian",
    ]);
  });

  it("captures a whole subtree from its parent prefix", () => {
    expect(
      cuisinesFromLabels([
        leaf("Asian Restaurant > Chinese Restaurant > Cantonese Restaurant"),
      ]),
    ).toEqual(["asian"]);
    expect(
      cuisinesFromLabels([leaf("Middle Eastern Restaurant > Shawarma Restaurant")]),
    ).toEqual(["mediterranean"]);
    expect(
      cuisinesFromLabels([leaf("Indian Restaurant > South Indian Restaurant")]),
    ).toEqual(["indian"]);
  });

  it("catches Indian-Chinese, which the Indian prefix would miss", () => {
    // A separate top-level node in the taxonomy; listed explicitly because a
    // silent near-miss is the failure mode this suite exists for.
    expect(cuisinesFromLabels([leaf("Indian Chinese Restaurant")])).toEqual(["indian"]);
  });

  it("does not let one prefix bleed into a sibling that merely starts alike", () => {
    // "Indian Chinese Restaurant" must not be swept up BY the plain "Indian
    // Restaurant" prefix — it matches only because it is named. Proven by
    // removing the explicit entry's effect: a fabricated sibling stays unmatched.
    expect(cuisinesFromLabels([leaf("Indian Ocean Seafood Restaurant")])).toEqual([]);
    expect(cuisinesFromLabels([leaf("Italian Ice Shop")])).toEqual([]);
  });

  it("returns nothing for a bare restaurant — honest absence, not a guess", () => {
    // 15.1% of pooled restaurants look exactly like this.
    expect(cuisinesFromLabels([RESTAURANT_BRANCH])).toEqual([]);
    expect(cuisinesFromLabels([])).toEqual([]);
  });

  it("leaves Pizzeria untagged, which is a decision and is pinned as one", () => {
    // FSQ files Pizzeria as its own top-level node, not under Italian.
    // If this test fails, someone changed the ruling — that is the point.
    expect(cuisinesFromLabels([leaf("Pizzeria")])).toEqual([]);
  });

  it("ignores labels outside the restaurant branch", () => {
    expect(
      cuisinesFromLabels([
        "Landmarks and Outdoors > Park",
        "Retail > Food and Beverage Retail > Farmers Market",
      ]),
    ).toEqual([]);
  });

  it("is order-stable regardless of how the labels arrive", () => {
    const a = cuisinesFromLabels([
      leaf("Italian Restaurant"),
      leaf("Asian Restaurant > Thai Restaurant"),
    ]);
    const b = cuisinesFromLabels([
      leaf("Asian Restaurant > Thai Restaurant"),
      leaf("Italian Restaurant"),
    ]);
    expect(a).toEqual(b);
    // Declaration order, not insertion order.
    expect(a).toEqual(["thai", "italian", "asian"]);
  });

  it("dedupes when several labels point at the same cuisine", () => {
    expect(
      cuisinesFromLabels([
        leaf("Asian Restaurant > Japanese Restaurant"),
        leaf("Asian Restaurant > Japanese Restaurant > Sushi Restaurant"),
        leaf("Asian Restaurant > Korean Restaurant"),
      ]),
    ).toEqual(["asian"]);
  });
});

describe("the map itself", () => {
  it("gives every offered cuisine at least one prefix", () => {
    // Asserted PER CUISINE, not over the set. Session 13's law: a rule
    // asserts that a branch exists, or a dead one hides behind live siblings.
    for (const tag of CUISINE_TAGS) {
      expect(CUISINE_PREFIXES[tag].length, tag).toBeGreaterThan(0);
      for (const prefix of CUISINE_PREFIXES[tag]) {
        expect(prefix.trim(), `${tag} prefix`).toBe(prefix);
        expect(prefix.length, `${tag} prefix`).toBeGreaterThan(0);
      }
    }
  });

  it("recognises exactly the offered tags", () => {
    for (const tag of CUISINE_TAGS) expect(isCuisineTag(tag)).toBe(true);
    expect(isCuisineTag("klingon")).toBe(false);
    expect(isCuisineTag("")).toBe(false);
    expect(isCuisineTag("Thai")).toBe(false); // case matters at the boundary
  });
});
