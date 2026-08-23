import { describe, expect, it } from "vitest";
import {
  DIETARY_PREFIXES,
  DIETARY_TAGS,
  dietaryFromLabels,
  isDietaryTag,
} from "@/shared/dietary";
import { RESTAURANT_BRANCH } from "@/shared/cuisine";
import {
  EMPTY_PROFILE,
  MAX_INTERESTS,
  PROFILE_FALLBACK,
  isEmptyProfile,
  personaFromProfile,
  unansweredDimensions,
  type TasteProfile,
} from "@/shared/profile";

const leaf = (sub: string) => `${RESTAURANT_BRANCH} > ${sub}`;
const profile = (over: Partial<TasteProfile> = {}): TasteProfile => ({
  ...EMPTY_PROFILE,
  ...over,
});

describe("personaFromProfile", () => {
  it("carries a fully answered interview straight through", () => {
    const p = personaFromProfile(
      profile({
        interests: ["food", "local_life", "nature"],
        pace: "relaxed",
        foodCourage: "adventurous",
        lens: "corners",
        structure: "wanderer",
      }),
    );
    expect(p).toEqual({
      pace: "relaxed",
      gravity: ["food", "local_life", "nature"],
      foodCourage: "adventurous",
      structure: "wanderer",
      lens: "corners",
    });
  });

  it("falls back per-dimension, so a half-finished interview still works", () => {
    // Skipping is a real answer. Answering ONE question must not force the
    // traveller to answer the rest before they can have a day.
    const p = personaFromProfile(profile({ lens: "icons" }));
    expect(p.lens).toBe("icons");
    expect(p.pace).toBe(PROFILE_FALLBACK.pace);
    expect(p.foodCourage).toBe(PROFILE_FALLBACK.foodCourage);
    expect(p.gravity).toEqual([...PROFILE_FALLBACK.interests]);
  });

  it("caps interests at the number the weights are defined for", () => {
    // GRAVITY_WEIGHTS has exactly three entries; a fourth interest would
    // weigh zero and read as "recorded but ignored", which is worse than
    // not taking it.
    const p = personaFromProfile(
      profile({
        interests: ["food", "art", "nature", "wine", "shopping"],
      }),
    );
    expect(p.gravity).toHaveLength(MAX_INTERESTS);
    expect(p.gravity).toEqual(["food", "art", "nature"]);
  });

  it("treats an empty interest list as unstated, not as no interests", () => {
    expect(personaFromProfile(profile({ interests: [] })).gravity).toEqual([
      ...PROFILE_FALLBACK.interests,
    ]);
  });

  it("is pure — the same profile always derives the same persona", () => {
    const p = profile({ interests: ["art"], pace: "packed" });
    expect(personaFromProfile(p)).toEqual(personaFromProfile(p));
  });
});

describe("isEmptyProfile — the arm the byte-identity gate protects", () => {
  it("is true for a traveller who has told us nothing", () => {
    expect(isEmptyProfile(EMPTY_PROFILE)).toBe(true);
  });

  it("is false the moment ANY single dimension is stated", () => {
    // Asserted per field rather than over the set: a gate that checked only
    // the constraint arrays would call a persona-only profile "empty" and
    // route it down the untouched path with a changed persona.
    expect(isEmptyProfile(profile({ pace: "relaxed" }))).toBe(false);
    expect(isEmptyProfile(profile({ lens: "icons" }))).toBe(false);
    expect(isEmptyProfile(profile({ foodCourage: "classic" }))).toBe(false);
    expect(isEmptyProfile(profile({ structure: "wanderer" }))).toBe(false);
    expect(isEmptyProfile(profile({ interests: ["art"] }))).toBe(false);
    expect(isEmptyProfile(profile({ excludedCategories: ["nightlife_bars"] }))).toBe(false);
    expect(isEmptyProfile(profile({ dietary: ["halal"] }))).toBe(false);
    expect(isEmptyProfile(profile({ lovedCuisines: ["thai"] }))).toBe(false);
  });
});

describe("unansweredDimensions", () => {
  it("names what the day must call concierge's choice", () => {
    expect(unansweredDimensions(EMPTY_PROFILE)).toEqual([
      "interests",
      "pace",
      "food",
      "lens",
    ]);
    expect(unansweredDimensions(profile({ pace: "packed" }))).not.toContain("pace");
  });
});

describe("dietaryFromLabels", () => {
  it("reads the four tags the taxonomy actually carries", () => {
    expect(dietaryFromLabels([leaf("Halal Restaurant")])).toEqual(["halal"]);
    expect(dietaryFromLabels([leaf("Gluten-Free Restaurant")])).toEqual([
      "gluten_free",
    ]);
    expect(
      dietaryFromLabels([leaf("Jewish Restaurant > Kosher Restaurant")]),
    ).toEqual(["kosher"]);
  });

  it("returns BOTH vegetarian and vegan for the one combined node", () => {
    // The taxonomy has a single "Vegan and Vegetarian Restaurant" node.
    // Splitting it would claim a distinction the source does not make — which
    // is exactly why dietary is a leaning and the day says so.
    expect(
      dietaryFromLabels([leaf("Vegan and Vegetarian Restaurant")]),
    ).toEqual(["vegetarian", "vegan"]);
  });

  it("says nothing about a venue the directory does not tag", () => {
    expect(dietaryFromLabels([RESTAURANT_BRANCH])).toEqual([]);
    expect(dietaryFromLabels([leaf("Pizzeria")])).toEqual([]);
    expect(dietaryFromLabels([])).toEqual([]);
  });

  it("gives every offered tag at least one prefix", () => {
    // Per tag, not over the set — a dead dietary rule would be a chip the
    // traveller can pick that can never be honoured.
    for (const tag of DIETARY_TAGS) {
      expect(DIETARY_PREFIXES[tag].length, tag).toBeGreaterThan(0);
    }
  });

  it("recognises exactly the offered tags", () => {
    for (const tag of DIETARY_TAGS) expect(isDietaryTag(tag)).toBe(true);
    // Deliberately absent: no label exists, so no chip may exist.
    expect(isDietaryTag("jain")).toBe(false);
    expect(isDietaryTag("nut_free")).toBe(false);
  });
});
