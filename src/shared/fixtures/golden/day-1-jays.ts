/**
 * Golden Day 1 — Summer Saturday with a Jays game (ANCHORED).
 * Source: docs/golden-set/golden-set-v2.md, founder-verified 2026-08-06.
 *
 * Converted as the founder wrote it. Where the day and the validator
 * disagree, the disagreement is reported for adjudication rather than
 * quietly edited — a golden day the validator rejects is either a
 * validator bug or a golden-set error, and it is not this file's job to
 * decide which.
 *
 * Trap payload: Seven Lives is permanently closed and is deliberately NOT
 * here — Rasta Pasta is the founder-confirmed replacement, and the closed
 * place lives in the trap fixtures. The 09:30-coffee and after-dark-lake
 * traps likewise live there.
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
  "2026-06-27",
  "05:02",
  "05:38",
  "06:21",
  "20:19",
  "21:03",
  "21:39",
);

const places = byId([
  {
    id: "fika",
    name: "FIKA Cafe",
    neighborhood: "Kensington Market",
    coords: at(43.6545, -79.4008),
    tags: tags(),
    category: present("cafes", CONCIERGE, TIERS.observed),
    // The per-weekday trap in its true form: 10:00 Fri/Sat, 10:30 otherwise.
    hours: present(
      hours({ default: [["10:30", "19:00"]], friday: [["10:00", "19:00"]], saturday: [["10:00", "19:00"]] }),
      FOUNDER,
      TIERS.verified,
    ),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(16, 20), PLACES_API, TIERS.observed),
  },
  {
    id: "kensington",
    name: "Kensington Market",
    neighborhood: "Kensington Market",
    coords: at(43.6547, -79.4022),
    tags: tags({ outdoor: true }),
    category: present("markets", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["08:00", "20:00"]] }), FOUNDER, TIERS.observed),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    // Known-free is a value, not an absence (min = max = 0).
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "rasta",
    name: "Rasta Pasta",
    neighborhood: "Kensington Market",
    coords: at(43.6551, -79.4014),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["11:00", "21:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(32, 48), PLACES_API, TIERS.observed),
  },
  {
    id: "graffiti",
    name: "Graffiti Alley",
    neighborhood: "Queen West",
    coords: at(43.6479, -79.399),
    tags: tags({ outdoor: true }),
    category: present("historic_sites", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["00:00", "24:00"]] }), FOUNDER, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "harbourfront",
    name: "Harbourfront",
    neighborhood: "Harbourfront",
    coords: at(43.6387, -79.3816),
    tags: tags({ outdoor: true }),
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["06:00", "23:00"]] }), FOUNDER, TIERS.observed),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "roundhouse",
    name: "Roundhouse Park",
    neighborhood: "Entertainment District",
    coords: at(43.6414, -79.3861),
    tags: tags({ outdoor: true }),
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["08:00", "23:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(24, 36), PLACES_API, TIERS.observed),
  },
  {
    id: "rogers",
    name: "Rogers Centre",
    neighborhood: "Entertainment District",
    coords: at(43.6414, -79.3894),
    tags: tags({ highCrowd: true }),
    // A stadium is none of our seven categories, and event-day hours are
    // not published as a weekly pattern. Both are honest absences.
    category: absent(CONCIERGE, TIERS.observed),
    hours: absent(PLACES_API, TIERS.observed),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    // What the user paid for their own tickets is not ours to know.
    priceRange: absent(PLACES_API, TIERS.observed),
  },
  {
    id: "ruby",
    name: "Ruby Soho",
    neighborhood: "King & Portland",
    coords: at(43.6444, -79.4008),
    tags: tags(),
    category: present("nightlife_bars", CONCIERGE, TIERS.observed),
    // Open past midnight in reality; the hours model is same-day, so the
    // close is recorded at 24:00. Noted as a limitation, not a fact.
    hours: present(hours({ default: [["11:00", "24:00"]] }), FOUNDER, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(38, 52), FOUNDER, TIERS.observed),
  },
]);

const day: GrammarDay = {
  id: "golden-1",
  city: "toronto",
  date: "2026-06-27",
  archetype: "city",
  dayStart: "09:30",
  dayEnd: "23:45",
  places,
  slots: [
    slot({ id: "s1", place: "fika", from: "10:00", to: "10:45", kind: "meal" }),
    slot({ id: "s2", place: "kensington", from: "10:45", to: "12:00" }),
    slot({ id: "s3", place: "rasta", from: "12:00", to: "13:00", kind: "meal" }),
    slot({ id: "s4", place: "graffiti", from: "13:15", to: "14:45" }),
    slot({ id: "s5", place: "harbourfront", from: "15:15", to: "17:00", by: "transit" }),
    // 18:05, not the document's 18:30: the anchor starts 18:30, the walk
    // to the dome is seven minutes, and the arrival buffer is fifteen, so
    // the last possible departure is 18:08. The day as written left zero
    // transfer time into a fixed commitment. Adjudicated at Session 7
    // CHECKPOINT 2 — the anchor does not move, so the park gives way.
    slot({ id: "s6", place: "roundhouse", from: "17:15", to: "18:05" }),
    slot({ id: "s7", place: "rogers", from: "18:30", to: "22:00", origin: "user" }),
    slot({ id: "s8", place: "ruby", from: "22:30", to: "23:30", kind: "meal" }),
  ],
};

export const goldenDay1: GoldenDay = {
  key: "day-1-jays",
  title: "Summer Saturday with a Jays game (anchored)",
  day,
  daylight: light,
  windows: clearWindows(light),
  mealPattern: "coffee_then_brunch",
  persona: { structure: "scheduler" },
  budgetBand: { min: 0, max: 160, currency: "CAD" },
  lodging: null,
  anchorBaseline: {
    s7: { startTime: "18:30", endTime: "22:00", placeId: "rogers" },
  },
};
