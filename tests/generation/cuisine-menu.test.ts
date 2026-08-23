import { describe, expect, it } from "vitest";
import { CUISINE_MENU_DEPTH, allocateMenu } from "@/server/generation/engine";
import type { Candidate } from "@/server/generation/types";
import type { CuisineTag } from "@/shared/cuisine";
import type { PlaceCategory } from "@/shared/vocabulary";

/**
 * The cuisine reservation at the MENU (XXX-43).
 *
 * This is where a stated cuisine acts, and the location was decided by
 * measurement, not preference. A flat bonus inside `scoreCandidate` was built
 * first and thrown away: swept over 20,000 seeds, every additive value big
 * enough to survive the exploration jitter also inverted the icons-vs-corners
 * axis a large share of the time — 0.03 inverted 6%, 0.10 inverted 70% —
 * because the corners margin's floor approaches zero. No constant was safe,
 * so the mechanism moved rather than the number.
 *
 * Both arms are asserted here, per Session 14's lesson that a correctly inert
 * feature and a dead one look identical from a green suite alone.
 */

function candidate(
  id: string,
  category: PlaceCategory,
  score: number,
  cuisines: CuisineTag[] = [],
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
    cuisines,
    googlePlaceId: null,
    rating: null,
    userRatingCount: null,
    detailsFetched: false,
    score,
  };
}

/** A field where the loved cuisine is deliberately NOT the best-scoring. */
const field = (): Candidate[] => [
  candidate("top-plain", "restaurants", 0.9),
  candidate("mid-thai", "restaurants", 0.6, ["thai", "asian"]),
  candidate("low-thai", "restaurants", 0.5, ["thai", "asian"]),
  candidate("third-thai", "restaurants", 0.4, ["thai", "asian"]),
  candidate("cafe-a", "cafes", 0.8),
  candidate("cafe-b", "cafes", 0.7),
];
const CATS: PlaceCategory[] = ["restaurants", "cafes"];

describe("cuisine reservation on the menu", () => {
  // ---- arm one: inert ------------------------------------------------------

  it("changes NOTHING when no cuisine was named", () => {
    // The byte-identity gate, at this seam. A traveller who named no cuisine
    // must get the menu they would have got before this feature existed.
    const withArg = allocateMenu(field(), CATS, 4, undefined, []);
    const withoutArg = allocateMenu(field(), CATS, 4);
    expect(withArg.map((c) => c.place.id)).toEqual(
      withoutArg.map((c) => c.place.id),
    );
    // And that menu is still purely score/round-robin ordered.
    expect(withoutArg[0]!.place.id).toBe("top-plain");
  });

  it("changes nothing when the named cuisine is absent from the field", () => {
    const none = allocateMenu(field(), CATS, 4, undefined, ["italian"]);
    expect(none.map((c) => c.place.id)).toEqual(
      allocateMenu(field(), CATS, 4).map((c) => c.place.id),
    );
  });

  // ---- arm two: it fires ---------------------------------------------------

  it("FIRES: a named cuisine reaches the head of the menu", () => {
    const menu = allocateMenu(field(), CATS, 4, undefined, ["thai"]);
    expect(menu[0]!.place.id).toBe("mid-thai");
  });

  it("reserves a PAIR, because the best one may already be seated elsewhere", () => {
    // The licensed-close lesson, reused: one reserved slot is not enough when
    // the top venue of that kind is already on the day.
    const menu = allocateMenu(field(), CATS, 6, undefined, ["thai"]);
    const thai = menu.filter((c) => c.cuisines.includes("thai"));
    expect(thai.length).toBeGreaterThanOrEqual(2);
    expect(menu.slice(0, CUISINE_MENU_DEPTH).map((c) => c.place.id)).toEqual([
      "mid-thai",
      "low-thai",
    ]);
  });

  it("is BOUNDED — a preference reserves, it does not take over", () => {
    // Three Thai venues are available; only two may be reserved, so the rest
    // of the menu still offers the textures it exists to offer.
    const menu = allocateMenu(field(), CATS, 4, undefined, ["thai"]);
    const reserved = menu.slice(0, CUISINE_MENU_DEPTH);
    expect(reserved).toHaveLength(CUISINE_MENU_DEPTH);
    expect(menu.map((c) => c.place.id)).toContain("top-plain");
    expect(menu.some((c) => c.category === "cafes")).toBe(true);
  });

  it("never offers the same venue twice", () => {
    // The reserved picks must leave their categories' rotation lists, or the
    // round-robin deals them again and the menu silently shrinks.
    const menu = allocateMenu(field(), CATS, 6, undefined, ["thai"]);
    const ids = menu.map((c) => c.place.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the lens intact inside the reserved pair", () => {
    // Cuisine decides WHICH options are offered; the score — which carries
    // the icons-vs-corners axis — still orders them. The higher-scoring Thai
    // venue leads the lower-scoring one.
    const menu = allocateMenu(field(), CATS, 6, undefined, ["thai"]);
    expect(menu[0]!.score).toBeGreaterThan(menu[1]!.score);
  });

  it("still honours the family licence alongside a cuisine", () => {
    const withBoth = allocateMenu(field(), CATS, 6, "cafes", ["thai"]);
    const ids = withBoth.map((c) => c.place.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("mid-thai");
    expect(ids).toContain("cafe-a");
  });
});

/**
 * FAIRNESS ACROSS NAMED CUISINES (CP3 ruling).
 *
 * The live proof exposed this: a profile naming Thai AND Italian got Italian
 * on all three days, because Italian has 754 pooled places to Thai's 398 and
 * wins on volume. Nothing was broken — the traveller had named two things and
 * been shown one, which reads as not listening.
 *
 * The fix is structural, not a weight: the reservation deals ONE PER CUISINE
 * before a second of any, and the lead rotates by seed. So the mechanism
 * cannot prefer the deeper cuisine.
 */
describe("cuisine fairness", () => {
  /** Italian is deliberately deeper AND higher-scoring, as in the real pool. */
  const twoCuisineField = (): Candidate[] => [
    candidate("italian-1", "restaurants", 0.90, ["italian"]),
    candidate("italian-2", "restaurants", 0.88, ["italian"]),
    candidate("italian-3", "restaurants", 0.86, ["italian"]),
    candidate("thai-1", "restaurants", 0.60, ["thai", "asian"]),
    candidate("thai-2", "restaurants", 0.55, ["thai", "asian"]),
    candidate("plain", "restaurants", 0.95),
  ];

  it("deals one of EACH named cuisine before a second of either", () => {
    // Top-N-overall would have taken italian-1 and italian-2 here, because
    // both outscore every Thai venue. That is the defect the live run found.
    const menu = allocateMenu(twoCuisineField(), CATS, 6, undefined, [
      "italian",
      "thai",
    ]);
    const reserved = menu.slice(0, CUISINE_MENU_DEPTH);
    const cuisines = reserved.map((c) =>
      c.cuisines.includes("thai") ? "thai" : "italian",
    );
    expect(new Set(cuisines).size).toBe(2);
  });

  it("SURFACES BOTH within three days — the founder's own bar", () => {
    // Three consecutive rotations stand in for three days. Each day's menu
    // must offer both, and across the three neither cuisine may always lead.
    const leads: string[] = [];
    for (let day = 0; day < 3; day++) {
      const menu = allocateMenu(
        twoCuisineField(),
        CATS,
        6,
        undefined,
        ["italian", "thai"],
        day,
      );
      const reserved = menu.slice(0, CUISINE_MENU_DEPTH);
      const seen = new Set(
        reserved.map((c) => (c.cuisines.includes("thai") ? "thai" : "italian")),
      );
      expect(seen, `day ${day} offered only ${[...seen].join()}`).toEqual(
        new Set(["italian", "thai"]),
      );
      leads.push(reserved[0]!.cuisines.includes("thai") ? "thai" : "italian");
    }
    // And the lead actually rotates, rather than the same cuisine always
    // arriving first — which is what the traveller notices.
    expect(new Set(leads).size).toBeGreaterThan(1);
  });

  it("never counts one venue against two cuisines' shares", () => {
    // A Thai place is also `asian`. Letting it fill both shares would mean a
    // traveller who named Thai and Asian gets one venue and calls it two.
    const menu = allocateMenu(
      [
        candidate("thai-only", "restaurants", 0.9, ["thai", "asian"]),
        candidate("other-asian", "restaurants", 0.5, ["asian"]),
      ],
      CATS,
      6,
      undefined,
      ["thai", "asian"],
    );
    const ids = menu.slice(0, CUISINE_MENU_DEPTH).map((c) => c.place.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("other-asian");
  });

  it("still works when only one cuisine is named", () => {
    const menu = allocateMenu(twoCuisineField(), CATS, 6, undefined, ["thai"]);
    const reserved = menu.slice(0, CUISINE_MENU_DEPTH);
    expect(reserved.every((c) => c.cuisines.includes("thai"))).toBe(true);
  });

  it("falls back gracefully when one named cuisine has nothing", () => {
    // Italian present, Thai absent: the reservation should still fill with
    // Italian rather than leaving a slot empty out of fairness.
    const italianOnly = twoCuisineField().filter(
      (c) => !c.cuisines.includes("thai"),
    );
    const menu = allocateMenu(italianOnly, CATS, 6, undefined, [
      "italian",
      "thai",
    ]);
    expect(menu.slice(0, CUISINE_MENU_DEPTH)).toHaveLength(CUISINE_MENU_DEPTH);
  });
});
