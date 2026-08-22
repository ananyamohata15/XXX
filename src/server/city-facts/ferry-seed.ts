/**
 * The Toronto Islands ferry timetable — golden Day 7's tier-1 city fact
 * (XXX-38, Session 14 CP0 ruling 3).
 *
 * PROVENANCE, in full, because constraint 2 admits no exception for seed
 * data:
 *
 *   source     founder_groundtruth
 *   tier       1 (Verified)
 *   fetchedAt  2026-08-15
 *   channel    fetched from toronto.ca by the founder and red-penned in
 *              person — the unconditional tier-1 operator channel (comment
 *              10289). It is the ONLY fact channel this session opens.
 *
 * XXX-39's automated civic KB is deliberately NOT the source here: its
 * licensing addendum is pending in the PO chat, and an automated fetch would
 * enter at a different source and tier. When it lands it writes rows beside
 * this one; nothing about the shape changes.
 *
 * SEASON. The summer schedule runs 2026-05-13 to 2026-09-15, verified on the
 * same page. Hanlan's Point itself runs mid-April to mid-October, and outside
 * that window the route is ABSENT rather than reduced — golden Day 7's trap
 * list is explicit that winter is "Ward's route ONLY", which makes the
 * islands experience infeasible rather than merely different. Absence is
 * represented by the row not covering the date, so `readFerryTimetable`
 * returns null and the theme fails honestly.
 *
 * The departure lists are the verified ones, not a generated cadence. The
 * document records city departures "11:15/11:45/12:15..." and Hanlan's
 * departures "21:30 / 22:00 / 22:30 / 23:00 — last boat 11pm"; the last boat
 * is the number the whole day is planned backwards from, so it is transcribed
 * rather than extrapolated. Where the founder's note trails off ("...") the
 * cadence is CONTINUED at the verified 30-minute interval and that
 * continuation is stated here rather than presented as separately verified.
 */

import type { FerryTimetable } from "@/shared/city-facts";
import type { NewCityFact } from "./repo";

export const FERRY_HANLANS_ROUTE_KEY = "ferry:hanlans";

/** Verified departures, plus the stated 30-minute continuation. */
const HANLANS_TIMETABLE: FerryTimetable = {
  routeKey: FERRY_HANLANS_ROUTE_KEY,
  label: "Jack Layton Ferry Terminal ⇄ Hanlan's Point",
  // "~15-min crossing" (founder-verified).
  crossingMinutes: 15,
  outbound: [
    // Verified explicitly in the golden-set document.
    "11:15",
    "11:45",
    "12:15",
    // Continuation at the verified 30-minute cadence. Stated as a
    // continuation, not claimed as separately red-penned.
    "12:45",
    "13:15",
    "13:45",
    "14:15",
    "14:45",
    "15:15",
    "15:45",
    "16:15",
    "16:45",
    "17:15",
    "17:45",
    "18:15",
    "18:45",
    "19:15",
    "19:45",
  ],
  inbound: [
    // The four the founder wrote down, ending on the last boat.
    "21:30",
    "22:00",
    "22:30",
    "23:00",
  ],
};

export const FERRY_HANLANS_SUMMER_2026: NewCityFact<FerryTimetable> = {
  city: "toronto",
  factKind: "ferry_timetable",
  subjectKey: FERRY_HANLANS_ROUTE_KEY,
  value: HANLANS_TIMETABLE,
  source: "founder_groundtruth",
  tier: 1,
  fetchedAt: "2026-08-15T00:00:00.000Z",
  validFrom: "2026-05-13",
  validTo: "2026-09-15",
};
