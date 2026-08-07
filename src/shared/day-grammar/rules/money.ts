/**
 * Budget band (XXX-5 layer 3; golden Day 4, the $70 hard day).
 *
 * The honesty rule is the whole point here: a price we do not have is
 * NEVER guessed and never silently zero. Absent prices are excluded from
 * the sum and reported as a count, so a day that "fits the budget" says
 * out loud how much of it was actually priced.
 */

import {
  advisory,
  describePlace,
  orderedSlots,
  placeOf,
  readFact,
  violation,
} from "../internal";
import type { GrammarContext, GrammarDay, Violation } from "../types";

const midpoint = (r: { min: number; max: number }) => (r.min + r.max) / 2;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkMoney(day: GrammarDay, ctx: GrammarContext): Violation[] {
  const band = ctx.budgetBand;
  if (band === null) return [];

  const found: Violation[] = [];
  const unpriced: string[] = [];
  const mismatched: string[] = [];
  let total = 0;

  for (const slot of orderedSlots(day)) {
    const place = placeOf(day, slot);
    if (!place) continue;
    const price = readFact(place.priceRange);

    if (price.state !== "present") {
      unpriced.push(slot.id);
      continue;
    }
    if (price.value.currency !== band.currency) {
      mismatched.push(slot.id);
      continue;
    }
    total += midpoint(price.value);
  }

  // Golden Day 4 lists "ignoring transit cost" as a trap, so a day that
  // rides counts the fare. The unit is the day pass, per the founder's
  // confirmed figure in XXX-5 comment 10293 — a per-city FareModel that
  // prices tap events with their two-hour transfer window is the v2
  // refinement, and until it exists this is the honest single number.
  const ridesTransit = day.slots.some((s) => s.arriveBy === "transit");
  const fare =
    ridesTransit && band.currency === "CAD"
      ? ctx.params.budget.transitDayPassCad
      : 0;
  total = round2(total + fare);

  if (total > band.max) {
    found.push(
      violation(
        "budget.over-band",
        [],
        `Priced stops${fare > 0 ? " plus the transit day pass" : ""} come to ${band.currency} ${total}, over the ${band.currency} ${band.max} band by ${round2(total - band.max)}${unpriced.length > 0 ? ` — and ${unpriced.length} stop${unpriced.length === 1 ? " is" : "s are"} still unpriced` : ""}.`,
        {
          currency: band.currency,
          pricedTotal: total,
          bandMax: band.max,
          overBy: round2(total - band.max),
          unpricedSlotCount: unpriced.length,
          transitFare: fare,
        },
      ),
    );
  } else {
    found.push(
      advisory(
        "budget.headroom",
        [],
        `Priced stops${fare > 0 ? " plus the transit day pass" : ""} come to ${band.currency} ${total} of a ${band.currency} ${band.max} day — ${band.currency} ${round2(band.max - total)} spare.`,
        {
          currency: band.currency,
          pricedTotal: total,
          bandMax: band.max,
          headroom: round2(band.max - total),
          transitFare: fare,
        },
      ),
    );
  }

  if (unpriced.length > 0) {
    found.push(
      advisory(
        "budget.price-uncertain",
        unpriced,
        `${unpriced.length} stop${unpriced.length === 1 ? "" : "s"} on this day ${unpriced.length === 1 ? "has" : "have"} no published price (${unpriced
          .map((id) => {
            const slot = day.slots.find((s) => s.id === id);
            return describePlace(slot ? placeOf(day, slot) : null, id);
          })
          .join(", ")}). They are excluded from the total, not estimated.`,
        { unpricedSlotCount: unpriced.length, unpricedSlotIds: unpriced },
      ),
    );
  }

  if (mismatched.length > 0) {
    found.push(
      advisory(
        "budget.price-uncertain",
        mismatched,
        `${mismatched.length} stop${mismatched.length === 1 ? "" : "s"} ${mismatched.length === 1 ? "is" : "are"} priced in a different currency from the ${band.currency} trip band and could not be added.`,
        {
          mismatchedSlotCount: mismatched.length,
          mismatchedSlotIds: mismatched,
          bandCurrency: band.currency,
        },
      ),
    );
  }

  return found;
}
