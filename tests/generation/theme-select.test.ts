/**
 * Theme selection — requested or derived (XXX-40, Session 14).
 *
 * The refusal arm matters most: a REQUESTED theme that cannot be built must
 * fail, never degrade to a venue day under the same label. Someone who asks
 * for the islands in January is told the ferry does not run.
 */

import { describe, expect, it } from "vitest";
import {
  allRequestableThemes,
  allThemes,
  environmentIsFair,
  selectTheme,
  themeAffinity,
  themeInfeasibility,
  type ThemeFeasibilityInput,
} from "@/server/generation/theme-select";
import { mulberry32 } from "@/shared/dice";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { ZONE_SLUGS } from "@/shared/theme";
import { VENUE_THEME, themeId, type DayTheme } from "@/shared/theme";

const ISLANDS: DayTheme = { mode: "experience", experienceId: "toronto-islands" };
const HISTORY: DayTheme = { mode: "thread", threadId: "history-of-toronto" };

const feasibility = (
  over: Partial<ThemeFeasibilityInput> = {},
): ThemeFeasibilityInput => ({
  persona: GOLDEN_PERSONAS["day-6-excursion"],
  routeRuns: () => true,
  goodWeather: true,
  canHold: () => true,
  excludes: () => false,
  ...over,
});

describe("a requested theme is refused, not downgraded", () => {
  it("refuses the islands when the route is out of season", () => {
    const outcome = selectTheme({
      persona: GOLDEN_PERSONAS["day-6-excursion"],
      requested: ISLANDS,
      feasibility: feasibility({ routeRuns: () => false }),
      dice: mulberry32(1),
    });
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.infeasibility.reason).toBe("route-out-of-season");
    // The thing that must never happen: a venue day wearing the island label.
    expect(themeId(outcome.theme)).toBe("experience:toronto-islands");
  });

  it("refuses it when the weather is known bad", () => {
    const outcome = selectTheme({
      persona: GOLDEN_PERSONAS["day-6-excursion"],
      requested: ISLANDS,
      feasibility: feasibility({ goodWeather: false }),
      dice: mulberry32(1),
    });
    expect(outcome.status).toBe("refused");
  });

  it("PERMITS it when the weather is unknown — absence is not bad news", () => {
    // The room offers dates past the forecast horizon on purpose. Treating
    // "we did not look" as "it will rain" would make the picker useless for
    // exactly the dates a founder vets on.
    const outcome = selectTheme({
      persona: GOLDEN_PERSONAS["day-6-excursion"],
      requested: ISLANDS,
      feasibility: feasibility({ goodWeather: null }),
      dice: mulberry32(1),
    });
    expect(outcome.status).toBe("selected");
  });

  it("refuses a thread for a traveller whose day cannot hold one", () => {
    const outcome = selectTheme({
      persona: GOLDEN_PERSONAS["day-5-wanderer"],
      requested: HISTORY,
      feasibility: feasibility({
        persona: GOLDEN_PERSONAS["day-5-wanderer"],
        canHold: (t) => t.mode !== "thread",
      }),
      dice: mulberry32(1),
    });
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.infeasibility.reason).toBe("no-template");
  });

  it("a venue theme is always possible", () => {
    expect(themeInfeasibility(VENUE_THEME, feasibility({
      routeRuns: () => false,
      goodWeather: false,
      canHold: () => false,
    }))).toBeNull();
  });
});

describe("concierge's choice derives, and filters before it rolls", () => {
  it("never derives a theme whose route does not run", () => {
    // The funnel rule: filter, then weight, then roll. A theme drawn before
    // the filters is a theme the engine then has to refuse.
    for (let seed = 0; seed < 25; seed += 1) {
      const outcome = selectTheme({
        persona: GOLDEN_PERSONAS["day-6-excursion"],
        requested: null,
        feasibility: feasibility({ routeRuns: () => false }),
        dice: mulberry32(seed),
      });
      expect(outcome.status).toBe("selected");
      if (outcome.status !== "selected") return;
      expect(themeId(outcome.selection.theme)).not.toBe(
        "experience:toronto-islands",
      );
    }
  });

  it("always reports how it decided", () => {
    const outcome = selectTheme({
      persona: GOLDEN_PERSONAS["day-6-excursion"],
      requested: null,
      feasibility: feasibility(),
      dice: mulberry32(3),
    });
    expect(outcome.status).toBe("selected");
    if (outcome.status !== "selected") return;
    expect(outcome.selection.origin).toBe("derived");
    if (outcome.selection.origin !== "derived") return;
    expect(outcome.selection.reason.length).toBeGreaterThan(0);
  });

  it("lets a themeless day COMPETE rather than be a fallback", () => {
    // A venue theme is weighted by the persona's own strongest interest, so
    // it is on the same axis. Otherwise anyone with any interest at all would
    // be handed a theme.
    const persona = GOLDEN_PERSONAS["day-1-jays"]; // food-first: no theme fits
    expect(themeAffinity(persona, VENUE_THEME)).toBeGreaterThan(0);
    expect(themeAffinity(persona, VENUE_THEME)).toBeGreaterThanOrEqual(
      themeAffinity(persona, HISTORY),
    );
  });

  it("offers every DERIVABLE theme, and no district", () => {
    expect(allThemes().map(themeId).sort()).toEqual([
      "experience:park-picnic",
      "experience:toronto-islands",
      "thread:history-of-toronto",
      "venue",
    ]);
    // `zone` is requestable, never derived. "Which neighbourhood" is not a
    // taste question, and handing someone a day in Leslieville because a die
    // said so is the engine inventing a destination they never named.
    expect(allThemes().some((t) => t.mode === "zone")).toBe(false);
  });

  it("makes every district REQUESTABLE, which is the other half", () => {
    // A mode that exists and cannot be reached is the XXX-48 defect exactly:
    // experience mode was unreachable for a whole session because the only
    // experience was an island. A zone mode nothing could ask for would be
    // the same bug with a new name.
    const requestable = allRequestableThemes().map(themeId);
    for (const slug of ZONE_SLUGS) expect(requestable).toContain(`zone:${slug}`);
    expect(requestable).toContain("experience:park-picnic");
  });

  it("still offers venue first, so a themeless day heads the list", () => {
    expect(themeId(allThemes()[0])).toBe("venue");
  });
});

describe("weather fairness reads Session 6's own derivation", () => {
  it("is null when there is no forecast row", () => {
    expect(environmentIsFair({ windows: null })).toBeNull();
  });

  it("is false only when the day has no outdoor-friendly window at all", () => {
    expect(environmentIsFair({ windows: { outdoorFriendlyWindows: [] } })).toBe(
      false,
    );
    expect(
      environmentIsFair({ windows: { outdoorFriendlyWindows: [{}] } }),
    ).toBe(true);
  });
});
