/**
 * Negative fixtures — the other half of the exam (XXX-26).
 *
 * Each one takes a founder-verified day and breaks exactly one thing, so
 * a failure names its own cause: if the FIKA trap stops firing, the
 * per-weekday hours rule broke, and nothing else is in the frame.
 *
 * All seven trap classes from the founder red-pen (XXX-5 comment 10291)
 * are represented, plus the negatives the other sources demand — the
 * six-hour Distillery from golden-set lesson #1, the 19:04 class from
 * Session 3's E5 lessons, the inverted slot from Session 2's deferred
 * midnight constraint.
 */

import { MatrixTravelProvider } from "../../day-grammar/travel";
import type {
  GrammarDay,
  GrammarPlace,
  LatLng,
  RuleId,
  TravelEstimate,
  TravelTimeProvider,
} from "../../day-grammar/types";
import { goldenDay1 } from "./day-1-jays";
import { goldenDay2 } from "./day-2-old-town";
import { goldenDay3 } from "./day-3-winter";
import { goldenDay4 } from "./day-4-budget";
import { goldenDay5 } from "./day-5-wanderer";
import { goldenDay6 } from "./day-6-excursion";
import {
  CONCIERGE,
  FOUNDER,
  GoldenDay,
  PLACES_API,
  at,
  cad,
  hours,
  present,
  slot,
  tags,
} from "./support";
import { TIERS } from "../../vocabulary";

export interface TrapFixture {
  key: string;
  title: string;
  /** The rule this day MUST trip. */
  expect: RuleId;
  /** Which founder trap class this belongs to, if any. */
  trapClass: number | null;
  why: string;
  golden: GoldenDay;
  /**
   * Overrides the default Haversine stub. Only the corridor trap needs
   * one, and the reason is documented there — it is a real limitation of
   * straight-line estimation, not a convenience.
   */
  travel?: TravelTimeProvider;
}

function broken(
  base: GoldenDay,
  spec: Omit<TrapFixture, "golden">,
  breakIt: (g: GoldenDay) => void,
): TrapFixture {
  const clone = structuredClone(base) as GoldenDay;
  breakIt(clone);
  clone.key = spec.key;
  clone.day.id = spec.key;
  return { ...spec, golden: clone };
}

const ago: GrammarPlace = {
  id: "ago",
  name: "Art Gallery of Ontario",
  neighborhood: "Grange Park",
  coords: at(43.6536, -79.3925),
  tags: tags(),
  category: present("museums_galleries", CONCIERGE, TIERS.observed),
  hours: present(hours({ default: [["10:30", "17:00"]], wednesday: [["10:30", "21:00"]], monday: [] }), PLACES_API, TIERS.verified),
  businessStatus: present("operational", PLACES_API, TIERS.verified),
  priceRange: present(cad(0), FOUNDER, TIERS.verified),
  // Trap class 3: a date-math rule, not a weekly pattern.
  offerings: present(
    [
      {
        label: "free admission",
        kind: "nth-weekday-of-month" as const,
        weekday: "wednesday" as const,
        ordinal: 1,
        window: { open: "18:00", close: "21:00" },
      },
    ],
    FOUNDER,
    TIERS.verified,
  ),
};

const winterVillage: GrammarPlace = {
  id: "wintervillage",
  name: "Distillery Winter Village",
  neighborhood: "Distillery",
  coords: at(43.6503, -79.3596),
  tags: tags({ outdoor: true }),
  category: present("markets", CONCIERGE, TIERS.observed),
  hours: present(hours({ default: [["12:00", "22:00"]] }), PLACES_API, TIERS.verified),
  businessStatus: present("operational", PLACES_API, TIERS.verified),
  // Trap class 4: founder-verified end date, ~Jan 4.
  seasonal: present(
    { startDate: "2026-11-14", endDate: "2027-01-04" },
    FOUNDER,
    TIERS.verified,
  ),
  priceRange: present(cad(0), FOUNDER, TIERS.verified),
};

/**
 * Trap class 6 — the founder's own failure example, NOL before Beamsville.
 *
 * This one needs two departures from the pattern, and both are findings
 * rather than conveniences.
 *
 * FIRST, it carries the Toronto departure as a slot. The golden day starts
 * at Beamsville with "08:30 — depart Toronto" as prose, so the leg where
 * the backtrack actually costs money is not modelled at all. XXX-28's
 * "travel legs as first-class slots" is precisely this fix, and the trap
 * cannot be posed honestly without it.
 *
 * SECOND, it runs on a road-distance matrix instead of the Haversine
 * stub. The stub CANNOT see this trap: straight-line, Beamsville and
 * Niagara-on-the-Lake are both roughly "on the way", so the backtrack
 * costs only ~14 minutes and never clears XXX-29's 20-minute threshold.
 * By road it costs 55, because the QEW curves around the lake. Lowering
 * the threshold to make the test pass would have been fudging the exam;
 * the honest answer is that corridor monotonicity needs real road times,
 * and this fixture says so by using them — through MatrixTravelProvider,
 * which is the same seam XXX-24 will drop into.
 */
function corridorBacktrackTrap(): TrapFixture {
  const coords = {
    toronto: at(43.6532, -79.3832),
    nol: at(43.2557, -79.0715),
    beamsville: at(43.165, -79.475),
    peller: at(43.234, -79.068),
    tablerock: at(43.079, -79.0783),
    napoli: at(43.092, -79.081),
  } satisfies Record<string, LatLng>;

  /** Founder-plausible QEW driving times, symmetric. Minutes. */
  const roadMinutes: Record<string, number> = {
    "toronto|beamsville": 75,
    "toronto|nol": 105,
    "toronto|peller": 100,
    "toronto|tablerock": 95,
    "toronto|napoli": 95,
    "beamsville|nol": 30,
    "beamsville|peller": 35,
    "beamsville|tablerock": 35,
    "beamsville|napoli": 35,
    "nol|peller": 10,
    "nol|tablerock": 25,
    "nol|napoli": 25,
    "peller|tablerock": 22,
    "peller|napoli": 22,
    "tablerock|napoli": 8,
  };

  const matrix: Record<string, TravelEstimate> = {};
  const names = Object.keys(coords) as (keyof typeof coords)[];
  for (const from of names) {
    for (const to of names) {
      if (from === to) continue;
      const minutes =
        roadMinutes[`${from}|${to}`] ?? roadMinutes[`${to}|${from}`];
      if (minutes === undefined) continue;
      matrix[
        MatrixTravelProvider.key({
          origin: coords[from],
          destination: coords[to],
          mode: "drive",
        })
      ] = { minutes, provenance: { source: "founder_road_times", tier: TIERS.verified } };
    }
  }

  const base = structuredClone(goldenDay6) as GoldenDay;
  const places = base.day.places;
  places.toronto = {
    id: "toronto",
    name: "Toronto",
    neighborhood: "Downtown",
    coords: coords.toronto,
    tags: tags(),
    category: present("historic_sites", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["00:00", "24:00"]] }), FOUNDER, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  };

  const day: GrammarDay = {
    ...base.day,
    id: "trap-corridor-backtrack",
    dayStart: "08:00",
    dayEnd: "21:00",
    places,
    slots: [
      // Trip-level departure anchor (XXX-27: arrival/departure bookend the day).
      slot({ id: "s0", place: "toronto", from: "08:00", to: "08:30", by: "drive", origin: "user" }),
      slot({ id: "s1", place: "nol", from: "10:15", to: "12:00", by: "drive" }),
      slot({ id: "s2", place: "beamsville", from: "12:30", to: "13:30", by: "drive" }),
      slot({ id: "s3", place: "peller", from: "14:05", to: "15:30", kind: "meal", by: "drive" }),
      slot({ id: "s4", place: "tablerock", from: "15:55", to: "17:30", by: "drive" }),
      slot({ id: "s5", place: "napoli", from: "18:00", to: "19:15", kind: "meal", by: "drive" }),
    ],
  };

  return {
    key: "trap-corridor-backtrack",
    title: "Excursion that backtracks: NOL before Beamsville",
    expect: "route.detour-avoidable",
    trapClass: 6,
    why: "The founder's own failure example. Excursion stops sequence along the travel corridor; this order doubles back and costs 55 minutes.",
    golden: { ...base, key: "trap-corridor-backtrack", day },
    travel: new MatrixTravelProvider(matrix),
  };
}

export const TRAP_FIXTURES: readonly TrapFixture[] = [
  // --- the seven founder trap classes -------------------------------------
  broken(
    goldenDay1,
    {
      key: "trap-closed-place",
      title: "Seven Lives, permanently closed",
      expect: "validity.permanently-closed",
      trapClass: 1,
      why: "Snapshots go stale. Recommending a closed place is a trust-killing failure.",
    },
    (g) => {
      g.day.places.rasta = {
        ...g.day.places.rasta,
        id: "rasta",
        name: "Seven Lives Tacos",
        businessStatus: present("closed_permanently", PLACES_API, TIERS.verified),
      };
    },
  ),
  broken(
    goldenDay1,
    {
      key: "trap-weekday-hours-open",
      title: "09:30 coffee at a cafe that opens 10:00 on Saturdays",
      expect: "hours.outside-open-window",
      trapClass: 2,
      why: "FIKA opens 10:00 Fri/Sat and 10:30 otherwise. Hours are per-weekday structures, never one string.",
    },
    (g) => {
      g.day.slots[0].startTime = "09:30";
    },
  ),
  broken(
    goldenDay2,
    {
      key: "trap-weekday-hours-closed",
      title: "St. Lawrence Market on a Monday",
      expect: "hours.closed-day",
      trapClass: 2,
      why: "Founder-verified: closed MONDAYS, not Sundays. The Monday version of this day is invalid.",
    },
    (g) => {
      // 2026-05-18 is the Monday after the golden Saturday.
      g.day.date = "2026-05-18";
      if (g.daylight) g.daylight.date = "2026-05-18";
      if (g.windows) g.windows.date = "2026-05-18";
    },
  ),
  broken(
    goldenDay3,
    {
      key: "trap-recurrence-wrong-wednesday",
      title: "Free AGO on the third Wednesday",
      expect: "validity.recurrence-unmet",
      trapClass: 3,
      why: "Free admission is the FIRST Wednesday evening only. Wrong-Wednesday is a real failure mode.",
    },
    (g) => {
      // 2027-01-20 is a Wednesday, but the third of its month.
      g.day.date = "2027-01-20";
      if (g.daylight) g.daylight.date = "2027-01-20";
      if (g.windows) g.windows.date = "2027-01-20";
      g.day.places.ago = ago;
      g.day.slots = [
        ...g.day.slots.filter((s) => s.id !== "s6"),
        slot({
          id: "s6",
          place: "ago",
          from: "18:00",
          to: "20:00",
          by: "transit",
          requires: "free admission",
        }),
      ];
    },
  ),
  broken(
    goldenDay3,
    {
      key: "trap-seasonal-expired",
      title: "Distillery Winter Village on 20 January",
      expect: "validity.seasonal-expired",
      trapClass: 4,
      why: "Founder-verified end ~Jan 4. Recommending it post-closure is the canonical stale-generation bug.",
    },
    (g) => {
      g.day.date = "2027-01-20";
      if (g.daylight) g.daylight.date = "2027-01-20";
      if (g.windows) g.windows.date = "2027-01-20";
      g.day.places.wintervillage = winterVillage;
      g.day.slots = [
        ...g.day.slots.filter((s) => s.id !== "s6"),
        slot({ id: "s6", place: "wintervillage", from: "18:30", to: "20:00", by: "transit" }),
      ];
    },
  ),
  broken(
    goldenDay2,
    {
      key: "trap-reset-gap-no-lodging",
      title: "Hotel-reset gap with no lodging known",
      expect: "structure.reset-gap-without-lodging",
      trapClass: 5,
      why: "The 17:00–19:00 reset is only valid if the hotel is near, and trips carry no lodging location. Founder-flagged schema gap.",
    },
    () => {
      // Day 2 already carries the gap; the trap is that lodging is null,
      // which is the schema's state today. Nothing to break.
    },
  ),
  corridorBacktrackTrap(),
  broken(
    goldenDay5,
    {
      key: "trap-reservability",
      title: "Weekend brunch at a place that takes no bookings",
      expect: "reservability.walk-in-only",
      trapClass: 7,
      why: "Lady Marmalade takes no weekend bookings. Reservability changes the ADVICE, distinct from hours or price.",
    },
    () => {
      // Already true of the golden day — the advice must be generated.
    },
  ),

  // --- the negatives the other sources demand ------------------------------
  broken(
    goldenDay2,
    {
      key: "trap-dwell-overstay",
      title: "Six hours in the Distillery",
      expect: "dwell.overstay",
      trapClass: null,
      why: "Golden-set lesson #1. The day is perfectly time-valid and still wrong.",
    },
    (g) => {
      g.day.slots[4].endTime = "20:30";
      g.day.slots = g.day.slots.filter((s) => s.id !== "s6");
    },
  ),
  broken(
    goldenDay3,
    {
      key: "trap-dwell-understay",
      title: "Twenty minutes in the ROM",
      expect: "dwell.understay",
      trapClass: null,
      why: "A promise the day cannot keep; museums need 45 minutes at the very least.",
    },
    (g) => {
      g.day.slots[1].endTime = "10:50";
    },
  ),
  broken(
    goldenDay2,
    {
      key: "trap-meal-window",
      title: "Brunch at 16:40",
      expect: "meal.outside-pattern-window",
      trapClass: null,
      why: "Session 3 E5 lesson 3: a drag can put brunch at 16:40, and the validator — not the gesture — is the gate.",
    },
    (g) => {
      g.day.slots[3].startTime = "16:40";
      g.day.slots[3].endTime = "17:25";
    },
  ),
  broken(
    goldenDay1,
    {
      key: "trap-outdoor-after-dark",
      title: "Lake walk after dark",
      expect: "daylight.outdoor-after-dark",
      trapClass: null,
      why: "Named in Day 1's own trap list. Civil dusk is 21:39; this walk runs to 22:30.",
    },
    (g) => {
      g.day.slots[4].startTime = "20:45";
      g.day.slots[4].endTime = "22:30";
    },
  ),
  broken(
    goldenDay3,
    {
      key: "trap-weather-adverse",
      title: "Outdoor skate inside the snow window",
      expect: "weather.outdoor-in-adverse-window",
      trapClass: null,
      why: "The derived rain window is 08:00–12:00 and a clear window exists at midday, so this is avoidable — and therefore a violation, not a shrug.",
    },
    (g) => {
      g.day.slots[3].startTime = "09:30";
      g.day.slots[3].endTime = "10:45";
    },
  ),
  broken(
    goldenDay2,
    {
      key: "trap-travel-1904",
      title: "The 19:04 class",
      expect: "travel.infeasible",
      trapClass: null,
      why: "Session 3 E5 lesson 1: a transition that lands four minutes into a fixed commitment. Every edge is checked, not just anchored ones.",
    },
    (g) => {
      // Distillery to a downtown dinner with two minutes to cross the city.
      g.day.slots[5].placeId = "petit";
      g.day.slots[5].startTime = "16:32";
      g.day.slots[5].endTime = "17:20";
    },
  ),
  broken(
    goldenDay1,
    {
      key: "trap-anchor-mutated",
      title: "A suggested fix that moved the user's booking",
      expect: "anchor.mutated",
      trapClass: null,
      why: "XXX-27: origin='user' slots are immovable and unswappable. XXX-29 restates it — anchors pinned.",
    },
    (g) => {
      g.day.slots[6].startTime = "19:30";
      g.day.slots[6].endTime = "23:00";
    },
  ),
  broken(
    goldenDay1,
    {
      key: "trap-egress-crush",
      title: "Dinner five minutes after the final out",
      expect: "anchor.egress-buffer-short",
      trapClass: null,
      why: "Day 1 leaves 22:00–22:30 deliberately empty and calls it egress crush. This day books into it.",
    },
    (g) => {
      g.day.slots[7].startTime = "22:05";
      g.day.slots[7].endTime = "23:05";
    },
  ),
  broken(
    goldenDay5,
    {
      key: "trap-wanderer-scheduled",
      title: "A wanderer scheduled to the minute",
      expect: "pacing.wanderer-overscheduled",
      trapClass: null,
      why: "Golden Day 5, verbatim: a fully-scheduled output for this persona is a FAILURE.",
    },
    (g) => {
      g.day.slots[0].endTime = "13:00";
      g.day.slots[1].startTime = "13:15";
      g.day.slots[1].endTime = "16:30";
      g.day.slots[2].startTime = "16:45";
      g.day.slots[2].endTime = "23:00";
    },
  ),
  broken(
    goldenDay4,
    {
      key: "trap-budget-blown",
      title: "A splurge dinner on a $70 day",
      expect: "budget.over-band",
      trapClass: null,
      why: "Day 4's traps include dinner blowing 60% of the budget.",
    },
    (g) => {
      g.day.places.banhmi.priceRange = present(cad(110, 150), PLACES_API, TIERS.observed);
    },
  ),
  broken(
    goldenDay1,
    {
      key: "trap-inverted-slot",
      title: "A slot that crosses midnight",
      expect: "midnight.slot-inverted",
      trapClass: null,
      why: "Session 2's deferred constraint: slots_time_interval_valid forbids it. The validator refuses to certify what the schema cannot store.",
    },
    (g) => {
      g.day.slots[7].startTime = "23:00";
      g.day.slots[7].endTime = "01:00";
    },
  ),
  broken(
    goldenDay2,
    {
      key: "trap-market-late",
      title: "The market at four in the afternoon",
      expect: "wisdom.off-peak-window",
      trapClass: null,
      why: "Day 2: morning is peak vendors, afternoon is picked over. Open, but wrong — hours compliance is not hours wisdom.",
    },
    (g) => {
      g.day.slots[1].startTime = "15:00";
      g.day.slots[1].endTime = "16:45";
      g.day.slots[2].startTime = "16:45";
      g.day.slots[2].endTime = "18:15";
    },
  ),
  broken(
    goldenDay2,
    {
      key: "trap-travel-uncertifiable",
      title: "A stop with no coordinates",
      expect: "travel.uncertifiable",
      trapClass: null,
      why: "Session 3 E5 lesson 4: an unknown leg is not a zero-minute leg. Refuse to certify rather than silently tighten the plan.",
    },
    (g) => {
      g.day.places.distillery.coords = null;
    },
  ),
];
