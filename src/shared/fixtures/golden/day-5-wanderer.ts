/**
 * Golden Day 5 — Wanderer day: 3 anchors + zones (STRUCTURE SHAPE TEST).
 * Source: docs/golden-set/golden-set-v2.md.
 *
 * "A fully-scheduled output for this persona is a FAILURE." That sentence
 * is a rule, and it is `pacing.wanderer-overscheduled`. This day is the
 * positive case: three soft anchors, roughly 60% of the day left open.
 *
 * The document's soft anchors carry no end times ("Afternoon anchor
 * ~14:30 — MOCA", then "drift"). GrammarSlot requires both ends, so they
 * are bounded here and the wanderer-ness is carried by the unstructured
 * FRACTION rather than by inventing open-ended slots (Session 7 §1.7
 * reading 2).
 *
 * MOCA's five distinct daily schedules are the per-weekday trap in its
 * most extreme form. 2026-07-12 is a Sunday, so 10:00–17:00 applies; the
 * Monday and Tuesday versions of this day are closed-day violations and
 * live in the trap fixtures.
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
  "2026-07-12",
  "05:12",
  "05:47",
  "06:30",
  "20:15",
  "20:58",
  "21:33",
);

const places = byId([
  {
    id: "ladymarmalade",
    name: "Lady Marmalade",
    neighborhood: "Riverside",
    coords: at(43.659, -79.351),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["09:00", "15:00"]], monday: [] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    // Trap class 7: reservability is its own fact class, and it changes
    // the ADVICE rather than the legality. No weekend bookings.
    reservability: present("walk_in_only", FOUNDER, TIERS.verified),
    priceRange: present(cad(38, 52), PLACES_API, TIERS.observed),
  },
  {
    id: "moca",
    name: "MOCA Toronto",
    neighborhood: "Sterling Road",
    coords: at(43.6537, -79.4453),
    tags: tags(),
    category: present("museums_galleries", CONCIERGE, TIERS.observed),
    // Founder-verified: five distinct daily schedules, two closed days.
    hours: present(
      hours({
        default: [["10:00", "17:00"]],
        monday: [],
        tuesday: [],
        wednesday: [["11:00", "17:00"]],
        thursday: [["11:00", "17:00"]],
        friday: [["12:00", "17:00"]],
      }),
      FOUNDER,
      TIERS.verified,
    ),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(20), PLACES_API, TIERS.observed),
  },
  {
    id: "badiali",
    name: "Badiali",
    neighborhood: "Ossington",
    coords: at(43.6478, -79.42),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["17:00", "23:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(42, 58), FOUNDER, TIERS.observed),
  },
]);

const day: GrammarDay = {
  id: "golden-5",
  city: "toronto",
  date: "2026-07-12",
  archetype: "city",
  dayStart: "09:30",
  // The strip is the plan — this day runs into the night on purpose.
  dayEnd: "23:30",
  places,
  slots: [
    slot({ id: "s1", place: "ladymarmalade", from: "10:00", to: "11:30", kind: "meal" }),
    slot({ id: "s2", place: "moca", from: "14:30", to: "16:30", by: "transit" }),
    slot({ id: "s3", place: "badiali", from: "19:30", to: "21:30", kind: "meal", by: "transit" }),
  ],
};

export const goldenDay5: GoldenDay = {
  key: "day-5-wanderer",
  title: "Wanderer day: 3 anchors + zones",
  day,
  daylight: light,
  windows: clearWindows(light),
  mealPattern: "coffee_then_brunch",
  persona: { structure: "wanderer" },
  budgetBand: { min: 0, max: 130, currency: "CAD" },
  lodging: null,
  anchorBaseline: null,
};
