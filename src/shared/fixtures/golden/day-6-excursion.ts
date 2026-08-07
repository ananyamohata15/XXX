/**
 * Golden Day 6 — EXCURSION: wine country + Falls by car (XXX-28 shape).
 * Source: docs/golden-set/golden-set-v2.md.
 *
 * XXX-28 is out of scope this session, so this day carries NO
 * excursion-specific rules: no car gate, no designated-driver check, no
 * corridor cost model. It is here because the interface must not preclude
 * them — `archetype: "excursion"` exists, the day validates under the
 * general grammar, and the founder's corridor-monotonicity fix (Toronto →
 * Beamsville → NOL → Falls → Toronto, no backtracking) is checkable by the
 * general `route.detour-avoidable` rule rather than a special one.
 *
 * Known modelling gap, stated rather than hidden: the 08:30 departure from
 * Toronto is not a slot, so the Toronto → Beamsville leg goes unchecked.
 * XXX-28's "travel legs as first-class slots (90–120 min each way)" is the
 * fix, and it is that ticket's to make.
 */

import type { GrammarDay } from "../../day-grammar/types";
import {
  CONCIERGE,
  FOUNDER,
  GoldenDay,
  PLACES_API,
  absent,
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
  "2026-08-14",
  "05:49",
  "06:21",
  "07:00",
  "19:42",
  "20:22",
  "20:53",
);

const places = byId([
  {
    id: "beamsville",
    name: "Beamsville bench winery",
    neighborhood: "Beamsville",
    coords: at(43.165, -79.475),
    tags: tags(),
    // The founder named a region and "ONE tasting stop", not a specific
    // winery, so neither category nor hours are ours to claim.
    category: absent(CONCIERGE, TIERS.observed),
    hours: absent(PLACES_API, TIERS.observed),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(50, 70), FOUNDER, TIERS.observed),
  },
  {
    id: "nol",
    name: "Niagara-on-the-Lake old town",
    neighborhood: "Niagara-on-the-Lake",
    coords: at(43.2557, -79.0715),
    tags: tags({ outdoor: true }),
    category: present("historic_sites", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["00:00", "24:00"]] }), FOUNDER, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "peller",
    name: "Peller Estates",
    neighborhood: "Niagara-on-the-Lake",
    coords: at(43.234, -79.068),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["11:30", "21:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    // Booking recommended — a soft anchor, not a hard one.
    reservability: present("accepts", PLACES_API, TIERS.observed),
    priceRange: present(cad(80, 100), FOUNDER, TIERS.observed),
  },
  {
    id: "tablerock",
    name: "Table Rock, Niagara Falls",
    neighborhood: "Niagara Falls",
    coords: at(43.079, -79.0783),
    tags: tags({ outdoor: true }),
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["00:00", "24:00"]] }), FOUNDER, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "napoli",
    name: "Napoli Ristorante",
    neighborhood: "Niagara Falls",
    coords: at(43.092, -79.081),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["16:00", "22:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(70, 90), FOUNDER, TIERS.observed),
  },
]);

const day: GrammarDay = {
  id: "golden-6",
  city: "toronto",
  date: "2026-08-14",
  archetype: "excursion",
  dayStart: "08:30",
  dayEnd: "21:00",
  places,
  slots: [
    slot({ id: "s1", place: "beamsville", from: "09:45", to: "10:45", by: "drive" }),
    // 12:40, not the document's 13:00: the winery is a 2.5 km drive from
    // the old town and lunch is booked for 13:00. Adjudicated at Session 7
    // CHECKPOINT 2.
    slot({ id: "s2", place: "nol", from: "11:15", to: "12:40", by: "drive" }),
    slot({ id: "s3", place: "peller", from: "13:00", to: "14:30", kind: "meal", by: "drive" }),
    slot({ id: "s4", place: "tablerock", from: "15:30", to: "17:30", by: "drive" }),
    slot({ id: "s5", place: "napoli", from: "18:00", to: "19:15", kind: "meal", by: "drive" }),
  ],
};

export const goldenDay6: GoldenDay = {
  key: "day-6-excursion",
  title: "Excursion: wine country + Falls by car",
  day,
  daylight: light,
  windows: clearWindows(light),
  mealPattern: "classic",
  persona: { structure: "scheduler" },
  budgetBand: { min: 0, max: 250, currency: "CAD" },
  lodging: null,
  anchorBaseline: null,
};
