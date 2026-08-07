/**
 * Meal patterns and pacing — the rhythm of the day.
 *
 * Meal grammar is patterns, not fixed slots (XXX-5 comment 10290): 8:30
 * does not mean breakfast, and a valid day is 8:30 coffee → 12:00 brunch →
 * dinner. The pattern is an INPUT selected upstream by the taste profile;
 * this file validates against it and never picks one.
 */

import { minutesToTime, timeToMinutes } from "../../time";
import {
  advisory,
  contains,
  describePlace,
  durationOf,
  orderedSlots,
  overlapMinutes,
  placeOf,
  readFact,
  slotLabel,
  spanOf,
  spanOfInterval,
  violation,
  type Span,
} from "../internal";
import type { GrammarContext, GrammarDay, GrammarSlot, Violation } from "../types";

interface NamedWindow {
  label: string;
  span: Span;
  /** True when this window only exists because an anchor displaced one. */
  displaced: boolean;
}

/**
 * XXX-27's "meal windows squeezed/shifted around the anchor", made
 * concrete. When a user anchor overlaps a pattern window, the time the
 * anchor took is offered back immediately after it — capped, so a lunch
 * window cannot creep into the evening.
 *
 * Golden Day 1 is why this exists: the 18:30–22:00 game swallows the
 * dinner window whole, and without displacement the founder's own
 * 22:30 late bite at Ruby Soho would be a violation.
 */
export function windowsFor(day: GrammarDay, ctx: GrammarContext): NamedWindow[] {
  if (ctx.mealPattern === null) return [];
  const pattern = ctx.params.mealPatterns[ctx.mealPattern];
  const anchors = orderedSlots(day)
    .filter((s) => s.origin === "user")
    .map(spanOf);
  const cap = ctx.params.mealDisplacementMaxMinutes;

  const out: NamedWindow[] = [];

  for (const window of pattern.windows) {
    const base = spanOfInterval(window);
    out.push({ label: window.label, span: base, displaced: false });

    for (const anchor of anchors) {
      const lost = overlapMinutes(base, anchor);
      if (lost === 0) continue;
      const granted = Math.min(lost, cap);
      out.push({
        label: window.label,
        span: { start: anchor.end, end: anchor.end + granted },
        displaced: true,
      });
    }
  }

  return out;
}

const isFood = (slot: GrammarSlot) => slot.kind === "meal";

export function checkRhythm(day: GrammarDay, ctx: GrammarContext): Violation[] {
  const found: Violation[] = [];
  const slots = orderedSlots(day);
  const meals = slots.filter(isFood);

  // --- meal pattern --------------------------------------------------------
  if (ctx.mealPattern === null) {
    found.push(
      advisory(
        "meal.pattern-unknown",
        [],
        `No meal pattern was supplied for this day, so the ${meals.length} food stop${meals.length === 1 ? "" : "s"} were not checked against one. The taste profile owns that choice.`,
        { foodStopCount: meals.length },
      ),
    );
  } else {
    const windows = windowsFor(day, ctx);
    const pattern = ctx.params.mealPatterns[ctx.mealPattern];

    for (const slot of meals) {
      const span = spanOf(slot);
      if (windows.some((w) => contains(w.span, span))) continue;
      const name = describePlace(placeOf(day, slot), slot.placeId);
      found.push(
        violation(
          "meal.outside-pattern-window",
          [slot.id],
          `${slotLabel(day, slot.id)} eats at ${name} ${slot.startTime}–${slot.endTime}, outside every window of the ${ctx.mealPattern.replace(/_/g, " ")} pattern (${windows
            .filter((w) => !w.displaced)
            .map((w) => `${w.label} ${minutesToTime(w.span.start)}–${minutesToTime(w.span.end)}`)
            .join(", ")}).`,
          {
            placeId: slot.placeId,
            pattern: ctx.mealPattern,
            slotStart: slot.startTime,
            slotEnd: slot.endTime,
            windows: windows.map((w) => ({
              label: w.label,
              start: minutesToTime(w.span.start),
              end: minutesToTime(w.span.end),
              displaced: w.displaced,
            })),
          },
        ),
      );
    }

    if (meals.length > pattern.maxFoodStops) {
      found.push(
        violation(
          "pacing.food-stops-exceeded",
          meals.map((m) => m.id),
          `This day has ${meals.length} food stops; the ${ctx.mealPattern.replace(/_/g, " ")} pattern allows ${pattern.maxFoodStops}.`,
          {
            pattern: ctx.mealPattern,
            foodStopCount: meals.length,
            maxFoodStops: pattern.maxFoodStops,
          },
        ),
      );
    }
  }

  // --- long gap without food ----------------------------------------------
  // Measured between the END of one food stop and the START of the next —
  // eating spans time, and treating a meal as an instant made every day
  // in the golden set look starved.
  const maxGap = ctx.params.pacing.maxFoodGapMinutes;
  const fedSpans = meals.map(spanOf).sort((a, b) => a.start - b.start);
  const gaps: { from: number; to: number }[] = [];
  let cursor = timeToMinutes(day.dayStart);
  for (const fed of fedSpans) {
    gaps.push({ from: cursor, to: fed.start });
    cursor = Math.max(cursor, fed.end);
  }
  gaps.push({ from: cursor, to: timeToMinutes(day.dayEnd) });

  const longest = gaps
    .map((g) => ({ ...g, minutes: g.to - g.from }))
    .sort((a, b) => b.minutes - a.minutes)[0];

  if (longest !== undefined && longest.minutes > maxGap) {
    found.push(
      advisory(
        "pacing.long-gap-without-food",
        [],
        `${Math.round((longest.minutes / 60) * 10) / 10} hours pass without a food stop (${minutesToTime(longest.from)}–${minutesToTime(longest.to)}). Not wrong, but worth a word to the traveller.`,
        {
          gapMinutes: longest.minutes,
          fromLocal: minutesToTime(longest.from),
          toLocal: minutesToTime(longest.to),
          maxFoodGapMinutes: maxGap,
        },
      ),
    );
  }

  // --- breather between heavyweight stops ----------------------------------
  // The epic's words are "no back-to-back anchors without breather", written
  // before XXX-27 defined anchor as origin='user'. Read literally it almost
  // never fires, so it is read here as HEAVYWEIGHT STOPS: consecutive slots
  // at or above their category's typical dwell. Recorded as an interpretation
  // in SESSION_NOTES, not decided silently.
  for (let i = 1; i < slots.length; i += 1) {
    const previous = slots[i - 1];
    const next = slots[i];
    if (!isHeavyweight(day, ctx, previous) || !isHeavyweight(day, ctx, next)) continue;
    const gap = timeToMinutes(next.startTime) - timeToMinutes(previous.endTime);
    if (gap < ctx.params.pacing.breatherMinutes) {
      found.push(
        advisory(
          "pacing.no-breather",
          [previous.id, next.id],
          `${describePlace(placeOf(day, previous), previous.placeId)} and ${describePlace(placeOf(day, next), next.placeId)} are both long stops with ${gap} minutes between them — a day needs air.`,
          {
            gapMinutes: gap,
            breatherMinutes: ctx.params.pacing.breatherMinutes,
          },
        ),
      );
    }
  }

  // --- wanderer structure --------------------------------------------------
  if (ctx.persona?.structure === "wanderer") {
    const span =
      timeToMinutes(day.dayEnd) - timeToMinutes(day.dayStart);
    const scheduled = slots.reduce((sum, s) => sum + durationOf(spanOf(s)), 0);
    const unstructured = span > 0 ? (span - scheduled) / span : 0;
    const floor = ctx.params.pacing.wandererMinUnstructuredFraction;

    if (unstructured < floor) {
      found.push(
        violation(
          "pacing.wanderer-overscheduled",
          [],
          `This traveller wanders: only ${Math.round(unstructured * 100)}% of the day is left open, and a wanderer's day needs at least ${Math.round(floor * 100)}%. Anchor the day, then let it drift.`,
          {
            unstructuredFraction: Math.round(unstructured * 1000) / 1000,
            minimumFraction: floor,
            scheduledMinutes: scheduled,
            daySpanMinutes: span,
          },
        ),
      );
    }
  }

  return found;
}

function isHeavyweight(
  day: GrammarDay,
  ctx: GrammarContext,
  slot: GrammarSlot,
): boolean {
  const category = readFact(placeOf(day, slot)?.category);
  if (category.state !== "present") return false;
  // Strictly ABOVE typical. At-typical is an ordinary stop, and treating
  // it as heavyweight made a 45-minute coffee count as a long haul.
  return (
    durationOf(spanOf(slot)) > ctx.params.dwellMinutes[category.value].typical
  );
}
