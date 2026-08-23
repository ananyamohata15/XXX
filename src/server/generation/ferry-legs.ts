/**
 * Ferry leg annotation (XXX-43, Session 15) — pays Session 14 finding #4.
 *
 * THE DEFECT: the boat to Hanlan's Point rendered as `🚇 Transit · 13 min`,
 * indistinguishable from a streetcar, while the good label
 * (`Jack Layton Ferry Terminal ⇄ Hanlan's Point`) sat unused in
 * `ferry-seed.ts`. The day's entire feasibility hangs on that timetable, and
 * nothing on screen mentioned it existed.
 *
 * WHICH LEGS. An experience theme declares its own crossing
 * (`ExperienceSpec.legs = { mode: "ferry", routeKey }`), and its composite
 * block is the part of the day on the far side of the water. So the legs that
 * cross are the one INTO the composite block and the one OUT of it — derived
 * from the day's own structure rather than from a guess about geography or a
 * hardcoded list of island venues.
 *
 * Deliberately pure and separate from `engine.ts`: it takes the day's slots
 * and legs and returns annotated legs, which makes the fire-rate provable
 * without a database, a Google key, or a generation.
 */

import type { FerryTimetable } from "@/shared/city-facts";
import type { LegService } from "@/shared/timeline";
import type { ComposedLeg } from "./types";

/** The slots of a composed day, in the order they are seated. */
export interface AnnotatableSlot {
  id: string;
  placeId: string;
  startTime: string;
  /** Present = this slot IS the experience's composite block. */
  compositeDwell?: { min: number; max: number };
}

/**
 * The last departure of the day, or null when the timetable does not say.
 *
 * Honest absence rather than a guess: a pill claiming a last boat we do not
 * know is worse than one that omits it, because the traveller would plan
 * around it.
 */
export function lastDepartureOf(timetable: FerryTimetable): string | null {
  const all = [...timetable.outbound, ...timetable.inbound].filter(
    (t) => /^\d{2}:\d{2}$/.test(t),
  );
  if (all.length === 0) return null;
  return all.reduce((latest, t) => (t > latest ? t : latest));
}

/**
 * Annotate the crossings of a day built around a ferry-borne experience.
 *
 * Returns a NEW leg array; the input is not mutated. A day with no composite
 * block, or no timetable, comes back untouched — which is the overwhelmingly
 * common case and must cost nothing.
 */
export function annotateFerryLegs(
  legs: readonly ComposedLeg[],
  slots: readonly AnnotatableSlot[],
  timetable: FerryTimetable | null,
): ComposedLeg[] {
  if (timetable === null) return [...legs];

  const ordered = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const blockIndex = ordered.findIndex((s) => s.compositeDwell !== undefined);
  if (blockIndex < 0) return [...legs];

  const block = ordered[blockIndex]!;
  const before = blockIndex > 0 ? ordered[blockIndex - 1] : undefined;
  const after =
    blockIndex + 1 < ordered.length ? ordered[blockIndex + 1] : undefined;

  const service: LegService = {
    kind: "ferry",
    label: timetable.label,
    lastDeparture: lastDepartureOf(timetable),
  };

  /** The crossing pairs, by place id — outbound to the block, and back. */
  const crossings = new Set<string>();
  if (before !== undefined) crossings.add(`${before.placeId}→${block.placeId}`);
  if (after !== undefined) crossings.add(`${block.placeId}→${after.placeId}`);

  return legs.map((leg) =>
    crossings.has(`${leg.fromPlaceId}→${leg.toPlaceId}`)
      ? { ...leg, via: service }
      : leg,
  );
}
