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
import { CATEGORY_FAMILY, type CategoryFamily } from "../../vocabulary";
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

/**
 * A food stop is a food VENUE, whatever kind of slot it was seated into
 * (XXX-35 comment 10299 item 3).
 *
 * The defect this replaces counted `slot.kind === "meal"`, so a
 * restaurant-categorised venue seated as an evening ACTIVITY — Scotland
 * Yard Pub, dealt from the nightlife menu — was invisible to the one rule
 * whose job is bounding food stops. The founder counted four meals; the
 * rule counted three and passed the day at a ceiling of four.
 *
 * Which categories count is a versioned judgment in
 * GRAMMAR_PARAMS.pacing.foodCategories, not a literal here. An unknown
 * category cannot be counted — honest absence; `dwell.category-unknown`
 * already reports every such slot, so nothing goes unsaid.
 */
const isFood = (
  day: GrammarDay,
  ctx: GrammarContext,
  slot: GrammarSlot,
): boolean => {
  if (slot.kind === "meal") return true;
  const category = readFact(placeOf(day, slot)?.category);
  return (
    category.state === "present" &&
    ctx.params.pacing.foodCategories.includes(category.value)
  );
};

export function checkRhythm(day: GrammarDay, ctx: GrammarContext): Violation[] {
  const found: Violation[] = [];
  const slots = orderedSlots(day);
  /** Slots seated as meals — the set the pattern's WINDOWS apply to. */
  const meals = slots.filter((s) => s.kind === "meal");
  /** Food venues — the set the pattern's CEILING applies to. */
  const foodStops = slots.filter((s) => isFood(day, ctx, s));

  // --- meal pattern --------------------------------------------------------
  if (ctx.mealPattern === null) {
    found.push(
      advisory(
        "meal.pattern-unknown",
        [],
        `No meal pattern was supplied for this day, so the ${foodStops.length} food stop${foodStops.length === 1 ? "" : "s"} were not checked against one. The taste profile owns that choice.`,
        { foodStopCount: foodStops.length, mealSlotCount: meals.length },
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

    if (foodStops.length > pattern.maxFoodStops) {
      // Named separately because the interesting case is the one the old
      // predicate could not see: food venues seated as activities.
      const asActivities = foodStops.filter((s) => s.kind !== "meal");
      found.push(
        violation(
          "pacing.food-stops-exceeded",
          foodStops.map((m) => m.id),
          `This day has ${foodStops.length} food stops; the ${ctx.mealPattern.replace(/_/g, " ")} pattern allows ${pattern.maxFoodStops}.${
            asActivities.length > 0
              ? ` ${asActivities.length} of them ${asActivities.length === 1 ? "is" : "are"} seated as an activity rather than a meal (${asActivities
                  .map((s) => describePlace(placeOf(day, s), s.placeId))
                  .join(", ")}) — a food venue is a food stop wherever it sits.`
              : ""
          }`,
          {
            pattern: ctx.mealPattern,
            foodStopCount: foodStops.length,
            mealSlotCount: meals.length,
            foodAsActivitySlotIds: asActivities.map((s) => s.id),
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
  // Anything that feeds you counts — a pub with a kitchen ends a hungry
  // stretch whether the composer called the slot a meal or not.
  const fedSpans = foodStops.map(spanOf).sort((a, b) => a.start - b.start);
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

  // --- texture: no A-B-A-B ------------------------------------------------
  found.push(...checkTexture(day, ctx, slots));

  // --- adjacency: not the same thing twice in a row ------------------------
  found.push(...checkAdjacency(day, ctx, slots));

  // --- an ending that lands -----------------------------------------------
  found.push(...checkEnding(day, ctx, slots));

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

/** The texture family of a slot's venue, or null when unknowable. */
function familyOf(day: GrammarDay, slot: GrammarSlot): CategoryFamily | null {
  const category = readFact(placeOf(day, slot)?.category);
  return category.state === "present" ? CATEGORY_FAMILY[category.value] : null;
}

/**
 * A-B-A-B in a day that has nothing else in it. The founder said it twice,
 * in two different days' words — "meal, gallery, meal, gallery, meal" and
 * "Food Park Food Park Food Food" — and the old max-2-per-category rule
 * permitted both, because two galleries and three meals IS two per
 * category.
 *
 * Measured in FAMILIES (see CATEGORY_FAMILY), over four CONSECUTIVE stops.
 * Four is the shortest window in which alternation is a pattern rather
 * than a coincidence: A-B-A is just a sandwich, and sandwiches are fine.
 *
 * The second condition — the day carries fewer than
 * `minTextureFamilies` distinct families — is not decoration. Without it
 * this rule rejects golden day-2, which the founder authored: see the
 * measurements recorded at that param. Alternation is only monotony when
 * there is no third texture anywhere in the day.
 *
 * Unknown families break the chain rather than match it — an absence is
 * not evidence of monotony.
 */
function checkTexture(
  day: GrammarDay,
  ctx: GrammarContext,
  slots: GrammarSlot[],
): Violation[] {
  const found: Violation[] = [];
  const distinct = new Set(
    slots.map((s) => familyOf(day, s)).filter((f): f is CategoryFamily => f !== null),
  );
  if (distinct.size >= ctx.params.pacing.minTextureFamilies) return found;

  for (let i = 3; i < slots.length; i += 1) {
    const window = [slots[i - 3], slots[i - 2], slots[i - 1], slots[i]];
    const families = window.map((s) => familyOf(day, s));
    if (families.some((f) => f === null)) continue;
    const [a, b, c, d] = families;
    if (a !== c || b !== d || a === b) continue;
    // A user's own commitments are not ours to call monotonous.
    if (window.every((s) => s.origin === "user")) continue;
    found.push(
      violation(
        "rhythm.alternating-texture",
        window.map((s) => s.id),
        `Four stops in a row alternate ${a} and ${b}: ${window
          .map((s) => describePlace(placeOf(day, s), s.placeId))
          .join(" → ")} — and the whole day holds only ${distinct.size} kind${distinct.size === 1 ? "" : "s"} of place. A day needs texture, not a rhythm: put something in it that is neither ${a} nor ${b}.`,
        {
          families: [a, b, c, d],
          distinctFamilies: distinct.size,
          minTextureFamilies: ctx.params.pacing.minTextureFamilies,
          slotIds: window.map((s) => s.id),
        },
      ),
    );
  }
  return found;
}

/**
 * Two stops in a row that are the same thing twice (XXX-46, Session 16).
 *
 * WHY THIS RULE EXISTS WHEN `closeCategories` ALREADY GUARDS IT. Session 15
 * fixed composition so the close never draws a table after food, and reported
 * honestly that no GRAMMAR rule forbids the shape — a day that reached it
 * another way would still validate clean. This is that rule, and the argument
 * for having both is `constraints.ts`'s: composition is a place someone can
 * add a path that forgets; this sits after every such path and rejects the
 * day. The difference between *"we compose carefully"* and *"a day that eats
 * twice in a row cannot reach a user"*.
 *
 * TWO QUESTIONS, and they are genuinely different — the `EVENING_VIABLE` vs
 * `isCategoryPermitted` division, for the same reason:
 *
 *   1. **Did the traveller just sit down to a meal, and are we sitting them
 *      down to another?** `pacing.mealGrade`. BLOCKING. This is the CP4
 *      defect and the only adjacency the grammar refuses outright.
 *   2. **Are these two stops the same texture?** `pacing.consecutiveFamily`.
 *      Advisory at most, and permitted for the two families the founder's own
 *      days and words put beyond argument.
 *
 * Asking (1) through the family would have been wrong, and the offline
 * recompose caught it rather than an argument: `cafes` → `restaurants` is
 * table → table, and it is coffee then brunch — a meal pattern this product
 * ships by name. The measurement is recorded at `mealGrade`.
 *
 * THE PAIR, NOT THE RUN. Three parks in a row is two pairs, not one
 * three-stop finding, because the repair is per-pair: strike the SECOND stop
 * and the day re-draws that one slot. Which is also why only the later slot
 * goes into `slotIds` — `PLACE_CAUSED` strikes every id it is handed, and
 * striking the first would re-draw a stop that is not the problem, quite
 * possibly the anchor or a meal seated in its own window.
 *
 * Unknown categories break the chain rather than match it — the discipline
 * `checkTexture` set: an absence is not evidence of monotony. Two stops the
 * USER committed to are not ours to call repetitive, the same carve-out
 * `checkTexture` and `dwell.ts` make.
 */
function checkAdjacency(
  day: GrammarDay,
  ctx: GrammarContext,
  slots: GrammarSlot[],
): Violation[] {
  const found: Violation[] = [];
  for (let i = 1; i < slots.length; i += 1) {
    const previous = slots[i - 1];
    const next = slots[i];
    if (previous.origin === "user" && next.origin === "user") continue;

    const before = readFact(placeOf(day, previous)?.category);
    const after = readFact(placeOf(day, next)?.category);
    if (before.state !== "present" || after.state !== "present") continue;

    const twoMeals =
      ctx.params.pacing.mealGrade[before.value] &&
      ctx.params.pacing.mealGrade[after.value];
    const family = CATEGORY_FAMILY[before.value];
    const sameFamily = CATEGORY_FAMILY[after.value] === family;
    const verdict = twoMeals
      ? "blocking"
      : sameFamily
        ? ctx.params.pacing.consecutiveFamily[family]
        : "permitted";
    if (verdict === "permitted") continue;

    const both = `${describePlace(placeOf(day, previous), previous.placeId)} then ${describePlace(placeOf(day, next), next.placeId)}`;
    const data = {
      family,
      previousCategory: before.value,
      category: after.value,
      slotId: next.id,
      previousSlotId: previous.id,
      verdict,
    };
    found.push(
      verdict === "blocking"
        ? violation(
            "rhythm.consecutive-same-family",
            [next.id],
            `${both} — a second sit-down meal at ${next.startTime}, ${timeToMinutes(next.startTime) - timeToMinutes(previous.endTime)} minutes after the first one ends. A day that eats twice in a row has served the same thing twice; make the second stop something else.`,
            data,
          )
        : advisory(
            "rhythm.consecutive-same-family",
            [next.id],
            `${both} are both ${family} stops, one after the other. Not wrong — sometimes it is exactly the point — but it is the same texture twice, and worth a word.`,
            data,
          ),
    );
  }
  return found;
}

/**
 * Endings that land (XXX-35 §1.1). The founder's second day finished
 * "2hrs free → meal", which is not a finale — it is the day running out.
 *
 * ADVISORY, deliberately. "Dinner last" is usually exactly right; the
 * defect is the dead gap in front of it. A violation here would also put
 * the regeneration loop at risk on a thin evening, which is the same
 * discipline that governs the unavoidable-weather advisory.
 */
function checkEnding(
  day: GrammarDay,
  ctx: GrammarContext,
  slots: GrammarSlot[],
): Violation[] {
  const last = slots[slots.length - 1];
  const previous = slots[slots.length - 2];
  if (last === undefined || previous === undefined) return [];
  if (last.origin === "user") return []; // the user chose their own ending
  if (familyOf(day, last) !== "table") return [];

  const gap = timeToMinutes(last.startTime) - timeToMinutes(previous.endTime);
  const threshold = ctx.params.pacing.endingGapMinutes;
  if (gap < threshold) return [];

  return [
    advisory(
      "rhythm.ending-without-landing",
      [previous.id, last.id],
      `The day ends on ${describePlace(placeOf(day, last), last.placeId)} at ${last.startTime}, ${gap} minutes after ${describePlace(placeOf(day, previous), previous.placeId)} finishes, with nothing in between. That reads as the day running out rather than closing — put something in the gap or bring the ending forward.`,
      {
        gapMinutes: gap,
        endingGapMinutes: threshold,
        lastSlotId: last.id,
        previousSlotId: previous.id,
      },
    ),
  ];
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
