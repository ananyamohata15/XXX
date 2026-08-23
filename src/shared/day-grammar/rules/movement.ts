/**
 * Travel feasibility, anchors, and avoidable detours.
 *
 * Session 3's E5 lesson 1 is the shape of this file: reflowDay only ever
 * reported lateness AT the anchor, and the fixture that taught the lesson
 * (Distillery ends 19:00, a four-minute walk lands 19:04) proved that
 * every edge needs the check, not just the anchored one. Lesson 4 is the
 * other half: a leg we cannot estimate contributes zero minutes and
 * silently tightens the plan, so it is refused rather than shrugged at.
 */

import { minutesToTime, timeToMinutes } from "../../time";
import {
  advisory,
  describePlace,
  orderedSlots,
  placeOf,
  slotLabel,
  violation,
} from "../internal";
import type {
  GrammarContext,
  GrammarDay,
  GrammarSlot,
  TravelEstimate,
  Violation,
} from "../types";

/** An estimate for one consecutive pair, or the reason there isn't one. */
interface Leg {
  from: GrammarSlot;
  to: GrammarSlot;
  estimate: TravelEstimate | null;
  /** Present when no estimate could be made at all. */
  blockedBy: string | null;
}

function legsOf(day: GrammarDay, ctx: GrammarContext): Leg[] {
  const slots = orderedSlots(day);
  const legs: Leg[] = [];

  for (let i = 1; i < slots.length; i += 1) {
    const from = slots[i - 1];
    const to = slots[i];
    const fromPlace = placeOf(day, from);
    const toPlace = placeOf(day, to);

    if (!fromPlace?.coords || !toPlace?.coords) {
      const missing = !fromPlace?.coords ? fromPlace : toPlace;
      legs.push({
        from,
        to,
        estimate: null,
        blockedBy: describePlace(missing ?? null, "an unknown place"),
      });
      continue;
    }

    legs.push({
      from,
      to,
      estimate: ctx.travel.estimate({
        origin: fromPlace.coords,
        destination: toPlace.coords,
        mode: to.arriveBy,
        departureLocal: from.endTime,
      }),
      blockedBy: null,
    });
  }

  return legs;
}

const toleranceFor = (ctx: GrammarContext, estimate: TravelEstimate): number =>
  ctx.params.travel.toleranceMinutesByTier[estimate.provenance.tier] ?? 0;

export function checkMovement(day: GrammarDay, ctx: GrammarContext): Violation[] {
  const found: Violation[] = [];
  const legs = legsOf(day, ctx);
  const baseline = ctx.anchorBaseline;

  // --- anchor immutability -------------------------------------------------
  // Checked before anything else: if a suggested fix moved a user's own
  // commitment, nothing downstream of it is worth reporting on.
  if (baseline !== null) {
    for (const slot of orderedSlots(day)) {
      if (slot.origin !== "user") continue;
      const original = baseline[slot.id];
      if (original === undefined) continue;
      const moved =
        original.startTime !== slot.startTime ||
        original.endTime !== slot.endTime ||
        original.placeId !== slot.placeId;
      if (moved) {
        found.push(
          violation(
            "anchor.mutated",
            [slot.id],
            `${slotLabel(day, slot.id)} is the user's own commitment at ${original.startTime}–${original.endTime}; this plan has it at ${slot.startTime}–${slot.endTime}. Anchors do not move.`,
            {
              slotId: slot.id,
              originalStart: original.startTime,
              originalEnd: original.endTime,
              proposedStart: slot.startTime,
              proposedEnd: slot.endTime,
              originalPlaceId: original.placeId,
              proposedPlaceId: slot.placeId,
            },
          ),
        );
      }
    }
  }

  // --- arrival feasibility on every edge -----------------------------------
  let sawStub = false;

  for (const leg of legs) {
    const label = slotLabel(day, leg.to.id);
    const fromName = describePlace(placeOf(day, leg.from), leg.from.placeId);
    const toName = describePlace(placeOf(day, leg.to), leg.to.placeId);

    if (leg.estimate === null) {
      found.push(
        violation(
          "travel.uncertifiable",
          [leg.from.id, leg.to.id],
          `No travel estimate is possible from ${fromName} to ${toName} (${leg.blockedBy ?? "unknown"} has no coordinates). An unknown leg is not a zero-minute leg — this transition cannot be certified.`,
          { fromSlotId: leg.from.id, toSlotId: leg.to.id, blockedBy: leg.blockedBy },
        ),
      );
      continue;
    }

    if (leg.estimate.provenance.tier === 3) sawStub = true;

    const isAnchor = leg.to.origin === "user";
    const buffer = isAnchor ? ctx.params.anchors.arrivalBufferMinutes : 0;
    const arrival = timeToMinutes(leg.from.endTime) + leg.estimate.minutes;
    const mustArriveBy = timeToMinutes(leg.to.startTime) - buffer;
    const shortfall = arrival - mustArriveBy;

    if (shortfall <= 0) continue;

    const tolerance = toleranceFor(ctx, leg.estimate);
    const data = {
      fromSlotId: leg.from.id,
      toSlotId: leg.to.id,
      mode: leg.to.arriveBy,
      travelMinutes: leg.estimate.minutes,
      arrivalLocal: minutesToTime(arrival),
      requiredLocal: minutesToTime(mustArriveBy),
      shortfallMinutes: shortfall,
      toleranceMinutes: tolerance,
      estimateSource: leg.estimate.provenance.source,
      estimateTier: leg.estimate.provenance.tier,
    };

    if (isAnchor) {
      // An anchor never moves, so lateness here is always a violation —
      // the tolerance would be a licence to miss a booking.
      found.push(
        violation(
          "anchor.arrival-late",
          [leg.from.id, leg.to.id],
          `${label} is the user's commitment at ${leg.to.startTime}. Leaving ${fromName} at ${leg.from.endTime} and travelling ${leg.estimate.minutes} minutes by ${leg.to.arriveBy} arrives ${minutesToTime(arrival)} — past the ${ctx.params.anchors.arrivalBufferMinutes}-minute safety margin. Free up ${shortfall} minutes before it.`,
          data,
        ),
      );
    } else if (shortfall > tolerance) {
      found.push(
        violation(
          "travel.infeasible",
          [leg.from.id, leg.to.id],
          `${label} starts ${leg.to.startTime}, but leaving ${fromName} at ${leg.from.endTime} and travelling ${leg.estimate.minutes} minutes by ${leg.to.arriveBy} arrives ${minutesToTime(arrival)} — ${shortfall} minutes late.`,
          data,
        ),
      );
    } else {
      found.push(
        advisory(
          "travel.tight-transfer",
          [leg.from.id, leg.to.id],
          `${fromName} to ${toName} is tight: ${shortfall} minute${shortfall === 1 ? "" : "s"} over, inside the ${tolerance}-minute margin a tier-${leg.estimate.provenance.tier} estimate earns. A real routing time would settle it.`,
          data,
        ),
      );
    }
  }

  // --- egress from crowd-flagged anchors -----------------------------------
  const slots = orderedSlots(day);
  for (let i = 0; i < slots.length - 1; i += 1) {
    const anchor = slots[i];
    const next = slots[i + 1];
    if (anchor.origin !== "user") continue;
    if (placeOf(day, anchor)?.tags.highCrowd !== true) continue;

    const required = ctx.params.anchors.crowdEgressBufferMinutes;
    const gap = timeToMinutes(next.startTime) - timeToMinutes(anchor.endTime);
    if (gap < required) {
      found.push(
        violation(
          "anchor.egress-buffer-short",
          [anchor.id, next.id],
          `${describePlace(placeOf(day, anchor), anchor.placeId)} empties at ${anchor.endTime} and ${slotLabel(day, next.id)} starts ${next.startTime} — ${gap} minutes. A crowd that size needs ${required} to clear.`,
          {
            anchorSlotId: anchor.id,
            nextSlotId: next.id,
            gapMinutes: gap,
            requiredMinutes: required,
          },
        ),
      );
    }
  }

  // --- honesty about the provider ------------------------------------------
  if (sawStub) {
    found.push(
      advisory(
        "travel.stub-provenance",
        [],
        `Travel times on this day are straight-line estimates (tier 3), not routed times. Feasibility is indicative until XXX-24 lands.`,
        { source: "stub_haversine", tier: 3, legCount: legs.length },
      ),
    );
  }

  // --- avoidable detour (XXX-29's seed; trap class 6 generalized) -----------
  found.push(...checkDetour(day, ctx, legs));

  return found;
}

/**
 * Adjacent-swap detour detection. Deliberately not an optimizer: it asks
 * only whether swapping one adjacent movable pair strictly reduces total
 * travel, which is enough to catch the backtracking the founder red-penned
 * on Day 6 (NOL→Beamsville→Falls) and enough to seed XXX-29's offer with
 * the minutes figure its ticket asks it to quote. Anchors never move.
 */
function checkDetour(
  day: GrammarDay,
  ctx: GrammarContext,
  legs: Leg[],
): Violation[] {
  if (legs.some((l) => l.estimate === null)) return [];

  const slots = orderedSlots(day);
  const total = legs.reduce((sum, l) => sum + (l.estimate?.minutes ?? 0), 0);

  let best: { a: GrammarSlot; b: GrammarSlot; saved: number } | null = null;

  for (let i = 0; i < slots.length - 1; i += 1) {
    const a = slots[i];
    const b = slots[i + 1];
    if (a.origin === "user" || b.origin === "user") continue;

    /**
     * CAUSALITY OUTRANKS DISTANCE (XXX-38, Session 14 Step 3 ruling 2).
     *
     * A `provision` stop exists BECAUSE of the stop it serves — the picnic
     * supplies are bought before the picnic — so a swap that moves it AFTER
     * its target is not a shorter day, it is an incoherent one.
     *
     * Found live on the first good islands day: this rule advised visiting
     * Toronto Island Park before the LCBO to save 34 minutes, which is
     * arithmetically true and would have sent the traveller to a beach with
     * nothing to eat. The route optimizer cannot see why a stop is there;
     * this is the one clause that tells it.
     */
    if (a.role === "provision") continue;

    /**
     * A SWAP MUST BE ONE THE DAY COULD ACTUALLY TAKE (XXX-47, Session 16 CP2).
     *
     * This rule permuted the slot array and re-priced it, keeping each slot's
     * own times, and never asked whether the two venues could occupy each
     * other's positions. Measured on `day-1-jays`: it proposed swapping the
     * contrast (St. Michael's Cathedral, `historic_sites`) with the day's meal
     * (El Rincon Guerrerense) to save 28 minutes — **which would seat a
     * cathedral for lunch.** The founder was quoted a 74-minute saving on his
     * own day by this rule; some part of that was a number he could not have.
     *
     * An advisory that quotes an unreachable saving is the instrument failure
     * this project has now met three times in another form: not a wrong
     * answer about the data, but a confident answer about the wrong thing.
     * The number is only worth printing if the swap behind it is real.
     *
     * The guard is `kind`, and deliberately no more than that. A meal slot and
     * an activity slot are not interchangeable positions — Session 11's ruling
     * that *a food venue is a food stop wherever it sits* runs one way only,
     * and the reverse (a non-food venue seated as a meal) is not something
     * composition can produce and not something this rule should recommend.
     * Two meals may still trade, and two activities may still trade; the
     * grammar judges the result as it always did.
     *
     * REPORTED SEPARATELY, and not fixed here: **no rule requires a `meal`
     * slot to hold a food venue.** `rhythm.ts`'s `isFood` returns true for
     * `kind === "meal"` by assumption rather than by checking, so the swapped
     * day above VALIDATES CLEAN. Composition cannot reach that state — meal
     * intents carry food palettes — so with this guard the hole is
     * unreachable rather than merely unlikely. It is still a hole, and it is
     * filed rather than patched into a route rule that has no business
     * owning it.
     */
    if (a.kind !== b.kind) continue;

    const swapped = [...slots];
    swapped[i] = b;
    swapped[i + 1] = a;

    const swappedTotal = totalTravelFor(day, ctx, swapped);
    if (swappedTotal === null) continue;

    const saved = total - swappedTotal;
    if (saved > ctx.params.route.detourThresholdMinutes && (!best || saved > best.saved)) {
      best = { a, b, saved };
    }
  }

  if (!best) return [];

  return [
    advisory(
      "route.detour-avoidable",
      [best.a.id, best.b.id],
      `This order costs about ${best.saved} extra minutes of travel — visiting ${describePlace(placeOf(day, best.b), best.b.placeId)} before ${describePlace(placeOf(day, best.a), best.a.placeId)} would save them.`,
      {
        deltaMinutes: best.saved,
        totalTravelMinutes: total,
        swapSlotIds: [best.a.id, best.b.id],
      },
    ),
  ];
}

/** Total travel for a hypothetical order; null if any leg is unestimable. */
function totalTravelFor(
  day: GrammarDay,
  ctx: GrammarContext,
  order: GrammarSlot[],
): number | null {
  let total = 0;
  for (let i = 1; i < order.length; i += 1) {
    const fromPlace = placeOf(day, order[i - 1]);
    const toPlace = placeOf(day, order[i]);
    if (!fromPlace?.coords || !toPlace?.coords) return null;
    const estimate = ctx.travel.estimate({
      origin: fromPlace.coords,
      destination: toPlace.coords,
      mode: order[i].arriveBy,
      departureLocal: order[i - 1].endTime,
    });
    if (estimate === null) return null;
    total += estimate.minutes;
  }
  return total;
}
