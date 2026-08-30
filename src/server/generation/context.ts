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
import type { PlaceCategory, City, TransportMode } from "@/shared/vocabulary";
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
  /** Trip circumstance — the leg-exposure rule needs it (XXX-35). */
  transport: TransportMode[];
  /**
   * The traveller's refused categories (XXX-43).
   *
   * **REQUIRED, and explicitly nullable — changed at XXX-47 (Session 16 CP2)
   * because being optional is what made the backstop dead code.**
   *
   * `null` still means what it always meant: we were not told, so the rule
   * must stay silent rather than assert there were no constraints. What is
   * gone is the ability to reach that state by SAYING NOTHING. Session 15
   * built this field, the rule that reads it, nine upstream seams and a trap
   * fixture — and the engine's only validation context never passed it, so
   * `checkConstraints` returned on its first line for every day this product
   * has ever generated. The rule described as *"the one place that cannot be
   * forgotten"* was forgotten at the wire-up.
   *
   * An optional parameter defaulting to the safe-looking value is the
   * admit-list failure wearing a function signature: the caller who forgets
   * gets silence, and silence is indistinguishable from correctness. Required
   * means the compiler asks every caller, including the next one.
   */
  excludedCategories: readonly PlaceCategory[] | null;
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
    transport: options.transport,
    excludedCategories: options.excludedCategories,
    params: GRAMMAR_PARAMS,
  };
}
