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
import { categoryAffinity, type Persona } from "@/shared/persona";
import {
  EXPERIENCE_SPECS,
  THREAD_SPECS,
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
}

/** Why this theme cannot be built today, or null if it can. */
export function themeInfeasibility(
  theme: DayTheme,
  input: ThemeFeasibilityInput,
): ThemeInfeasibility | null {
  if (theme.mode === "venue") return null;

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
  return null;
}

/** Every theme the vocabulary knows, venue first. */
export function allThemes(): DayTheme[] {
  return [
    VENUE_THEME,
    ...THREAD_SPECS.map((t): DayTheme => ({ mode: "thread", threadId: t.id })),
    ...EXPERIENCE_SPECS.map(
      (e): DayTheme => ({ mode: "experience", experienceId: e.id }),
    ),
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
        : [];
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
