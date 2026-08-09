/**
 * Shared plumbing for the rule families. Pure, small, and deliberately
 * boring — the interesting judgment belongs in the rules and in
 * GRAMMAR_PARAMS, not here.
 */

import { timeToMinutes } from "../time";
import type {
  GrammarDay,
  GrammarFact,
  GrammarPlace,
  GrammarSlot,
  JsonValue,
  OpenInterval,
  RuleId,
  Violation,
} from "./types";

/** Half-open minute interval [start, end). */
export interface Span {
  start: number;
  end: number;
}

export const spanOf = (s: { startTime: string; endTime: string }): Span => ({
  start: timeToMinutes(s.startTime),
  end: timeToMinutes(s.endTime),
});

export const spanOfInterval = (i: OpenInterval): Span => ({
  start: timeToMinutes(i.open),
  end: timeToMinutes(i.close),
});

export const durationOf = (s: Span): number => s.end - s.start;

export const overlaps = (a: Span, b: Span): boolean =>
  a.start < b.end && b.start < a.end;

/** Inclusive containment: a slot ending exactly at close is contained. */
export const contains = (outer: Span, inner: Span): boolean =>
  inner.start >= outer.start && inner.end <= outer.end;

export const overlapMinutes = (a: Span, b: Span): number =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Three-valued fact read. `undefined` (never fetched) and
 * `{status:"absent"}` (looked, not published) are different states and
 * several rules report them differently, so both survive here.
 */
export type FactRead<T> =
  | { state: "present"; value: T }
  | { state: "absent" }
  | { state: "unfetched" };

export function readFact<T>(fact: GrammarFact<T> | undefined): FactRead<T> {
  if (fact === undefined) return { state: "unfetched" };
  if (fact.status === "absent") return { state: "absent" };
  return { state: "present", value: fact.value };
}

export function placeOf(day: GrammarDay, slot: GrammarSlot): GrammarPlace | null {
  return day.places[slot.placeId] ?? null;
}

/** Slots in schedule order. Rules never assume the input array is sorted. */
export function orderedSlots(day: GrammarDay): GrammarSlot[] {
  return [...day.slots].sort(
    (a, b) =>
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime) ||
      a.id.localeCompare(b.id),
  );
}

export function violation(
  ruleId: RuleId,
  slotIds: string[],
  message: string,
  data: Readonly<Record<string, JsonValue>> = {},
): Violation {
  return { ruleId, severity: "violation", slotIds, message, data };
}

export function advisory(
  ruleId: RuleId,
  slotIds: string[],
  message: string,
  data: Readonly<Record<string, JsonValue>> = {},
): Violation {
  return { ruleId, severity: "advisory", slotIds, message, data };
}

/** "slot 3" — 1-based, matching how a reviewer counts a printed day. */
export function slotLabel(day: GrammarDay, slotId: string): string {
  const index = orderedSlots(day).findIndex((s) => s.id === slotId);
  return index < 0 ? slotId : `slot ${index + 1}`;
}

export const describePlace = (place: GrammarPlace | null, fallback: string): string =>
  place?.name ?? fallback;
