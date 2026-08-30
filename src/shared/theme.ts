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

import { DISTRICTS, districtLabel } from "./districts";
import type { PlaceCategory } from "./vocabulary";

/**
 * `zone` joins at XXX-47 (Session 16 CP3, founder ruling).
 *
 * The founder named DISTRICTS as destinations — *"Yorkville", "Queen St W"* —
 * and the pool holds only venues. A district is not a venue and cannot be
 * elected as one; it is an answer to a different question. The three existing
 * modes all answer *what plays the anchor*; this one answers **where the day
 * happens**, and leaves the anchor to the ordinary arc.
 *
 * Which is why a zone day needs no composer branch at all: `experience` and
 * `thread` stay null, `themeOwnsAnchor` stays false, `electAnchor` runs as it
 * always did. **A zone day is a venue day with its geography pinned.** The
 * theme owns WHERE; the arc owns WHAT.
 *
 * It is also what *"shopping day"* means in practice, which is why XXX-41's
 * named districts route here rather than into a fourth kind of anchor.
 */
export const DAY_THEME_MODES = ["venue", "thread", "experience", "zone"] as const;
export type DayThemeMode = (typeof DAY_THEME_MODES)[number];

export const THREAD_IDS = ["history-of-toronto"] as const;
export type ThreadId = (typeof THREAD_IDS)[number];

/**
 * `park-picnic` joins at XXX-48 (Session 16 CP3).
 *
 * Widening a VOCABULARY is a behaviour change, and the standing instruction is
 * to hunt the lists that enumerated the old one. Hunted, and recorded so the
 * next widening starts from a map rather than a grep: `theme-select.ts`
 * (four mode branches), `compose.ts` (spec resolution), `engine.ts` (the
 * ferry timetable read and `canHold`), `parse-llm.ts` (the id vocabulary
 * offered to the parser), `api/tasting/generate/route.ts` (the Zod enum),
 * `TastingRoom.tsx` (the picker), `generation-report.ts` (the `--theme` arg).
 *
 * The mode branches were `if` chains that would have fallen through in
 * silence. They are exhaustive `switch`es now, so the compiler asks.
 */
export const EXPERIENCE_IDS = ["toronto-islands", "park-picnic"] as const;
export type ExperienceId = (typeof EXPERIENCE_IDS)[number];

/**
 * Districts offerable as a day's theme — ALL of them, and that is a decision.
 *
 * A curated subset would be an admit-list needing its own justification and
 * its own maintenance, and the list it would subset is already curated: nine
 * hand-set neighbourhoods a founder chose. Offering all nine means the tenth
 * district someone adds is offerable the day it lands, instead of defaulting
 * to "no" in the silence this project has now been bitten by five times.
 */
export const ZONE_SLUGS = DISTRICTS.map((d) => d.slug);

/**
 * A discriminated union rather than `{mode, threadId?, experienceId?}` —
 * CLAUDE.md's standing preference, and here it earns it: a venue day has no
 * id, and a nullable id on a venue theme is a state the type would permit and
 * the engine would have to re-check at every read.
 */
export type DayTheme =
  | { mode: "venue" }
  | { mode: "thread"; threadId: ThreadId }
  | { mode: "experience"; experienceId: ExperienceId }
  /** A named district is the day's centre. `zoneSlug` indexes `DISTRICTS`. */
  | { mode: "zone"; zoneSlug: string };

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
  /**
   * Zones this experience is BOUND to, or absent for one that is not.
   *
   * **OPTIONAL since XXX-48 (Session 16 CP3), and this was the only
   * structural blocker to a second experience.** Zone-binding is a property
   * of *the islands* — they are across a harbour and reachable by one boat —
   * not a property of *experiences*. A picnic wants a good park near the
   * traveller, not a fixed district, and forcing it to name one would either
   * invent a canonical picnic neighbourhood or bind every future experience
   * to a geography it does not have.
   *
   * Absent → `zonesFor` falls through to the traveller's own zones (the lens
   * bucket, or their anchors), which is the same door a themeless day uses.
   * The precedence line is unchanged and now reads: **user anchors > theme
   * zones > lens bucket**, with "theme zones" simply empty here.
   */
  zones?: string[];
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
  {
    /**
     * THE SECOND TENANT (XXX-48, Session 16 CP3) — and its whole point is
     * that the machinery did not have to change to hold it.
     *
     * The founder asked for a picnic and got four table-family stops and no
     * park. Not because a picnic is hard: because `EXPERIENCE_IDS` held
     * exactly one id and it was an island, so derivation had nothing mainland
     * to reach for and fell through to `venue` — which is the shape that
     * produces a meal-heavy day.
     *
     * **It is golden Day 7 minus the ferry**, which is the founder's own
     * framing and is exactly why it is the right second tenant: it exercises
     * the composite anchor, the provisioning causality, the meal absorption
     * and the weather refusal on a day that depends on no timetable. If the
     * experience layer is a layer, this costs one row. It cost one row and
     * one `?`.
     */
    id: "park-picnic",
    label: "A picnic in the park",
    anchor: {
      /**
       * `parks` alone, and NOT `["parks", "scenic_viewpoints"]` as the
       * islands spec carries. A lookout is a place you stand at; a picnic
       * needs ground to sit on for three hours. The islands day can use both
       * because the island IS the block and the lighthouse is a beat inside
       * it — here the park is the block, and a viewpoint composite would be a
       * different day wearing this one's name.
       */
      categories: ["parks"],
      /**
       * 2.5–4 hours, against the islands' 4–8.
       *
       * A picnic is not an expedition: there is no crossing at either end, so
       * the block does not have to absorb a ferry's worth of committed time.
       * The floor is `THEME_INVARIANTS.compositeMinDwellMinutes` exactly —
       * below 240 a "composite" block is just a long stop, and this sits at
       * the boundary deliberately rather than a comfortable distance above
       * it. The ceiling is what a Toronto afternoon holds before the light
       * goes; the daylight rules bound it further and the dusk clamp governs
       * an outdoor block regardless.
       */
      dwell: { min: 240, max: 360 },
      microActivities: [
        "spread the blanket and claim a patch of shade",
        "picnic",
        "cards, music, and nowhere to be",
        "a slow lap of the park when the light softens",
      ],
    },
    /**
     * The same mechanism as the islands', with its own reason — and the
     * reason is the point, not decoration.
     *
     * The islands' is *"the island has no supermarket"*, which is a fact
     * about geography. A city park has a supermarket two streets away, so the
     * causality here is not scarcity but SEQUENCE: the picnic is the reason
     * the shop happens, and a picnic you shop for afterwards is not one.
     * `movement.ts`'s "causality outranks distance" clause reads `role ===
     * "provision"` and so protects this without knowing which experience it
     * is serving.
     */
    provisioning: {
      category: "grocery",
      reason: "the picnic is what the basket is for — this stop comes first",
    },
    /**
     * NO `legs`. This is the field whose optionality was already there and
     * unused, and the ticket's own finding: a mainland experience simply
     * omits it. No ferry means no `routeRuns` gate, so a picnic is feasible
     * on a January date that refuses the islands — which is the layer proving
     * it is a layer.
     */
    /**
     * NO `zones`. The blocker this ticket removed. A picnic wants a good park
     * near the traveller; binding it to a district would either invent a
     * canonical picnic neighbourhood or hand every persona the same park.
     * Absent, `zonesFor` falls through to the traveller's own zones.
     */
    requiresGoodWeather: true,
    /**
     * One, and it is lunch. The founder's request was *"a picnic"*, and a
     * picnic IS the midday meal — the provisioning stop is its evidence, the
     * same argument the islands spec makes. Absorbing the middle window
     * leaves brunch before and a conditional dinner after, which is the shape
     * a picnic day actually has.
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
    case "zone":
      return `zone:${theme.zoneSlug}`;
  }
}

/**
 * A theme key back into a theme — the inverse of `themeId` (XXX-47).
 *
 * ONE OWNER, and it earns the word: this conversion existed in THREE places
 * before Session 16 CP3 — `Concierge.tsx`, `TastingRoom.tsx` and
 * `generation-report.ts` — each written independently, and they disagreed:
 *
 *   · `Concierge`'s returned `null` for anything it did not recognise, so a
 *     `zone:` key would have been SILENTLY DROPPED. That is the `wants`
 *     failure exactly — a request with nowhere to land, lost at the seam
 *     rather than downstream, and invisible in the trace.
 *   · `TastingRoom`'s had no fallback at all: an unknown mode fell into the
 *     `experience` branch and CAST the id, so `thread:typo` became a
 *     DayTheme that throws four layers later in `threadSpec`.
 *
 * Both are the twin-drift shape the ledger records five times, and neither
 * would have survived a fourth theme mode. So the question has one
 * implementation, it VALIDATES the id against the vocabulary rather than
 * asserting it, and an unknown key returns `null` — which every caller
 * already handles, because "no theme requested" is a state the engine has
 * always had.
 */
export function themeFromKey(key: string | null): DayTheme | null {
  if (key === null || key === "") return null;
  if (key === "venue") return VENUE_THEME;
  const separator = key.indexOf(":");
  if (separator < 0) return null;
  const mode = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (mode === "thread") {
    return (THREAD_IDS as readonly string[]).includes(id)
      ? { mode: "thread", threadId: id as ThreadId }
      : null;
  }
  if (mode === "experience") {
    return (EXPERIENCE_IDS as readonly string[]).includes(id)
      ? { mode: "experience", experienceId: id as ExperienceId }
      : null;
  }
  if (mode === "zone") {
    return ZONE_SLUGS.includes(id) ? { mode: "zone", zoneSlug: id } : null;
  }
  return null;
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
  | { reason: "weather"; detail: string }
  /**
   * The theme's own spine needs a category this traveller refused (XXX-43).
   *
   * A REFUSAL, never a substitution, and that is the ratified constraint law.
   * Quietly swapping the excluded category for another would hand the
   * traveller a day still called "a history of Toronto" that is no longer
   * one — the silent-fallback failure this project banned in constraint 4.
   * Honest absence applies to whole days, not only to facts.
   */
  | { reason: "excluded-category"; detail: string };

/** The zones a theme draws from; empty = it has no geography of its own. */
export function themeZoneSlugs(theme: DayTheme): readonly string[] {
  switch (theme.mode) {
    case "venue":
      return [];
    case "thread":
      return threadSpec(theme.threadId).zones ?? [];
    case "experience":
      /**
       * `?? []` is the picnic's whole structural change (XXX-48). An
       * experience with no zones of its own returns the same empty list a
       * VENUE day does — so `zonesFor` treats it identically and falls
       * through to the traveller's own geography. No new branch, no
       * citywide sentinel to remember to handle.
       */
      return experienceSpec(theme.experienceId).zones ?? [];
    case "zone":
      // A zone day IS its geography. This is the whole mode.
      return [theme.zoneSlug];
  }
}

/**
 * A theme's name, for a person (XXX-43, Session 15).
 *
 * The surface used to print `Theme: toronto-islands (derived)` in monospace.
 * That is an engine word and an engine concept ("derived" means the traveller
 * did not ask for a theme) on the product surface. The id keeps its home in
 * the Workshop; this is what a day is called out loud.
 */
export function themeLabel(id: string): string {
  const thread = THREAD_SPECS.find((t) => t.id === id);
  if (thread !== undefined) return thread.label;
  const experience = EXPERIENCE_SPECS.find((e) => e.id === id);
  if (experience !== undefined) return experience.label;
  // A zone day IS its district, so the district's own name is the title —
  // and it arrives here as the bare slug or the `zone:` key depending on the
  // caller, so both are accepted rather than one being the caller's problem.
  const slug = id.startsWith("zone:") ? id.slice(5) : id;
  if (ZONE_SLUGS.includes(slug)) return `A day in ${districtLabel(slug)}`;
  // `venue` and anything unnamed: a day built around one place has no title
  // beyond the place, and inventing one would be decoration.
  return "A day in Toronto";
}
