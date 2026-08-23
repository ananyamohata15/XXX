/**
 * The chat request contract (XXX-43, Session 15) — free text → a request the
 * engine already accepts.
 *
 * The founder's words: *"a chat-based way to input would be better"*, and
 * *"i dont want dropdowns and stuff anymore"*. This is the shape the sentence
 * turns into. Dependency-free (`src/shared/` law) because three parties need
 * the same contract: the parser writes it, the engine reads it, and the
 * confirmation chips render it.
 *
 * THE CONTRACT IS THE CONTAINMENT. The selector had to defend an id space
 * because it names venues; this parser never names anything. There is no
 * place field, no free-form category, no prose that reaches the engine — so
 * a prompt injection has nowhere to land even if it survives the model.
 * Containment by absence of a field beats containment by filter.
 */

import type { CuisineTag } from "./cuisine";
import type { DietaryTag } from "./dietary";
import type { InterestTag } from "./persona";
import type { PlaceCategory } from "./vocabulary";

/** Who the day is for. Shapes pacing and party-size judgement, nothing more. */
export const PARTY_KINDS = ["solo", "couple", "friends", "family"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

/**
 * A day request, as the sentence stated it.
 *
 * Every field is nullable rather than optional because UNSTATED and
 * STATED-AS-NONE are different facts, and the confirmation chips must be able
 * to show the difference. "Saturday" with no budget is not the same request
 * as "Saturday, keep it cheap" with the budget later removed.
 */
export interface ParsedDayRequest {
  /**
   * What the traveller asked to DO (XXX-43, Session 15 CP4 defect 1).
   *
   * THE HOLE THIS FILLS, and it was mine. The first contract had fields for
   * what a sentence REFUSES, when it happens, who it is for, and what it
   * costs — and none for what it WANTS. So when the founder typed *"shopping,
   * pub hopping and food for today"*, the parser had nowhere to put
   * "shopping" or "pub hopping". Only "for today" survived, as a date.
   *
   * The trace proves it rather than suggesting it: his day recorded
   * `theme: "venue"`, `theme_origin: "derived"` — no request — and an anchor
   * elected on `markets` because *"food is this traveller's first
   * interest"*, which is his stored PROFILE speaking, not his sentence. The
   * words were not overwritten downstream; they were dropped at the contract,
   * because there was no field to hold them.
   *
   * Expressed as INTEREST TAGS rather than categories, because that is the
   * vocabulary the engine already reasons in: gravity → `categoryAffinity` →
   * the palette. A per-day `wants` overrides the profile's standing gravity
   * for that day, which is exactly what "today I want to do X" means.
   */
  wants: InterestTag[];
  /** A theme key the vocabulary knows, or null for concierge's choice. */
  theme: string | null;
  /** "YYYY-MM-DD", already resolved against today by the engine. */
  date: string | null;
  budgetMax: number | null;
  /** Categories the sentence refused. UNION-ed with the profile, never replacing it. */
  excludedCategories: PlaceCategory[];
  lovedCuisines: CuisineTag[];
  dietary: DietaryTag[];
  party: PartyKind | null;
  /**
   * *"if the weather's good"* — the founder's own phrasing, and a real
   * scheduling input: it makes an outdoor theme conditional rather than
   * assumed. Recorded here; the theme layer already consults weather.
   */
  weatherConditional: boolean;
}

export const EMPTY_REQUEST: ParsedDayRequest = {
  wants: [],
  theme: null,
  date: null,
  budgetMax: null,
  excludedCategories: [],
  lovedCuisines: [],
  dietary: [],
  party: null,
  weatherConditional: false,
};

/**
 * What a parse produced.
 *
 * A discriminated union rather than a request-with-a-question field, because
 * the two outcomes lead to different screens and a boolean flag would let a
 * caller render chips for a request that was never understood.
 */
export type ParseOutcome =
  | { status: "parsed"; request: ParsedDayRequest }
  /**
   * ONE question, never a silent guess.
   *
   * The floor differs from the selector's on purpose. The selector falls back
   * to a deterministic pick because a mechanical day is still a good day. A
   * parser has no such floor: a wrong guess about what someone asked for
   * builds a day that is confidently not theirs, which is the exact failure
   * XXX-43 exists to end. So when it does not know, it asks.
   */
  | { status: "needs-clarification"; question: string; suggestions: string[] };

/**
 * How a parsed request combines with the traveller's standing profile.
 *
 * MONOTONIC: the sentence may ADD a constraint, never silently LIFT one.
 *
 * A standing constraint is a tier-1 fact the traveller stated deliberately on
 * the profile sheet. A sentence is an inference drawn from prose. Letting the
 * weaker evidence quietly delete the stronger is how someone who told us they
 * do not drink ends up at a bar because they typed the word "cocktail" while
 * describing somewhere they were NOT going. When the two genuinely conflict,
 * that is a question for the traveller, not a decision for us — the caller
 * detects it with `conflictsWithProfile` and asks.
 */
export function mergeConstraints(
  profileExcluded: readonly PlaceCategory[],
  requestExcluded: readonly PlaceCategory[],
): PlaceCategory[] {
  const out = [...profileExcluded];
  for (const c of requestExcluded) if (!out.includes(c)) out.push(c);
  return out;
}

/**
 * Categories the sentence appears to WANT that the profile refuses.
 *
 * Returns what to ask about. Empty means no conflict and the merge is safe.
 */
export function conflictsWithProfile(
  profileExcluded: readonly PlaceCategory[],
  requestedCategories: readonly PlaceCategory[],
): PlaceCategory[] {
  return requestedCategories.filter((c) => profileExcluded.includes(c));
}

/**
 * Categories a stated INTEREST implies, for the conflict check.
 *
 * This is what finally lets `conflictsWithProfile` fire. It was written at
 * CP1, tested, and could never run — the contract had nothing to compare
 * against a standing exclusion, which the parse route recorded honestly as a
 * dead branch rather than wiring a guard that could not trip. With `wants` it
 * has an input: a traveller who says "pub hopping" while their profile
 * excludes bars is asking a question only they can answer.
 */
export const INTEREST_IMPLIES: Partial<Record<InterestTag, PlaceCategory[]>> = {
  nightlife: ["nightlife_bars"],
  shopping: ["shopping"],
  markets: ["markets"],
  art: ["museums_galleries"],
  history: ["historic_sites"],
  nature: ["parks"],
  views: ["scenic_viewpoints"],
  food: ["restaurants"],
};

/** The categories a set of stated wants asks for. */
export function categoriesWanted(
  wants: readonly InterestTag[],
): PlaceCategory[] {
  const out: PlaceCategory[] = [];
  for (const w of wants) {
    for (const c of INTEREST_IMPLIES[w] ?? []) if (!out.includes(c)) out.push(c);
  }
  return out;
}
