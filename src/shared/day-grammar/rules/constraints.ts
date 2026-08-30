/**
 * Constraint rules (XXX-43, Session 15) — the traveller's own word, enforced.
 *
 * WHY THIS RULE EXISTS WHEN EIGHT OTHER SEAMS ALREADY FILTER. The palette
 * narrows, the anchor election excludes, retrieval never queries, the menu
 * never offers. If all of that works, this rule never fires — and that is
 * precisely the argument for having it. Every one of those eight is a place
 * someone can add a code path that forgets; this is the one place that cannot
 * be forgotten, because it sits after all of them and rejects the day.
 *
 * It is the difference between *"we filtered carefully"* and *"a day seating
 * an excluded category cannot reach a user"*. Only the second is a promise.
 *
 * BLOCKING, not advisory, and the distinction is the whole ticket. An
 * unverified price is a thing we do not know, and shipping it with a note is
 * honest. A bar on the day of someone who told us they do not drink is not a
 * gap in our knowledge — it is us ignoring them. The founder's verdict that
 * opened this session was *"I have no ability to tell things I like"*; a
 * constraint that produced a note rather than a rejection would be the same
 * failure with better manners.
 */

import {
  describePlace,
  orderedSlots,
  placeOf,
  readFact,
  slotLabel,
  violation,
} from "../internal";
import { excludesAlcohol } from "../../constraints";
import { categoryLabel } from "../../vocabulary";
import type { GrammarContext, GrammarDay, Violation } from "../types";

export function checkConstraints(
  day: GrammarDay,
  ctx: GrammarContext,
): Violation[] {
  const excluded = ctx.excludedCategories;
  // Unknown is not "none" — the `transport` precedent. A context that never
  // supplied constraints validates exactly as it did before this rule existed.
  if (excluded === null || excluded.length === 0) return [];

  const found: Violation[] = [];
  for (const slot of orderedSlots(day)) {
    /**
     * A user-origin slot is the traveller's OWN commitment. If they booked a
     * table at a wine bar themselves, that is their business and not ours to
     * reject — the same carve-out `dwell.ts` makes, and for the same reason:
     * the user owns their own commitments. The constraint governs what WE
     * choose for them.
     */
    if (slot.origin === "user") continue;

    const place = placeOf(day, slot);
    if (!place) continue;

    const category = readFact(place.category);
    /**
     * A stop whose category we do not know cannot be judged. Deliberately
     * silent rather than advisory: `dwell.category-unknown` already reports
     * exactly this gap on exactly these slots, and a second rule saying the
     * same thing would double every such day's notes to tell the reader
     * nothing new.
     */
    if (category.state !== "present") continue;

    /**
     * The ATTRIBUTE backstop (XXX-44, Session 16).
     *
     * Checked BEFORE the category test and reported instead of it when it
     * fires, because the two rules would otherwise both indict a bar and the
     * traveller would read the same objection twice. The category rule is for
     * a venue whose CATEGORY was refused; this one is for a venue whose
     * category was permitted and whose own directory record files it as a
     * drinking spot. Different failures, and the second one is the
     * interesting one — it means every upstream seam let it through.
     *
     * Absent is silent, and deliberately so. `dwell.category-unknown` already
     * reports the slots we know nothing about; a second rule saying the same
     * thing doubles a day's notes to tell the reader nothing new. It is also
     * the ruling recorded at `isVenuePermitted`: the population with no
     * directory record is, in practice, the traveller's own commitments —
     * which the `origin === "user"` carve-out above already declines to judge.
     */
    const drinking = readFact(place.drinkingFocused);
    if (
      excludesAlcohol(excluded) &&
      drinking.state === "present" &&
      drinking.value === true
    ) {
      found.push(
        violation(
          "constraint.drinking-focused-venue",
          [slot.id],
          `${slotLabel(day, slot.id)} is ${describePlace(place, slot.placeId)}, which its own listing files as a drinking spot, and this traveller does not drink. The day cannot include it.`,
          {
            slotId: slot.id,
            placeId: place.id,
            category: category.value,
            excludedCategories: [...excluded],
          },
        ),
      );
      continue;
    }

    if (!excluded.includes(category.value)) continue;

    found.push(
      violation(
        "constraint.excluded-category",
        [slot.id],
        `${slotLabel(day, slot.id)} is ${describePlace(place, slot.placeId)}, and this traveller asked not to be sent to ${categoryLabel(category.value)}. The day cannot include it.`,
        {
          slotId: slot.id,
          placeId: place.id,
          category: category.value,
          excludedCategories: [...excluded],
        },
      ),
    );
  }
  return found;
}
