/**
 * Golden Day 3 — Deep winter day (DAYLIGHT + WEATHER + INDOOR).
 * Source: docs/golden-set/golden-set-v2.md.
 *
 * Dated 2027-01-06 on purpose. The document says "mid-Jan Wed, sunset
 * ~16:55", but Session 6's ephemeris table showed the 16:55-ish sunset
 * lives in EARLY January (Jan 5–8 run 16:55–16:58; by mid-month it is
 * already 17:06). The correction was ratified at Session 6 CHECKPOINT 3
 * and applied here: 2027-01-06 is a Wednesday with sunset 16:56.
 *
 * A bonus of that date: it is also the FIRST Wednesday of its month, so
 * the AGO free-admission recurrence is genuinely satisfiable here — which
 * is what makes the wrong-Wednesday trap fixture a fair test rather than a
 * date nobody would ever have picked.
 *
 * This is the one golden day whose scheduling windows are DERIVED, not
 * authored: the hourly readings below go through Session 6's
 * deriveSchedulingWindows(). That is the proof the validator consumes that
 * function rather than reimplementing its thresholds.
 */

import type { GrammarDay } from "../../day-grammar/types";
import {
  deriveSchedulingWindows,
  type HourlyWeather,
} from "../../scheduling-windows";
import {
  CONCIERGE,
  FOUNDER,
  GoldenDay,
  PLACES_API,
  absent,
  at,
  byId,
  cad,
  daylight,
  hours,
  present,
  slot,
  tags,
} from "./support";
import { TIERS } from "../../vocabulary";

const light = daylight(
  "2027-01-06",
  "07:18",
  "07:50",
  "08:37",
  "16:09",
  "16:56",
  "17:28",
);

/**
 * −8 °C with light snow, as the document specifies. Apparent temperature
 * sits at −10 through the middle of the day and −13 outside it (cold-avoid
 * bites at −12), and the snow's precipitation probability clears the 40%
 * rain threshold only in the late morning. The derived result is a single
 * outdoor-friendly window at midday — which is exactly the "winter days
 * front-load outdoor time" grammar the founder described.
 */
const hourly: HourlyWeather[] = Array.from({ length: 24 }, (_, hour) => {
  const midday = hour >= 9 && hour <= 17;
  return {
    timeLocal: `2027-01-06T${String(hour).padStart(2, "0")}:00`,
    tempC: -8,
    apparentTempC: midday ? -10 : -13,
    precipProbPct: hour >= 8 && hour <= 11 ? 45 : 25,
    precipMm: 0.2,
    weatherCode: 73,
    windKph: 14,
    cloudCoverPct: 90,
  };
});

const places = byId([
  {
    id: "landwer",
    name: "Cafe Landwer",
    neighborhood: "Yorkville",
    coords: at(43.6684, -79.3959),
    tags: tags(),
    category: present("cafes", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["07:00", "23:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(18, 30), PLACES_API, TIERS.observed),
  },
  {
    id: "rom",
    name: "Royal Ontario Museum",
    neighborhood: "Yorkville",
    coords: at(43.6677, -79.3948),
    tags: tags(),
    category: present("museums_galleries", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["10:00", "17:30"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(46), PLACES_API, TIERS.observed),
  },
  {
    id: "planta",
    name: "Planta Yorkville",
    neighborhood: "Yorkville",
    coords: at(43.6706, -79.3925),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["11:00", "22:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(24, 40), PLACES_API, TIERS.observed),
  },
  {
    id: "nathan",
    name: "Nathan Phillips Square rink",
    neighborhood: "Downtown",
    coords: at(43.6525, -79.3839),
    tags: tags({ outdoor: true }),
    category: present("parks", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["06:00", "22:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(0), FOUNDER, TIERS.verified),
  },
  {
    id: "path",
    name: "the PATH",
    neighborhood: "Financial District",
    coords: at(43.6455, -79.3807),
    tags: tags(),
    // Converted as a wander, not a cafe (Session 7 §1.7 reading 3). The
    // PATH is none of our seven categories, so the category is honestly
    // absent and its dwell goes unchecked rather than mis-checked.
    category: absent(CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["06:00", "22:00"]] }), FOUNDER, TIERS.observed),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(6, 12), FOUNDER, TIERS.observed),
  },
  {
    id: "khaosan",
    name: "Khao San Road",
    neighborhood: "Entertainment District",
    coords: at(43.647, -79.393),
    tags: tags(),
    category: present("restaurants", CONCIERGE, TIERS.observed),
    hours: present(hours({ default: [["11:30", "22:00"]] }), PLACES_API, TIERS.verified),
    businessStatus: present("operational", PLACES_API, TIERS.verified),
    priceRange: present(cad(40, 60), FOUNDER, TIERS.observed),
  },
]);

const day: GrammarDay = {
  id: "golden-3",
  city: "toronto",
  date: "2027-01-06",
  archetype: "city",
  dayStart: "08:30",
  dayEnd: "21:00",
  places,
  slots: [
    slot({ id: "s1", place: "landwer", from: "09:00", to: "10:00", kind: "meal", by: "transit" }),
    slot({ id: "s2", place: "rom", from: "10:30", to: "13:00" }),
    slot({ id: "s3", place: "planta", from: "13:00", to: "14:00", kind: "meal" }),
    // Daylight-critical: ends well before the light dies at 16:56.
    slot({ id: "s4", place: "nathan", from: "14:30", to: "15:45", by: "transit" }),
    slot({ id: "s5", place: "path", from: "16:00", to: "18:00" }),
    slot({ id: "s6", place: "khaosan", from: "18:30", to: "20:30", kind: "meal", by: "transit" }),
  ],
};

export const goldenDay3: GoldenDay = {
  key: "day-3-winter",
  title: "Deep winter day (daylight + weather + indoor)",
  day,
  daylight: light,
  windows: deriveSchedulingWindows(
    {
      date: "2027-01-06",
      timezone: "America/Toronto",
      hourly,
      // January is beyond the AQI horizon for this fixture — honest absence,
      // and the derived windows report aqiConsidered: false because of it.
      airQualityHourly: null,
    },
    light,
  ),
  mealPattern: "classic",
  persona: { structure: "scheduler" },
  /**
   * $180, not the document's "~$140". The content is founder-verified;
   * the budget line was the approximation, and the tell was ROM's real
   * 2026 admission — nearer $26 a head, so $52 of the day before anyone
   * eats. Priced honestly the day comes to about $175 for two including
   * the transit day pass. Adjudicated at Session 7 CHECKPOINT 2.
   */
  budgetBand: { min: 0, max: 180, currency: "CAD" },
  lodging: null,
  anchorBaseline: null,
  /**
   * Stated in Session 11 so the leg-exposure rule can actually judge this
   * day: the founder's winter day rides the TTC between neighbourhoods and
   * walks the short hops (three slots carry `by: "transit"` already). With
   * transport unstated the rule could not claim a sheltered alternative
   * existed and would only ever advise — which would have let this
   * fixture pass the new rule without exercising it.
   */
  transport: ["walk", "transit"],
};
