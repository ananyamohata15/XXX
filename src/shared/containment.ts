/**
 * Container-vs-tenant (XXX-35, Session 13 Step 2, mining finding 2).
 *
 * The founder, on a day whose card was a cheese counter seated for 90
 * minutes:
 *
 *   *"Weird, its a shop in st lawerence, not worth 1hr 30 mins"* … *"Rather
 *   maybe the card should have been st Lawerence market, and in the
 *   description you should try olympic cheese + any other top reccos from st
 *   lawerence mkt"*
 *
 * A stall inside a market is a distinct FSQ identity from the market, and
 * nothing prefers the container. Dwell then follows the CATEGORY — Olympic
 * Cheese maps to `markets` on its second FSQ label — so one cheese counter
 * inherits a market hall's 75-minute typical.
 *
 * ## What the data actually supports, measured before anything was built
 *
 * `scripts/containment-probe.ts` tested the three signals that were on the
 * table over all 31,377 Toronto FSQ identities. Two of the three do not
 * work, and the third is not a corpus:
 *
 *  - **Co-location fails on precision.** In a dense retail district
 *    proximity says nothing: 62 places sit within 60 m of Kensington Flea
 *    Market, and they are street neighbours, not tenants. 154 of 200 markets
 *    have at least one neighbour inside the radius.
 *  - **Name containment fails on precision AND recall.** 26 pairs city-wide,
 *    of which 23 are one generic name matching another — "Farmer's Market"
 *    catching every farmers market in Toronto, some 22 km apart. Worse, it
 *    has **zero recall on the founder's own case**: "Olympic Cheese" does
 *    not contain "St Lawrence Market", so the one example that started this
 *    is invisible to it.
 *  - **`link_collision`** (proposed as the containment evidence) is **three
 *    rows** in the entire city, two of them the same district.
 *
 * So a general city-wide containment detector is not supportable on this
 * data, and building one would have been the speculative fix CLAUDE.md
 * forbids. What IS supportable is the observation that containers are few,
 * famous, and knowable: St. Lawrence Market, Kensington Market, the
 * Distillery District. A curated registry with a per-container footprint is
 * precise where a heuristic is not, and it is the same doctrine as
 * `anchor-calibre`'s founder list — operator trust, in a reviewed commit.
 *
 * Co-location then does the work it IS good at: once you already know the
 * container and its footprint, "is this inside it" is a distance question.
 * The probe confirms the geometry — Olympic Cheese sits 26 m from St
 * Lawrence Market.
 *
 * Pure and dependency-free. No I/O, no clock.
 */

import { haversineKm } from "./day-grammar/travel";
import type { LatLng } from "./day-grammar/types";

/**
 * A venue that contains other venues — TIER 1, founder-curated.
 *
 * `footprintMetres` is the container's own extent, not a search radius. It
 * must be small enough to exclude the street outside, which is the entire
 * lesson of the co-location measurement above.
 */
export interface Container {
  /** The pool's own spelling — matched exactly, per `anchor-calibre`. */
  name: string;
  coords: LatLng;
  footprintMetres: number;
  /** Why this radius. A footprint nobody justified is a constant nobody chose. */
  note: string;
}

/**
 * The curated container registry.
 *
 * Deliberately short and deliberately not inferred. Every entry carries the
 * coordinates the pool holds for it, so the footprint is measured from the
 * identity the engine would actually seat.
 */
export const CONTAINERS: readonly Container[] = [
  {
    name: "St Lawrence Market",
    coords: { lat: 43.64891, lng: -79.3717 },
    // The South Market hall. 60 m reaches the North Building (23 m) and the
    // lower-level tenants (57 m) without crossing Front Street.
    footprintMetres: 60,
    note: "market hall; tenants are stalls on two levels",
  },
];

export interface TenancyVerdict {
  /** The container this place sits inside, or null. */
  container: Container | null;
  /** Metres from the container's centre; null when there is no container. */
  distanceMetres: number | null;
  /**
   * Tier 3 ALWAYS. Even with a curated container, "this place is a tenant"
   * is inferred from geometry, and a neighbouring shop at the same address
   * is indistinguishable from a stall inside. Advisory, never a fact.
   */
  tier: 3;
  reason: string;
}

/** Normalized, exact — the same rule and the same reasons as anchor calibre. */
function sameName(a: string, b: string): boolean {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return n(a) === n(b);
}

/**
 * Is this place a tenant of a known container?
 *
 * The container itself is never its own tenant, which is why the name check
 * comes first: St Lawrence Market sits 0 m from St Lawrence Market.
 */
export function tenancyOf(place: {
  name: string;
  coords: LatLng;
}): TenancyVerdict {
  for (const container of CONTAINERS) {
    if (sameName(place.name, container.name)) {
      return {
        container: null,
        distanceMetres: 0,
        tier: 3,
        reason: `${place.name} IS the container`,
      };
    }
    const metres = haversineKm(place.coords, container.coords) * 1000;
    if (metres <= container.footprintMetres) {
      return {
        container,
        distanceMetres: Math.round(metres),
        tier: 3,
        reason: `${place.name} sits ${Math.round(metres)}m inside ${container.name}'s ${container.footprintMetres}m footprint — probably a tenant, not a destination`,
      };
    }
  }
  return {
    container: null,
    distanceMetres: null,
    tier: 3,
    reason: "no known container encloses this place",
  };
}
