/**
 * GrammarDay → TimelineDay (XXX-32).
 *
 * The E2 timeline renders a view model; the engine produces a domain
 * model. They were built for different jobs and the comment in
 * day-grammar/types.ts is right that bending one into the other would be
 * the wrong repair — so this is a mapping, not a merge, and it lives in
 * src/shared because both the route that calls it and the tests that
 * pin it need it.
 *
 * Three honest gaps, handled rather than papered over:
 *   * per-weekday hours -> one rendered line for the day being shown,
 *     provenance carried through unchanged (this is where a founder
 *     override becomes visible on the card)
 *   * vibe -> the engine never fetches one, so the fact is `unknown`
 *     ("not recorded"), never "not published"
 *   * alternates -> the engine's menus are not part of the day it
 *     returns, so a live card offers none. Empty is the truth.
 *
 * Pure and dependency-free.
 */

import type {
  GrammarDay,
  GrammarFact,
  HoursByWeekday,
  OpenInterval,
} from "./day-grammar/types";
import type {
  FactView,
  PlaceView,
  PriceRange,
  SlotView,
  TimelineDay,
  TravelLeg,
  TravelMatrix,
} from "./timeline";
import { travelKey } from "./timeline";
import { TIERS, weekdayOf, type TransportMode, type Tier } from "./vocabulary";

/** Structurally the engine's ComposedLeg; declared here to keep shared pure. */
export interface MappedLeg {
  fromPlaceId: string;
  toPlaceId: string;
  minutes: number;
  mode: TransportMode;
  source: string;
  tier: Tier;
}

export interface MappingInput {
  day: GrammarDay;
  legs: readonly MappedLeg[];
  /** Narrated Tier-3 reasons by slot id; a missing slot renders honestly. */
  reasons: ReadonlyMap<string, string>;
  /** Model id or generator name behind the reasons — provenance, not decoration. */
  reasonSource: string;
  /** When this day was generated. Passed in: shared code owns no clock. */
  generatedAt: string;
}

const UNKNOWN: FactView<never> = { status: "unknown" };

function mapFact<T>(fact: GrammarFact<T> | undefined): FactView<T> {
  if (fact === undefined) return UNKNOWN;
  if (fact.status === "absent") {
    return { status: "absent", source: fact.source, tier: fact.tier, fetchedAt: fact.fetchedAt };
  }
  return {
    status: "present",
    value: fact.value,
    source: fact.source,
    tier: fact.tier,
    fetchedAt: fact.fetchedAt,
  };
}

/** "10:00–18:00", "10:00–14:00, 17:00–23:00", or "Closed today". */
export function formatIntervals(intervals: OpenInterval[]): string {
  if (intervals.length === 0) return "Closed today";
  return intervals.map((i) => `${i.open}–${i.close}`).join(", ");
}

/** The week's hours, narrowed to the day being shown. Provenance rides along. */
export function hoursToday(
  fact: GrammarFact<HoursByWeekday> | undefined,
  date: string,
): FactView<string> {
  if (fact === undefined) return UNKNOWN;
  if (fact.status === "absent") {
    return { status: "absent", source: fact.source, tier: fact.tier, fetchedAt: fact.fetchedAt };
  }
  return {
    status: "present",
    value: formatIntervals(fact.value[weekdayOf(date)] ?? []),
    source: fact.source,
    tier: fact.tier,
    fetchedAt: fact.fetchedAt,
  };
}

export function toTimelineDay(input: MappingInput): TimelineDay {
  const { day } = input;

  const places: Record<string, PlaceView> = {};
  for (const [id, place] of Object.entries(day.places)) {
    places[id] = {
      id,
      name: place.name,
      // An anchor's neighborhood is empty by construction (the user named
      // a place, not a district); the view model wants a non-empty string
      // and inventing one would be a small lie, so it says so.
      neighborhood: place.neighborhood === "" ? "—" : place.neighborhood,
      priceRange: mapFact<PriceRange>(place.priceRange),
      hoursToday: hoursToday(place.hours, day.date),
      vibe: UNKNOWN,
    };
  }

  const slots: SlotView[] = [...day.slots]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((slot) => {
      const reason = input.reasons.get(slot.id);
      return {
        id: slot.id,
        origin: slot.origin,
        kind: slot.kind,
        startTime: slot.startTime,
        endTime: slot.endTime,
        placeId: slot.placeId,
        // Anchors carry no concierge judgment; a concierge slot with no
        // narrated reason says nothing rather than something invented.
        reason:
          slot.origin === "user" || reason === undefined
            ? null
            : { text: reason, source: input.reasonSource, tier: TIERS.judgment },
        alternates: [],
      };
    });

  const travel: TravelMatrix = {};
  for (const leg of input.legs) {
    const view: TravelLeg = {
      mode: leg.mode,
      minutes: leg.minutes,
      source: leg.source,
      tier: leg.tier,
    };
    travel[travelKey(leg.fromPlaceId, leg.toPlaceId)] = view;
  }

  return {
    city: day.city,
    date: day.date,
    dayStart: day.dayStart,
    places,
    slots,
    travel,
    // One line for the whole matrix is the fixture's shape; a live day's
    // real provenance is per-leg above. This field stays truthful by
    // naming every provider that contributed and the least-verified tier
    // among them — never an average, never the best one.
    travelProvenance: {
      source:
        [...new Set(input.legs.map((l) => l.source))].sort().join(" + ") ||
        "none",
      tier: input.legs.reduce<Tier>(
        (worst, l) => (l.tier > worst ? l.tier : worst),
        TIERS.verified,
      ),
      fetchedAt: input.generatedAt,
    },
  };
}
