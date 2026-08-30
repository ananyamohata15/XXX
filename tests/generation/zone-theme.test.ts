/**
 * Zone days — a district as the day's centre (XXX-47, Session 16 CP3).
 *
 * The founder named DISTRICTS as destinations ("Yorkville", "Queen St W") and
 * the pool holds only venues. This is the mode that gives that request
 * somewhere to land, and the tests below are organised around the three
 * things that could go wrong with it: the request could be lost at a seam,
 * the day could stop being an ordinary day, or a thin district could starve a
 * step in silence.
 */

import { describe, expect, it } from "vitest";
import { buildSkeleton } from "@/server/generation/compose";
import {
  spillDistricts,
  starvedIntentIds,
  zonesFor,
} from "@/server/generation/retrieve";
import { allRequestableThemes } from "@/server/generation/theme-select";
import type { Candidate, GenerationRequest } from "@/server/generation/types";
import { DISTRICTS, districtBySlug, districtLabel } from "@/shared/districts";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import {
  THEME_ZONES,
  ZONE_SLUGS,
  themeFromKey,
  themeId,
  themeLabel,
  themeZoneSlugs,
  type DayTheme,
} from "@/shared/theme";
import type { PlaceCategory } from "@/shared/vocabulary";

const YORKVILLE: DayTheme = { mode: "zone", zoneSlug: "yorkville" };
const SEED = 42;

const request = (): GenerationRequest => ({
  city: "toronto",
  date: "2026-08-29",
  persona: GOLDEN_PERSONAS["persona-shopper"]!,
  budgetBand: null,
  transport: ["walk", "transit"],
  seed: SEED,
});

describe("a district is one thing, in one place", () => {
  it("PREMISE: the districts the founder named already exist as geography", () => {
    // Nothing needed surveying. What was missing was a way for a REQUEST to
    // name one — which is the whole ticket.
    expect(districtBySlug("yorkville")?.label).toBe("Yorkville");
    expect(districtBySlug("queen_west_ossington")?.label).toBe("Queen West");
  });

  it("has ONE list behind it — the theme vocabulary points at the geography", () => {
    // A second list of slugs in `theme.ts` would be twin drift with the ink
    // still wet: two answers to "which districts exist", free to disagree the
    // moment one gains a tenth.
    expect([...ZONE_SLUGS]).toEqual(DISTRICTS.map((d) => d.slug));
  });
});

describe("the request cannot be lost at a seam", () => {
  it("round-trips every requestable theme through its key", () => {
    // `themeId` and `themeFromKey` are inverses. If they ever stop being, a
    // request survives the client and dies at the engine — silently, which is
    // exactly how `wants` was lost for a whole session.
    for (const theme of allRequestableThemes()) {
      expect(themeFromKey(themeId(theme))).toEqual(theme);
    }
  });

  it("REJECTS an unknown id instead of casting it", () => {
    // The bug in the `TastingRoom` copy: an unknown mode fell into the
    // `experience` branch and cast the id, so a typo became a DayTheme that
    // throws four layers later inside `threadSpec`.
    expect(themeFromKey("thread:not-a-thread")).toBeNull();
    expect(themeFromKey("experience:not-an-experience")).toBeNull();
    expect(themeFromKey("zone:not-a-district")).toBeNull();
    expect(themeFromKey("nonsense")).toBeNull();
    expect(themeFromKey("")).toBeNull();
    expect(themeFromKey(null)).toBeNull();
  });

  it("resolves a district key that the old Concierge copy dropped in silence", () => {
    expect(themeFromKey("zone:yorkville")).toEqual(YORKVILLE);
  });

  it("is called what the traveller called it", () => {
    expect(themeLabel("zone:yorkville")).toBe("A day in Yorkville");
    expect(themeLabel("queen_west_ossington")).toBe("A day in Queen West");
  });
});

describe("a zone day is a venue day with its geography pinned", () => {
  it("does NOT take the anchor away from the arc", () => {
    // The three existing modes all answer "what plays the anchor". This one
    // answers "where", and leaving election alone is what makes it need no
    // composer branch at all.
    const themed = buildSkeleton(request(), { seed: SEED, theme: YORKVILLE });
    const plain = buildSkeleton(request(), { seed: SEED });
    expect(themed.electedAnchor).not.toBeNull();
    expect(themed.electedAnchor).toEqual(plain.electedAnchor);
  });

  it("produces the SAME skeleton a themeless day would", () => {
    // Byte-identity where no geography constraint applies: the theme changes
    // retrieval, and nothing else. If this ever diverges, a zone day has
    // quietly become a different kind of day.
    expect(buildSkeleton(request(), { seed: SEED, theme: YORKVILLE })).toEqual(
      buildSkeleton(request(), { seed: SEED }),
    );
  });

  it("IS its geography — that is the whole mode", () => {
    expect(themeZoneSlugs(YORKVILLE)).toEqual(["yorkville"]);
  });
});

describe("retrieval draws from the named district", () => {
  it("resolves a district slug with NO slack — the circle is the answer", () => {
    const zones = zonesFor("icons", [], undefined, ["yorkville"]);
    expect(zones.map((z) => z.slug)).toEqual(["yorkville"]);
    /**
     * Zero, and it was corrected by a live run rather than chosen. With the
     * ordinary 1 km of discovery slack, Yorkville's 800 m circle reached
     * 1.8 km and the probe produced a day titled "A day in Yorkville"
     * containing a stop the app itself labelled "Kensington Market" — the
     * admitting circle and the labelling circle disagreeing in front of the
     * traveller.
     *
     * Slack is SILENT widening. The spill is HONEST widening, and a zone day
     * gets only the honest kind.
     */
    expect(zones[0].slackKm).toBe(0);
  });

  it("still gives a hand-drawn THEME zone no slack at all", () => {
    // The islands circle was drawn against measured coordinates for one
    // purpose, and the extra kilometre reaches across the harbour.
    const zones = zonesFor("icons", [], undefined, ["toronto_islands"]);
    expect(zones[0].slackKm).toBe(0);
    expect(THEME_ZONES.some((z) => z.slug === "toronto_islands")).toBe(true);
  });

  it("THROWS on a slug that is neither — never a silent citywide day", () => {
    expect(() => zonesFor("icons", [], undefined, ["atlantis"])).toThrow(
      /unknown theme zone/,
    );
  });

  it("lets a user's own anchors outrank the district", () => {
    // Precedence, unchanged: user anchors > theme zones > lens bucket. A
    // committed booking is a geographic fact; a named district is a wish.
    const zones = zonesFor(
      "icons",
      [{ lat: 43.6503, lng: -79.3596 }],
      undefined,
      ["yorkville"],
    );
    expect(zones.some((z) => z.slug === "distillery")).toBe(true);
  });
});

describe("honest widening when a district starves a step", () => {
  const candidate = (category: PlaceCategory): Candidate =>
    ({ category }) as Candidate;

  const intents = [
    { id: "i1", categories: ["cafes", "markets"] as PlaceCategory[] },
    { id: "i2", categories: ["scenic_viewpoints"] as PlaceCategory[] },
  ];

  it("PREMISE: starvation is a real shape, not a hypothetical", () => {
    // Measured at CP2: Yorkville holds 884 venues and 7 viewpoints; the
    // Distillery holds 402 and 3. A district can be deep overall and empty
    // exactly where a day's edges need it.
    expect(starvedIntentIds(intents, [candidate("cafes")])).toEqual(["i2"]);
  });

  it("says nothing when every step has something of its kind", () => {
    expect(
      starvedIntentIds(intents, [candidate("markets"), candidate("scenic_viewpoints")]),
    ).toEqual([]);
  });

  it("spills into the NEAREST district, and never into itself", () => {
    const base = [districtBySlug("yorkville")!];
    const spill = spillDistricts(base, 1);
    expect(spill).toHaveLength(1);
    expect(spill[0].slug).not.toBe("yorkville");
    // Nearest by centre — a distance is a fact; an adjacency table is an
    // opinion that would need maintaining for every city.
    const others = DISTRICTS.filter((d) => d.slug !== "yorkville");
    const nearest = others.reduce((best, d) =>
      Math.hypot(d.lat - 43.6709, d.lng + 79.3933) <
      Math.hypot(best.lat - 43.6709, best.lng + 79.3933)
        ? d
        : best,
    );
    expect(spill[0].slug).toBe(nearest.slug);
  });

  it("is deterministic, so a trace replays exactly", () => {
    const base = [districtBySlug("distillery")!];
    expect(spillDistricts(base, 2)).toEqual(spillDistricts(base, 2));
  });

  it("runs out of city honestly rather than repeating a district", () => {
    const spill = spillDistricts(DISTRICTS.slice(), 3);
    expect(spill).toEqual([]);
  });

  it("names the districts a person would recognise", () => {
    for (const slug of ZONE_SLUGS) {
      expect(districtLabel(slug)).not.toBe(slug);
    }
  });
});
