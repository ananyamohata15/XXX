/**
 * Golden Day 2 — Hours-bounded Saturday: Old Town classic (HOURS + ICONS).
 * Source: docs/golden-set/golden-set-v2.md.
 *
 * Two founder-verified facts do the heavy lifting here: St. Lawrence
 * Market is Sat 07:00–17:00 and closed MONDAYS (the draft's Sunday claim
 * was corrected in the red-pen), and the Distillery is a two-hour
 * experience.
 *
 * The Distillery slot is 14:30–16:30, not the document's 14:30–17:00:
 * adjudicated at Session 7 CHECKPOINT 1 after the day was found to
 * contradict its own "(2h dwell ceiling)" parenthetical. The freed thirty
 * minutes extend the free-time gap, which is itself the lodging trap.
 */

import type { GrammarDay } from "../../day-grammar/types";
import {
  CONCIERGE,
  FOUNDER,
  GoldenDay,
  PLACES_API,
  at,
  byId,
  cad,
  clearWindows,
  daylight,
  hours,
  present,
  slot,
  tags,
} from "./support";
import { TIERS } from "../../vocabulary";

const light = daylight(
  "2026-05-16",
  "05:18",
  "05:51",
  "06:32",
  "19:55",
  "20:37",
  "21:10",
);

const places = byId([
  {
    id: "petit",
    name: "Le Petit Déjeuner",
    neighborhood: "King East",
    coords: at(43.6531, -79.367),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    // The draft's 08:30 slot was invalid — this place opens at 09:00.
    hours: present(hours({ default: [["09:00", "15:00"]], monday: [] }), FOUNDER, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(14, 22), PLACES_API, TIERS.observed),
  },
  {
    id: "stlawrence",
    name: "St. Lawrence Market",
    neighborhood: "Old Town",
    coords: at(43.6488, -79.3715),
    tags: tags(),
    category: present("markets", CONCIERGE, TIERS.observed),
    // Founder-verified in person: Sat 07:00–17:00, closed MONDAYS.
    hours: present(
      hours({
        default: [["09:00", "19:00"]],
        monday: [],
        saturday: [["07:00", "17:00"]],
        sunday: [["10:00", "17:00"]],
      }),
      FOUNDER,
      TIERS.verified,
    ),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(8, 16), FOUNDER, TIERS.observed),
  },
  {
    id: "berczy",
    name: "Berczy Park & the Flatiron",
    neighborhood: "Old Town",
    coords: at(43.648, -79.3745),
    tags: tags({ outdoor: true }),
    category: present("historic_sites", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["00:00", "24:00"]] }), FOUNDER, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "marketst",
    name: "Market Street patio",
    neighborhood: "Old Town",
    coords: at(43.6486, -79.3706),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["11:30", "22:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(14, 22), PLACES_API, TIERS.observed),
  },
  {
    id: "distillery",
    name: "Distillery District",
    neighborhood: "Distillery",
    coords: at(43.6503, -79.3596),
    tags: tags({ outdoor: true }),
    category: present("historic_sites", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["08:00", "22:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "elcatrin",
    name: "El Catrín",
    neighborhood: "Distillery",
    coords: at(43.6503, -79.3592),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["11:30", "23:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(42, 58), PLACES_API, TIERS.observed),
  },
]);

const day: GrammarDay = {
  id: "golden-2",
  city: "toronto",
  date: "2026-05-16",
  archetype: "city",
  dayStart: "08:30",
  dayEnd: "21:30",
  places,
  slots: [
    slot({ id: "s1", place: "petit", from: "09:00", to: "09:45", kind: "meal" }),
    slot({ id: "s2", place: "stlawrence", from: "10:00", to: "11:45" }),
    slot({ id: "s3", place: "berczy", from: "11:45", to: "13:15" }),
    slot({ id: "s4", place: "marketst", from: "13:15", to: "14:00", kind: "meal" }),
    slot({ id: "s5", place: "distillery", from: "14:30", to: "16:30", by: "transit" }),
    // 16:30–19:00 is the hotel-reset gap: only valid if lodging is near,
    // and no lodging location exists in the schema (trap class 5).
    slot({ id: "s6", place: "elcatrin", from: "19:00", to: "21:00", kind: "meal" }),
  ],
};

export const goldenDay2: GoldenDay = {
  key: "day-2-old-town",
  title: "Hours-bounded Saturday: Old Town classic",
  day,
  daylight: light,
  windows: clearWindows(light),
  mealPattern: "classic",
  persona: { structure: "scheduler" },
  budgetBand: { min: 0, max: 120, currency: "CAD" },
  lodging: null,
  anchorBaseline: null,
};
