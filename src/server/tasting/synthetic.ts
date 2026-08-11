/**
 * The synthetic day (XXX-32, Session 10 Step 3).
 *
 * A canned `GrammarDay` pushed through the REAL view-model path, so the
 * page, the mapping, the chips and the verdict round-trip can all be
 * felt on a phone while Google Details quota is unavailable. It is
 * labelled synthetic everywhere it appears: in the response, on the
 * page, and in the trace.
 *
 * Two deliberate choices:
 *
 * 1. It uses REAL pool places, so a verdict has a real `place_id` to
 *    attach to and the write path is exercised end to end rather than
 *    mocked. The alternative — fixture ids — would fail the evidence
 *    foreign key and prove nothing.
 * 2. Because it uses real places, a founder ✗ on a fabricated card must
 *    never write ground truth about a real venue. The trace marks the
 *    context `synthetic: true` and the evidence path refuses to flip
 *    on it. The claim is still recorded, so the UX round-trips
 *    honestly; only the fact write is withheld.
 *
 * The facts are chosen to exercise all three honest-absence states —
 * present, looked-and-absent, never-fetched — because a lucky real
 * generation might show only the first, and those three rendering
 * paths are exactly what the founder needs to judge.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GrammarDay,
  GrammarFact,
  GrammarPlace,
  HoursByWeekday,
} from "@/shared/day-grammar/types";
import type { PriceRange } from "@/shared/timeline";
import type { ComposedLeg } from "../generation/types";
import { WEEKDAYS } from "@/shared/vocabulary";

const SOURCE = "synthetic_preview";

const week = (open: string, close: string): HoursByWeekday =>
  Object.fromEntries(
    WEEKDAYS.map((d) => [d, [{ open, close }]]),
  ) as HoursByWeekday;

const present = <T>(value: T, source: string, tier: 1 | 2 | 3, at: string): GrammarFact<T> => ({
  status: "present",
  value,
  source,
  tier,
  fetchedAt: at,
});

const absent = (source: string, tier: 1 | 2 | 3, at: string): GrammarFact<never> => ({
  status: "absent",
  source,
  tier,
  fetchedAt: at,
});

interface Stop {
  slotId: string;
  kind: "meal" | "activity";
  startTime: string;
  endTime: string;
  reason: string;
  /** Which honest-absence state this card demonstrates. */
  facts: "full" | "price-absent" | "hours-never-fetched";
}

const STOPS: Stop[] = [
  {
    slotId: "s-i1",
    kind: "meal",
    startTime: "09:30",
    endTime: "10:15",
    reason:
      "A short walk from the start, open early, and the kind of counter that fills with regulars before ten.",
    facts: "full",
  },
  {
    slotId: "s-i2",
    kind: "activity",
    startTime: "10:45",
    endTime: "12:15",
    reason:
      "The morning's anchor, indoors while the light is still flat, and close enough to lunch to walk.",
    facts: "price-absent",
  },
  {
    slotId: "s-i3",
    kind: "meal",
    startTime: "12:45",
    endTime: "13:45",
    reason:
      "Lunch inside the pattern window, two blocks off the route, priced for the band.",
    facts: "hours-never-fetched",
  },
  {
    slotId: "s-i4",
    kind: "activity",
    startTime: "14:15",
    endTime: "15:45",
    reason:
      "An afternoon that does not rhyme with the morning — a different neighbourhood and a different register.",
    facts: "full",
  },
];

export interface SyntheticDay {
  day: GrammarDay;
  legs: ComposedLeg[];
  reasons: Map<string, string>;
  dayNotes: string[];
  advisories: { ruleId: string; text: string }[];
  headline: string;
}

export async function buildSyntheticDay(
  client: SupabaseClient,
  date: string,
  nowIso: string,
): Promise<SyntheticDay> {
  const { data, error } = await client
    .from("places")
    .select("id, name, lat, lng")
    .eq("city", "toronto")
    .eq("source", "fsq_os_places")
    .order("id")
    .limit(STOPS.length);
  if (error) throw new Error(`synthetic day pool read failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length < STOPS.length) {
    throw new Error("pool has too few places for a synthetic day");
  }

  const places: Record<string, GrammarPlace> = {};
  const slots: GrammarDay["slots"] = [];

  STOPS.forEach((stop, i) => {
    const row = rows[i] as { id: string; name: string; lat: number; lng: number };
    const place: GrammarPlace = {
      id: row.id,
      name: row.name,
      neighborhood: ["Kensington", "Downtown core", "Queen West", "Leslieville"][i],
      coords: { lat: row.lat, lng: row.lng },
      tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
      category: present(
        stop.kind === "meal" ? ("restaurants" as const) : ("museums_galleries" as const),
        SOURCE,
        2,
        nowIso,
      ),
      businessStatus: present("operational" as const, SOURCE, 1, nowIso),
    };

    if (stop.facts === "full") {
      place.hours = present(week("09:00", "18:00"), SOURCE, 1, nowIso);
      place.priceRange = present<PriceRange>(
        { min: 15, max: 40, currency: "CAD" },
        SOURCE,
        2,
        nowIso,
      );
    } else if (stop.facts === "price-absent") {
      place.hours = present(week("10:00", "17:00"), SOURCE, 1, nowIso);
      // We looked and it is not published — distinct from never fetched.
      place.priceRange = absent(SOURCE, 2, nowIso);
    } else {
      // No hours fact at all: never fetched. The card must not claim we
      // looked, which is the whole reason the third arm exists.
      place.priceRange = present<PriceRange>(
        { min: 0, max: 0, currency: "CAD" },
        SOURCE,
        3,
        nowIso,
      );
    }

    places[row.id] = place;
    slots.push({
      id: stop.slotId,
      origin: "concierge",
      kind: stop.kind,
      startTime: stop.startTime,
      endTime: stop.endTime,
      placeId: row.id,
      arriveBy: i === 0 ? "walk" : i === 2 ? "transit" : "walk",
    });
  });

  const ids = slots.map((s) => s.placeId);
  const legs: ComposedLeg[] = [
    // Mixed provenance on purpose: the attribution marks are conditional
    // on which providers actually contributed, so the preview has to
    // contain more than one.
    { fromPlaceId: ids[0], toPlaceId: ids[1], minutes: 12, mode: "walk", source: "openrouteservice", tier: 2, exposureSwap: null },
    { fromPlaceId: ids[1], toPlaceId: ids[2], minutes: 18, mode: "transit", source: "google_routes", tier: 1, exposureSwap: null },
    { fromPlaceId: ids[2], toPlaceId: ids[3], minutes: 9, mode: "walk", source: "openrouteservice", tier: 2, exposureSwap: null },
  ];

  return {
    day: {
      id: `synthetic-${date}`,
      city: "toronto",
      date,
      archetype: "city",
      dayStart: "09:00",
      dayEnd: "21:30",
      slots,
      places,
    },
    legs,
    reasons: new Map(STOPS.map((s) => [s.slotId, s.reason])),
    dayNotes: [
      "A synthetic day: real venues from the pool, fabricated facts and times. Nothing here was fetched or validated.",
      "Rain after four — the afternoon stop is indoors and the walk before it is short.",
    ],
    advisories: [
      {
        ruleId: "hours.unknown",
        text: "One stop's hours were never fetched — it is shown as not recorded, not as open.",
      },
    ],
    headline: "Synthetic preview — four stops, no generation behind them.",
  };
}
