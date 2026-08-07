/**
 * The day-grammar validator's public surface (XXX-5).
 *
 * Everything here is pure and dependency-free: no I/O, no React, no
 * secrets, no Zod at runtime. That is what lets E5 run the same validator
 * in the browser for optimistic edit feedback that the server runs as the
 * generation gate — one implementation, not two that drift.
 */

export { GRAMMAR_PARAMS } from "./params";
export type {
  DwellRange,
  GrammarParams,
  MealPatternSpec,
  MealWindow,
  ModeFactors,
  TravelProfile,
} from "./params";

export { HaversineStubProvider, MatrixTravelProvider, haversineKm } from "./travel";

export {
  advisoriesOnly,
  assertWellFormed,
  hasViolations,
  validateDay,
  violationsOnly,
} from "./validate";

export { RULE_IDS, MEAL_PATTERNS, PERSONA_STRUCTURES, NO_TAGS } from "./types";
export type {
  AnchorBaseline,
  BusinessStatus,
  DayArchetype,
  GrammarContext,
  GrammarDay,
  GrammarFact,
  GrammarPlace,
  GrammarSlot,
  HoursByWeekday,
  JsonValue,
  LatLng,
  MealPatternId,
  OpenInterval,
  PersonaStructure,
  PlaceTags,
  Provenance,
  RecurringOffering,
  Reservability,
  RuleId,
  SeasonalRange,
  Severity,
  TravelEstimate,
  TravelQuery,
  TravelTimeProvider,
  Violation,
} from "./types";
