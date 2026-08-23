/**
 * The traveller's standing facts (XXX-43, Session 15) — the front door's
 * memory.
 *
 * The founder's verdict that reopened the roadmap: *"I have no ability to
 * tell things I like… I don't drink, I love Italian, Thai."* Everything here
 * is the answer to that, and everything here is **tier 1**: their word about
 * their own taste is absolute, and no API can correct it.
 *
 * SINGLE-OWNER RULING (CP1, ratified). The profile sheet owns STANDING facts;
 * the parser owns THIS DAY'S request. A constraint typed into the chat box
 * applies to that day only, and becomes standing solely when the user taps to
 * keep it. A parse is an inference, and an inference must not write a
 * permanent fact about a person. The founder additionally ruled out the
 * one-tap promotion from the day screen: the profile sheet is the only door.
 *
 * Dependency-free by the `src/shared/` law — the interview UI, the API
 * boundary and the engine all read this shape.
 */

import type { CuisineTag } from "./cuisine";
import type { DietaryTag } from "./dietary";
import {
  FOOD_COURAGES,
  INTEREST_TAGS,
  LENSES,
  PACES,
  type FoodCourage,
  type InterestTag,
  type Lens,
  type Pace,
  type Persona,
} from "./persona";
import type { PlaceCategory } from "./vocabulary";

/** How many interests the interview takes, in order. Positional weights
 *  in `GRAVITY_WEIGHTS` are defined for exactly three. */
export const MAX_INTERESTS = 3;

/**
 * What the interview asked and the user answered.
 *
 * Every field is optional-and-absent rather than defaulted, because SKIPPING
 * is a real answer and must not be indistinguishable from choosing. A day
 * built on a skipped dimension says "concierge's choice" for it; a day built
 * on a defaulted one would claim the traveller chose something they never saw.
 */
export interface TasteProfile {
  /** Interests in gravity order, most important first. */
  interests?: InterestTag[];
  pace?: Pace;
  foodCourage?: FoodCourage;
  lens?: Lens;
  /** `scheduler` | `wanderer` — derived from pace unless asked directly. */
  structure?: Persona["structure"];

  /** Hard constraints. "I don't drink" lands here as `nightlife_bars`. */
  excludedCategories: PlaceCategory[];
  /** Leanings, never guarantees — see `dietary.ts`. */
  dietary: DietaryTag[];
  /** Positive taste. */
  lovedCuisines: CuisineTag[];
}

/** The empty profile — a user who has told us nothing yet. */
export const EMPTY_PROFILE: TasteProfile = {
  excludedCategories: [],
  dietary: [],
  lovedCuisines: [],
};

/**
 * Has this traveller told us anything at all?
 *
 * Used to decide whether a request is "profile-free", which is the arm the
 * byte-identity gate protects: a profile-free request must generate exactly
 * the day it generated before this session existed.
 */
export function isEmptyProfile(profile: TasteProfile): boolean {
  return (
    (profile.interests?.length ?? 0) === 0 &&
    profile.pace === undefined &&
    profile.foodCourage === undefined &&
    profile.lens === undefined &&
    profile.structure === undefined &&
    profile.excludedCategories.length === 0 &&
    profile.dietary.length === 0 &&
    profile.lovedCuisines.length === 0
  );
}

/**
 * The DEFAULTS a skipped dimension falls back to, named once and here.
 *
 * These are not opinions about travellers; they are the values the engine has
 * always used for a persona that did not express one, kept identical so a
 * half-finished interview cannot move composition for the dimensions it did
 * not touch. `moderate`/`comfort`/`icons_with_corners` is the middle of every
 * axis — the concierge declining to assume rather than guessing boldly.
 */
export const PROFILE_FALLBACK = {
  pace: "moderate",
  foodCourage: "comfort",
  lens: "icons_with_corners",
  /** A scheduler's day has a shape; it is the safer floor for a stranger. */
  structure: "scheduler",
  /** Nothing stated → the engine's own gravity ordering applies unchanged. */
  interests: ["food", "local_life", "history"],
} as const satisfies {
  pace: Pace;
  foodCourage: FoodCourage;
  lens: Lens;
  structure: Persona["structure"];
  interests: readonly InterestTag[];
};

/**
 * Profile → the `Persona` the engine has always taken.
 *
 * This is the whole reason `Persona` was written dependency-free in Session 9
 * with the note that *"when E6 lands, it derives a Persona from the learned
 * profile and `generateDay` does not change"*. That promise is collected
 * here: the engine's contract is untouched by this session.
 *
 * Pure and total.
 */
export function personaFromProfile(profile: TasteProfile): Persona {
  const interests =
    profile.interests !== undefined && profile.interests.length > 0
      ? profile.interests.slice(0, MAX_INTERESTS)
      : [...PROFILE_FALLBACK.interests];
  return {
    pace: profile.pace ?? PROFILE_FALLBACK.pace,
    gravity: interests,
    foodCourage: profile.foodCourage ?? PROFILE_FALLBACK.foodCourage,
    structure: profile.structure ?? PROFILE_FALLBACK.structure,
    lens: profile.lens ?? PROFILE_FALLBACK.lens,
  };
}

/**
 * Which interview dimensions this traveller has NOT answered.
 *
 * The honest-absence surface: the day view uses it to say "concierge's
 * choice" for a dimension rather than implying the traveller picked it.
 */
export function unansweredDimensions(profile: TasteProfile): string[] {
  const missing: string[] = [];
  if ((profile.interests?.length ?? 0) === 0) missing.push("interests");
  if (profile.pace === undefined) missing.push("pace");
  if (profile.foodCourage === undefined) missing.push("food");
  if (profile.lens === undefined) missing.push("lens");
  return missing;
}

/** Runtime guards for the API boundary — parse, don't validate-and-hope. */
export const isInterestTag = (v: string): v is InterestTag =>
  (INTEREST_TAGS as readonly string[]).includes(v);
export const isPace = (v: string): v is Pace =>
  (PACES as readonly string[]).includes(v);
export const isFoodCourage = (v: string): v is FoodCourage =>
  (FOOD_COURAGES as readonly string[]).includes(v);
export const isLens = (v: string): v is Lens =>
  (LENSES as readonly string[]).includes(v);
