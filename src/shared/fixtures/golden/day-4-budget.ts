/**
 * Golden Day 4 — Budget-tight day, ~$70 all-in (BUDGET DISCIPLINE).
 * Source: docs/golden-set/golden-set-v2.md.
 *
 * The PRESTO day pass is $13.50, founder-confirmed and recorded in XXX-5
 * comment 10293, so this day is checkable end to end: the trap the
 * document names is "ignoring transit cost", and a $70 day that quietly
 * omits the fare is exactly the failure it means.
 *
 * Persona note: the document says "structure=wanderer-LEANING". Read as
 * `scheduler` here — Day 5 is the capitalised WANDERER and carries the
 * unstructured-fraction rule. A lean is a lean, not a structure
 * (Session 7 §1.7 reading 2, extended).
 *
 * Harbourfront is the golden set's one golden-hour-affine stop: the
 * 17:00–19:00 sunset walk overlaps evening golden hour (18:55–19:33), so
 * the affinity advisory correctly stays silent.
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
  "2026-09-12",
  "06:00",
  "06:53",
  "07:31",
  "18:55",
  "19:33",
  "20:01",
);

const places = byId([
  {
    id: "moonbean",
    name: "Moonbean Coffee",
    neighborhood: "Kensington Market",
    coords: at(43.6549, -79.402),
    tags: tags(),
    category: present("cafes", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["07:00", "19:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(6, 10), PLACES_API, TIERS.observed),
  },
  {
    id: "kenchinatown",
    name: "Kensington & Chinatown",
    neighborhood: "Kensington Market",
    coords: at(43.6535, -79.3995),
    tags: tags({ outdoor: true }),
    category: present("markets", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["08:00", "20:00"]] }), FOUNDER, TIERS.observed),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "juicy",
    name: "Juicy Dumpling",
    neighborhood: "Chinatown",
    coords: at(43.652, -79.398),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["11:00", "21:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    // Founder-verified: still the $6 legend.
    priceRange: present(cad(6), FOUNDER, TIERS.verified),
  },
  {
    id: "grange",
    name: "Grange Park & OCAD",
    neighborhood: "Grange Park",
    coords: at(43.6531, -79.3925),
    tags: tags({ outdoor: true }),
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["06:00", "23:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "bellwoods",
    name: "Trinity Bellwoods to Ossington",
    neighborhood: "Trinity Bellwoods",
    coords: at(43.647, -79.413),
    tags: tags({ outdoor: true }),
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["06:00", "23:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(5, 9), FOUNDER, TIERS.observed),
  },
  {
    id: "harbourfront",
    name: "Harbourfront",
    neighborhood: "Harbourfront",
    coords: at(43.6387, -79.3816),
    tags: tags({ outdoor: true, goldenHourAffine: true }),
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["06:00", "23:00"]] }), FOUNDER, TIERS.observed),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "banhmi",
    name: "Banh Mi Nguyen Huong",
    neighborhood: "Chinatown",
    coords: at(43.6532, -79.3985),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["09:00", "21:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(10, 14), FOUNDER, TIERS.observed),
  },
]);

const day: GrammarDay = {
  id: "golden-4",
  city: "toronto",
  date: "2026-09-12",
  archetype: "city",
  dayStart: "08:45",
  dayEnd: "20:30",
  places,
  slots: [
    slot({ id: "s1", place: "moonbean", from: "09:00", to: "09:30", kind: "meal" }),
    slot({ id: "s2", place: "kenchinatown", from: "09:30", to: "11:30" }),
    slot({ id: "s3", place: "juicy", from: "11:30", to: "12:15", kind: "meal" }),
    // 13:30, not the document's 14:00, and the 505 Dundas rather than a
    // walk: Grange to Trinity Bellwoods is 1.8 km, which the day as
    // written gave zero minutes. Adjudicated at Session 7 CHECKPOINT 2.
    slot({ id: "s4", place: "grange", from: "12:30", to: "13:30" }),
    // 150 minutes sits exactly on the parks dwell ceiling — a boundary the
    // exam is meant to hit, and it must pass, not fail.
    slot({ id: "s5", place: "bellwoods", from: "14:00", to: "16:30", by: "transit" }),
    // 18:30, not 19:00: Harbourfront to Chinatown is 2.1 km and dinner
    // stays at 19:00. Same adjudication.
    slot({ id: "s6", place: "harbourfront", from: "17:00", to: "18:30", by: "transit" }),
    slot({ id: "s7", place: "banhmi", from: "19:00", to: "20:00", kind: "meal" }),
  ],
};

export const goldenDay4: GoldenDay = {
  key: "day-4-budget",
  title: "Budget-tight day, ~$70 all-in",
  day,
  daylight: light,
  windows: clearWindows(light),
  mealPattern: "classic",
  persona: { structure: "scheduler" },
  budgetBand: { min: 0, max: 70, currency: "CAD" },
  lodging: null,
  anchorBaseline: null,
};
