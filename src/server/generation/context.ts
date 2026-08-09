/**
 * Grammar-context assembly for the engine (thin, impure — it assembles,
 * it never judges). Weather windows come from Session 6's
 * `deriveSchedulingWindows` over the stored row (never reimplemented,
 * honest null past the horizon); daylight from the computed ephemeris
 * (tier 1); travel from Session 8's `assembleTravelProvider` — the
 * promised one-line provider swap, transit request-scoped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import type {
  AnchorBaseline,
  GrammarContext,
  MealPatternId,
  TravelTimeProvider,
} from "@/shared/day-grammar/types";
import type { Persona } from "@/shared/persona";
import {
  deriveSchedulingWindows,
  type SchedulingWindows,
} from "@/shared/scheduling-windows";
import type { PriceRange } from "@/shared/timeline";
import type { City } from "@/shared/vocabulary";
import { computeDaylight, type DaylightFact } from "../weather/ephemeris";
import { getWeatherDay } from "../weather/repo";

export interface Environment {
  daylight: DaylightFact;
  /** null = no weather row for the date (beyond horizon) — honest. */
  windows: SchedulingWindows | null;
}

export async function fetchEnvironment(
  supabase: SupabaseClient,
  city: City,
  date: string,
): Promise<Environment> {
  const daylight = computeDaylight(city, date);
  const row = await getWeatherDay(supabase, city, date);
  if (row === null || row.forecast === null) {
    return { daylight, windows: null };
  }
  return {
    daylight,
    windows: deriveSchedulingWindows(
      {
        date,
        timezone: row.timezone,
        hourly: row.forecast.hourly,
        airQualityHourly: row.air_quality?.hourly ?? null,
      },
      daylight,
    ),
  };
}

export function buildGrammarContext(options: {
  environment: Environment;
  mealPattern: MealPatternId;
  persona: Persona;
  budgetBand: PriceRange | null;
  lodging: GrammarContext["lodging"];
  anchorBaseline: Record<string, AnchorBaseline> | null;
  travel: TravelTimeProvider;
}): GrammarContext {
  return {
    daylight: options.environment.daylight,
    windows: options.environment.windows,
    mealPattern: options.mealPattern,
    persona: { structure: options.persona.structure },
    budgetBand: options.budgetBand,
    lodging: options.lodging ?? null,
    anchorBaseline: options.anchorBaseline,
    travel: options.travel,
    params: GRAMMAR_PARAMS,
  };
}
