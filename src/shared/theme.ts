/**
 * DAY THEMES — the organizing mode above the arc (XXX-40, Session 14 CP1).
 *
 * Session 11 gave every day an ARC: a centrepiece and a shape around it. The
 * founder's curation round then said what the arc still cannot express:
 *
 *   > *"A DAY CANNOT BE SOLELY ANCHORED ON ANY ONE MUSEUM ... BUT A HISTORY
 *   > TOUR OF TORONTO WOULD BE AN ANCHOR"*
 *
 * That is a THEME, not a venue — Session 12's finding 3(ii) restated in the
 * founder's own words: *the arc composes a shape; nothing composes a theme.*
 * Golden Day 7 arrives at the same place from the other direction, where the
 * centrepiece is eight hours on an island containing named micro-activities.
 *
 * Three modes, and they differ in WHAT PLAYS THE ANCHOR:
 *
 *   venue      — today's arc, unchanged. One elected venue is the centre.
 *   thread     — the NARRATIVE is the anchor. 2–3 same-family sites woven as
 *                a spine; no single anchor venue.
 *   experience — a COMPOSITE BLOCK is the anchor: multi-hour, containing
 *                micro-activities, with provisioning upstream and an
 *                experiential travel leg.
 *
 * Dependency-free (src/shared law): no I/O, no React, no server imports. The
 * engine reads these; the tasting room's picker reads the same list.
 */

import type { PlaceCategory } from "./vocabulary";

export const DAY_THEME_MODES = ["venue", "thread", "experience"] as const;
export type DayThemeMode = (typeof DAY_THEME_MODES)[number];

export const THREAD_IDS = ["history-of-toronto"] as const;
export type ThreadId = (typeof THREAD_IDS)[number];

export const EXPERIENCE_IDS = ["toronto-islands"] as const;
export type ExperienceId = (typeof EXPERIENCE_IDS)[number];

/**
 * A discriminated union rather than `{mode, threadId?, experienceId?}` —
 * CLAUDE.md's standing preference, and here it earns it: a venue day has no
 * id, and a nullable id on a venue theme is a state the type would permit and
 * the engine would have to re-check at every read.
 */
export type DayTheme =
  | { mode: "venue" }
  | { mode: "thread"; threadId: ThreadId }
  | { mode: "experience"; experienceId: ExperienceId };

/** The themeless default. Named, so call sites do not spell it inline. */
export const VENUE_THEME: DayTheme = { mode: "venue" };

/**
 * How a day's theme was decided.
 *
 * "Concierge's choice" is deliberately NOT a fourth mode: it is the ABSENCE
 * of a request, and it resolves to `derived`. Modelling it as a mode would
 * let the tasting room express a theme the engine has no machinery for, and
 * would put a UI affordance into the domain vocabulary.
 */
export type ThemeSelection =
  | { origin: "requested"; theme: DayTheme }
  | { origin: "derived"; theme: DayTheme; reason: string };

/** Hand-set theme geography. Same shape as a discovery `Anchor`. */
export interface ThemeZone {
  slug: string;
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
}

/**
 * Zones a THEME may draw from — deliberately SEPARATE from the discovery
 * anchors, and that separation is the design (XXX-40, CP1 §1.4).
 *
 * Adding `toronto_islands` to `ANCHORS` would have had three silent
 * consequences, every one of them the vocabulary-widening failure this
 * codebase has now hit five times:
 *
 *   1. `zonesFor` gives the `icons_with_corners` lens `[...ANCHORS]`, so
 *      EVERY mixed-lens day would suddenly draw island venues;
 *   2. `buildRunPlan` iterates `ANCHORS × CATEGORIES`, so the next paid
 *      discovery run would quietly gain ~10 cells of spend;
 *   3. `nearestZone` would start labelling harbourfront places with an
 *      island neighbourhood.
 *
 * Separate lists, unioned only when a theme asks for one. Mainland days are
 * provably unaffected, and no `ZONE_SLACK_KM` was touched to reach the
 * islands — the refusal to nudge it is recorded at Session 14 CP0.
 *
 * The circle is hand-set like Session 4's nine, from OUR data, never
 * geocoded (decision 001 §3.2.3(c)(iv)). Measured against the pool it
 * reaches `Toronto Islands` (0.24 km), `Gibraltar Point Lighthouse`
 * (0.85 km), `Hanlan's Point Beach` (1.30 km) and `Ward's Island` (2.13 km)
 * — the 30 identities Session 14 CP0 measured as unreachable.
 */
export const THEME_ZONES: readonly ThemeZone[] = [
  {
    slug: "toronto_islands",
    label: "Toronto Islands",
    lat: 43.6205,
    lng: -79.3785,
    radiusM: 2500,
  },
];

export interface ThreadSpec {
  id: ThreadId;
  label: string;
  /**
   * The spine: the same-family sites the narrative is made of. It occupies
   * the ANCHOR and CONTRAST positions — roles adapt, because a thread has no
   * single centre for `electAnchor` to elect.
   */
  spine: {
    categories: PlaceCategory[];
    minStops: number;
    maxStops: number;
  };
  /** Overrides the lens's geography when present. */
  zones?: string[];
  /**
   * How many of the meal pattern's own stops this thread ABSORBS.
   *
   * Declared and unused in v1, on purpose. A food crawl is a legitimate
   * thread and its spine IS food — which collides with the composition rule
   * of record (meals are connective tissue, never the theme) and with
   * `pacing.maxFoodStops` (4): three pattern meals plus a three-stop crawl is
   * six food stops. Absorption is the mechanism that resolves it.
   *
   * Not built, because this session ships the culture thread its exam needs
   * and a crawl has no founder-drafted golden day to define it yet. The
   * interface does not preclude it; nothing reads it.
   */
  absorbsMeals?: number;
}

/**
 * **Wanderer threads — the successor design, recorded not built** (XXX-40,
 * founder-ratified concept, Session 14).
 *
 * A thread is infeasible for a wanderer in v1 and the picker says so with the
 * reason, because no wanderer template carries a `contrast` step: the CP1
 * ruling gave wanderers three intents and negative space, and a 2–3 stop
 * scheduled spine is in real tension with that.
 *
 * The successor is not "add a contrast step to wanderer templates". It is a
 * different shape of thread:
 *
 *   **Wanderer threads are THEMED ZONES, not themed slots — spine-as-geography.**
 *
 * Instead of dealing 2–3 same-family stops into scheduled positions, a
 * wanderer thread drifts historically-themed NEIGHBOURHOODS with loose
 * same-family anchors: the Old Town, the Distillery, Fort York as places to
 * be in rather than stops to arrive at. The spine becomes the day's
 * geography, which is exactly how a wanderer already experiences a city —
 * golden Day 5's *"the strip is the plan"*, applied to a theme.
 *
 * It needs a future template family and it needs the founder to say which
 * neighbourhoods carry which threads, so it is not invented here. The
 * interface does not preclude it: `ThreadSpec.zones` already exists and is
 * where spine-as-geography would live.
 */

export interface ExperienceSpec {
  id: ExperienceId;
  label: string;
  /**
   * The composite block. Its dwell comes from HERE and not from
   * `GRAMMAR_PARAMS.dwellMinutes` — the owner-swap ruled at Session 14 CP1.
   * `dwell.overstay` still fires, against `dwell.max` below: a composite
   * anchor is bounded by CURATION, not unbounded.
   */
  anchor: {
    categories: PlaceCategory[];
    dwell: { min: number; max: number };
    /** Named beats inside the block. Narration, never sub-slots. */
    microActivities: string[];
  };
  /** The stop that exists BECAUSE of the anchor. Causality is narrated. */
  provisioning?: {
    category: PlaceCategory;
    reason: string;
  };
  /** Scheduled travel this experience depends on. */
  legs?: {
    mode: "ferry";
    /** Key into the city-facts timetable, e.g. "ferry:hanlans". */
    routeKey: string;
  };
  zones: string[];
  /** Rain kills this day; the weather gate is a SELECTION input. */
  requiresGoodWeather: boolean;
  /**
   * How many of the meal pattern's own stops the composite block ABSORBS
   * (XXX-38, Session 14 Step 3 ruling 2).
   *
   * The picnic IS lunch, and the provisioning stop is its evidence. An
   * eight-hour block on an island cannot also break for a restaurant meal in
   * the middle of itself, and pretending otherwise is how golden Day 7 got
   * squeezed into the gap between lunch and dinner.
   *
   * Absorption drops the MIDDLE window, so the day's remaining meals are the
   * one before the block and the one after it — brunch and a conditional late
   * dinner, which is the founder's verified shape exactly.
   *
   * `absorbsMeals` was declared on `ThreadSpec` in CP1 and deliberately left
   * unbuilt. This is its first consumer.
   */
  absorbsMeals?: number;
}

/**
 * The threads. Literal data read once — the `ARC_TEMPLATES` pattern, and for
 * the same reason: no engine, no DSL, no inheritance, every row asserted
 * against invariants in tests.
 */
export const THREAD_SPECS: readonly ThreadSpec[] = [
  {
    id: "history-of-toronto",
    label: "A history of Toronto",
    /**
     * The founder's own example of a theme that CAN carry a day where a
     * single one of its stops cannot: *"a history tour of Toronto would be
     * an anchor"*. Culture family throughout — which is exactly what
     * `pickContrast` forbids for an ordinary day, and exactly why a thread
     * needs its own machinery rather than a cleverer contrast rule.
     */
    spine: {
      categories: ["historic_sites", "museums_galleries"],
      minStops: 2,
      maxStops: 3,
    },
  },
];

/**
 * The experiences. One, and it is golden Day 7 — the founder-verified
 * islands day this session is examined against.
 */
export const EXPERIENCE_SPECS: readonly ExperienceSpec[] = [
  {
    id: "toronto-islands",
    label: "A day on the Toronto Islands",
    anchor: {
      categories: ["parks", "scenic_viewpoints"],
      /**
       * 4–8 hours. Golden Day 7's own trap list names the failure this
       * replaces: *"capping the island at parks' 150-min dwell (composite
       * anchor must express 6–8h)"*.
       */
      dwell: { min: 240, max: 480 },
      microActivities: [
        "claim a spot on the beach",
        "picnic",
        "music and frisbee",
        "boardwalk drift toward the lighthouse",
        "sunset from the west-facing shore",
      ],
    },
    provisioning: {
      category: "grocery",
      reason:
        "the island has no supermarket — the picnic is why this stop exists",
    },
    legs: { mode: "ferry", routeKey: "ferry:hanlans" },
    zones: ["toronto_islands"],
    requiresGoodWeather: true,
    /**
     * One: the picnic. Golden Day 7 eats brunch at Mildred's before the
     * ferry and offers a CONDITIONAL late dinner after the 21:30 boat — the
     * middle meal happens on the beach, out of a grocery bag.
     */
    absorbsMeals: 1,
  },
];

/**
 * What every spec must hold, asserted in tests rather than trusted — the
 * `TEMPLATE_INVARIANTS` pattern.
 *
 * The composition rule of record is the load-bearing one: **meals and coffee
 * are connective tissue, never the theme.** The founder said it in those
 * words, and this session's own measurement agrees — 0.396 of the 0.567 raw
 * category-sequence overlap is the meal pattern alone. A day organised around
 * eating three times is not organised.
 *
 * Asserted PER SPEC and per category rather than over the set, per CLAUDE.md:
 * a set-level check passes forever on the one row that happens to be clean.
 */
export const THEME_INVARIANTS = {
  /** No spine or composite anchor may be built from a food category. */
  forbiddenCategories: ["restaurants", "cafes"] as readonly PlaceCategory[],
  /** A thread needs at least two stops, or it is a venue day with extra words. */
  threadMinStops: 2,
  /** Above three the spine stops being a spine and becomes the whole day. */
  threadMaxStops: 3,
  /** Below this a "composite" block is just a long stop. */
  compositeMinDwellMinutes: 240,
};

export function threadSpec(id: ThreadId): ThreadSpec {
  const spec = THREAD_SPECS.find((t) => t.id === id);
  if (spec === undefined) throw new Error(`unknown thread "${id}"`);
  return spec;
}

export function experienceSpec(id: ExperienceId): ExperienceSpec {
  const spec = EXPERIENCE_SPECS.find((e) => e.id === id);
  if (spec === undefined) throw new Error(`unknown experience "${id}"`);
  return spec;
}

/** Stable id for the trace, across all three modes. */
export function themeId(theme: DayTheme): string {
  switch (theme.mode) {
    case "venue":
      return "venue";
    case "thread":
      return `thread:${theme.threadId}`;
    case "experience":
      return `experience:${theme.experienceId}`;
  }
}

/**
 * Why a theme is not possible for this day. Honest failure, never a silent
 * downgrade to a venue day (constraint 4, pointed at scheduling).
 */
export type ThemeInfeasibility =
  /** No template of this traveller's shape can hold the theme. */
  | { reason: "no-template"; detail: string }
  /** A scheduled route the theme depends on does not run on this date. */
  | { reason: "route-out-of-season"; detail: string }
  /** The theme needs weather it is not going to get. */
  | { reason: "weather"; detail: string };

/** The zones a theme draws from; empty = it has no geography of its own. */
export function themeZoneSlugs(theme: DayTheme): readonly string[] {
  switch (theme.mode) {
    case "venue":
      return [];
    case "thread":
      return threadSpec(theme.threadId).zones ?? [];
    case "experience":
      return experienceSpec(theme.experienceId).zones;
  }
}
