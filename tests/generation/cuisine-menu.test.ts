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
