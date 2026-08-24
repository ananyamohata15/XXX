/**
 * Theme selection — requested or derived (XXX-40, Session 14 CP1 §1.2).
 *
 * THE FUNNEL RULE, applied one layer higher than Session 12 applied it:
 * feasibility FILTERS first, affinity WEIGHTS, and the die ORDERS what
 * survives. A theme drawn before the filters would be a theme the engine
 * then has to refuse, which is how a funnel produces the illusion of choice.
 *
 * A REQUESTED theme that is infeasible FAILS — it never degrades quietly to a
 * venue day. Constraint 4 pointed at scheduling: someone who asked for the
 * islands in January must be told the ferry does not run, not handed a
 * mainland day with the same label.
 *
 * Pure: every input is passed in, including the feasibility answers, so this
 * is unit-testable without a database or a forecast.
 */

import { weightedOrderBy } from "@/shared/dice";
import { categoryLabel, type PlaceCategory } from "@/shared/vocabulary";
import { categoryAffinity, type Persona } from "@/shared/persona";
import {
  EXPERIENCE_SPECS,
  THREAD_SPECS,
  ZONE_SLUGS,
  VENUE_THEME,
  experienceSpec,
  themeId,
  threadSpec,
  type DayTheme,
  type ThemeInfeasibility,
  type ThemeSelection,
} from "@/shared/theme";
import { COMPOSE_PARAMS } from "./compose-params";

/**
 * Is this date fair enough for a day that needs it?
 *
 * `null` when there is no forecast row — and that null is load-bearing.
 * A weather-blind date must NOT silently refuse every experience: the
 * tasting room offers dates well past the forecast horizon, and treating
 * "we did not look" as "it will rain" would make the theme picker useless
 * for exactly the dates a founder vets on. Unknown reads as permitted, and
 * the day's own `weather.unknown` advisory carries the honesty.
 *
 * The bar is deliberately coarse — an experience day needs a usable
 * afternoon outdoors, not a perfect one. `outdoorFriendlyWindows` is
 * Session 6's own derivation and is consumed, never recomputed.
 */
export function environmentIsFair(environment: {
  windows: { outdoorFriendlyWindows: readonly unknown[] } | null;
}): boolean | null {
  if (environment.windows === null) return null;
  return environment.windows.outdoorFriendlyWindows.length > 0;
}

export interface ThemeFeasibilityInput {
  persona: Persona;
  /** Does a scheduled route run on this date? Answered from city facts. */
  routeRuns: (routeKey: string) => boolean;
  /**
   * Is the weather good enough for a day that needs it? `null` = unknown,
   * which is NOT the same as bad: a weather-blind date must not silently
   * refuse every experience, so an unknown reads as permitted and the day's
   * own `weather.unknown` advisory carries the honesty.
   */
  goodWeather: boolean | null;
  /** Can this traveller's template set hold the shape? */
  canHold: (theme: DayTheme) => boolean;
  /**
   * Did this traveller refuse this category? (XXX-43)
   *
   * A predicate rather than an array, mirroring `routeRuns` and `canHold`, so
   * this function stays pure and testable without a request.
   */
  excludes: (category: PlaceCategory) => boolean;
}

/**
 * The categories a theme's own SPINE depends on — the stops that make it
 * that theme rather than a day that happens to pass nearby.
 *
 * Extracted so `themeInfeasibility` and `themeAffinity` cannot drift apart
 * about what a theme is made of. They asked the same question in two places,
 * which is the shape of every constant this project has been bitten by.
 */
export function themeSpineCategories(theme: DayTheme): PlaceCategory[] {
  /**
   * A `switch`, not an `if` chain — changed at XXX-48 (Session 16 CP3).
   *
   * The chain ended `return []`, so a mode added to the vocabulary would have
   * fallen through to "this theme is made of nothing" in silence, and every
   * constraint check downstream would have agreed it was feasible. That is
   * the admit-list failure with a different keyword. Exhaustive switches on a
   * discriminated union make the compiler ask.
   */
  switch (theme.mode) {
    case "thread":
      return [...threadSpec(theme.threadId).spine.categories];
    case "experience": {
      const spec = experienceSpec(theme.experienceId);
      return [
        ...spec.anchor.categories,
        /**
         * Provisioning counts. The islands day buys its lunch before the
         * ferry, and a traveller who excluded `grocery` cannot run that
         * spine — a theme whose provisioning stop is refused is as infeasible
         * as one whose anchor is, and checking only the anchor would miss it.
         * The picnic inherits this for free: refuse `grocery` and the picnic
         * refuses itself, with the right reason.
         */
        ...(spec.provisioning !== undefined ? [spec.provisioning.category] : []),
      ];
    }
    case "venue":
    case "zone":
      /**
       * Neither has a spine, and for the same reason: both leave WHAT the day
       * is made of to the ordinary arc. A zone day pins WHERE and nothing
       * else, so no category is load-bearing for it and no exclusion can make
       * it infeasible — the arc's own palette narrowing handles refusals
       * exactly as it does on a themeless day.
       */
      return [];
  }
}

/** Why this theme cannot be built today, or null if it can. */
export function themeInfeasibility(
  theme: DayTheme,
  input: ThemeFeasibilityInput,
): ThemeInfeasibility | null {
  /**
   * A venue day is always possible, and so is a zone day — a district is
   * geography, and geography does not run out of season or need a boat.
   *
   * A district CAN be too thin to seat a full arc, and that is real: measured
   * at CP2, the Distillery holds 402 venues but only 3 viewpoints and 6
   * historic sites. It is deliberately NOT checked here, because this
   * function is pure and has no pool — and a feasibility answer that guessed
   * at pool depth would be exactly the confident-about-the-wrong-signal
   * failure. Starvation is detected where it can be MEASURED, at menu build,
   * and answered by spilling into the nearest district with the reason
   * narrated. Never a closed venue, never a silent failure, never a refusal
   * for a day that was buildable one street over.
   */
  if (theme.mode === "venue" || theme.mode === "zone") return null;

  if (!input.canHold(theme)) {
    return {
      reason: "no-template",
      detail:
        theme.mode === "thread"
          ? `a ${input.persona.structure}'s day has no shape that holds a 2–3 stop spine`
          : `a ${input.persona.structure}'s day has no shape that holds a multi-hour block`,
    };
  }

  if (theme.mode === "experience") {
    const spec = experienceSpec(theme.experienceId);
    if (spec.legs !== undefined && !input.routeRuns(spec.legs.routeKey)) {
      return {
        reason: "route-out-of-season",
        detail: `${spec.legs.routeKey} does not run on this date`,
      };
    }
    if (spec.requiresGoodWeather && input.goodWeather === false) {
      return {
        reason: "weather",
        detail: `${spec.label} needs weather this date is not going to give it`,
      };
    }
  }

  /**
   * The spine check runs LAST, after shape/route/weather, so the reported
   * reason is the one the traveller can act on first: a day that also needs a
   * ferry that is not running should say so rather than blaming a preference
   * the traveller cannot change their mind about as easily.
   */
  const refused = themeSpineCategories(theme).filter(input.excludes);
  if (refused.length > 0) {
    return {
      reason: "excluded-category",
      detail: `it is built around ${refused.map(categoryLabel).join(" and ")}, which this traveller asked not to be sent to`,
    };
  }
  return null;
}

/**
 * Themes the concierge may DERIVE — venue first, and deliberately no zones.
 *
 * **A zone theme is requestable, not derivable** (XXX-47, Session 16 CP3),
 * and the distinction is the product's, not a convenience:
 *
 * A theme the concierge derives is an answer to *"what kind of day suits this
 * traveller"*, and the modes above all answer it from taste — a history
 * thread for someone drawn to culture, a picnic for someone drawn to parks.
 * **"Which neighbourhood" is not a taste question.** Handing someone a day in
 * Leslieville because a die said so is the engine inventing a destination the
 * traveller never named, which is the opposite of the ruling that opened
 * Session 15: an explicit request outranks a standing default, and the
 * absence of a request is not a mandate to pick a district for them.
 *
 * It is also why adding nine derivable themes would have been wrong on the
 * evidence as well as the principle: every existing derived day's draw would
 * change, and the standing distinctiveness exams would be measuring a
 * different engine for a feature nobody asked to be automatic.
 *
 * `allRequestableThemes()` is the wider list — what a picker offers and a
 * parser may resolve to.
 */
export function allThemes(): DayTheme[] {
  return [
    VENUE_THEME,
    ...THREAD_SPECS.map((t): DayTheme => ({ mode: "thread", threadId: t.id })),
    ...EXPERIENCE_SPECS.map(
      (e): DayTheme => ({ mode: "experience", experienceId: e.id }),
    ),
  ];
}

/** Everything a traveller may ASK for, including every district. */
export function allRequestableThemes(): DayTheme[] {
  return [
    ...allThemes(),
    ...ZONE_SLUGS.map((zoneSlug): DayTheme => ({ mode: "zone", zoneSlug })),
  ];
}

/**
 * How much this traveller wants this theme, in affinity points — the same
 * scale every other draw in the composer uses.
 *
 * A venue theme is scored by the persona's own best non-food affinity, so a
 * themeless day COMPETES on the same axis rather than being a fallback.
 * Otherwise every persona with any interest at all would be handed a theme.
 */
export function themeAffinity(persona: Persona, theme: DayTheme): number {
  const categories =
    theme.mode === "thread"
      ? threadSpec(theme.threadId).spine.categories
      : theme.mode === "experience"
        ? experienceSpec(theme.experienceId).anchor.categories
        : // venue and zone: no spine, so both fall to the persona's own best
          // interest below. A zone theme never reaches the derived draw
          // anyway (see `allThemes`), but scoring it as a venue day is the
          // honest answer if it ever does — a day in Yorkville is, in taste
          // terms, exactly a venue day.
          [];
  if (categories.length === 0) {
    // The venue day's own weight: the persona's strongest single interest.
    return Math.max(
      0,
      ...(["museums_galleries", "historic_sites", "markets", "parks", "shopping", "scenic_viewpoints", "nightlife_bars"] as const).map(
        (c) => categoryAffinity(persona, c),
      ),
    );
  }
  return Math.max(...categories.map((c) => categoryAffinity(persona, c)));
}

export type ThemeOutcome =
  | { status: "selected"; selection: ThemeSelection }
  | {
      /** A REQUESTED theme that cannot be built. Never a silent downgrade. */
      status: "refused";
      theme: DayTheme;
      infeasibility: ThemeInfeasibility;
    };

export function selectTheme(input: {
  persona: Persona;
  /** The caller's request. `null`/absent = "concierge's choice" → derived. */
  requested?: DayTheme | null;
  feasibility: ThemeFeasibilityInput;
  /** The seeded stream for site "theme". */
  dice: () => number;
}): ThemeOutcome {
  const requested = input.requested ?? null;

  if (requested !== null) {
    const infeasibility = themeInfeasibility(requested, input.feasibility);
    if (infeasibility !== null) {
      return { status: "refused", theme: requested, infeasibility };
    }
    return {
      status: "selected",
      selection: { origin: "requested", theme: requested },
    };
  }

  // DERIVED. Filter, then weight, then roll — never the other way round.
  const feasible = allThemes().filter(
    (theme) => themeInfeasibility(theme, input.feasibility) === null,
  );
  const ordered = weightedOrderBy(
    feasible,
    (theme) => themeAffinity(input.persona, theme),
    input.dice,
    COMPOSE_PARAMS.dice.theme,
  );
  // `venue` is always feasible, so this list is never empty.
  const theme = ordered[0] ?? VENUE_THEME;
  return {
    status: "selected",
    selection: {
      origin: "derived",
      theme,
      reason:
        theme.mode === "venue"
          ? "no theme outranked a straightforward day for this traveller"
          : `${themeId(theme)} fits this traveller's interests and today's conditions`,
    },
  };
}
