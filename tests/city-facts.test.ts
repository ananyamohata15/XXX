/**
 * City-scoped facts (XXX-38/40, Session 14 CP0 ruling 3).
 *
 * The seasonal arm is the load-bearing one: golden Day 7's own trap list says
 * winter is "Ward's route ONLY", so a date outside the season must produce
 * ABSENCE — which makes the experience theme infeasible — rather than a
 * timetable that quietly still works.
 */

import { describe, expect, it } from "vitest";
import {
  lastDeparture,
  lastDepartureBy,
  nextDeparture,
  seasonCovers,
} from "@/shared/city-facts";
import { FERRY_HANLANS_SUMMER_2026 } from "@/server/city-facts/ferry-seed";
import { ferryTimetableSchema } from "@/server/city-facts/repo";

describe("the ferry seed is a well-formed tier-1 founder fact", () => {
  it("parses at the boundary it will be read through", () => {
    expect(() =>
      ferryTimetableSchema.parse(FERRY_HANLANS_SUMMER_2026.value),
    ).not.toThrow();
  });

  it("carries full provenance — no exception for seed data", () => {
    expect(FERRY_HANLANS_SUMMER_2026.source).toBe("founder_groundtruth");
    expect(FERRY_HANLANS_SUMMER_2026.tier).toBe(1);
    expect(FERRY_HANLANS_SUMMER_2026.fetchedAt).not.toBe("");
  });

  it("keeps the founder's verified numbers verbatim", () => {
    const t = FERRY_HANLANS_SUMMER_2026.value;
    // The three city departures written down in the golden set.
    expect(t.outbound.slice(0, 3)).toEqual(["11:15", "11:45", "12:15"]);
    // The island departures, ending on the last boat — the number the day is
    // planned backwards from.
    expect(t.inbound).toEqual(["21:30", "22:00", "22:30", "23:00"]);
    expect(t.crossingMinutes).toBe(15);
  });
});

describe("the season decides whether the day is possible at all", () => {
  const season = {
    validFrom: FERRY_HANLANS_SUMMER_2026.validFrom,
    validTo: FERRY_HANLANS_SUMMER_2026.validTo,
  };

  it("covers golden Day 7's own mid-July Saturday", () => {
    expect(seasonCovers(season, "2026-07-18")).toBe(true);
  });

  it("does NOT cover a winter date — the theme is infeasible, not reduced", () => {
    expect(seasonCovers(season, "2026-01-17")).toBe(false);
    expect(seasonCovers(season, "2026-11-20")).toBe(false);
  });

  it("is inclusive at both ends", () => {
    expect(seasonCovers(season, "2026-05-13")).toBe(true);
    expect(seasonCovers(season, "2026-09-15")).toBe(true);
    expect(seasonCovers(season, "2026-05-12")).toBe(false);
    expect(seasonCovers(season, "2026-09-16")).toBe(false);
  });

  it("a fact with no season is valid always", () => {
    expect(seasonCovers({ validFrom: null, validTo: null }, "2026-01-01")).toBe(
      true,
    );
  });
});

describe("schedule reading is honest about the last boat", () => {
  const t = FERRY_HANLANS_SUMMER_2026.value;

  it("finds the crossing golden Day 7 actually takes", () => {
    // The day provisions until ~10:50 and walks ~20-25 min to the terminal.
    expect(nextDeparture(t.outbound, "11:30")).toBe("11:45");
  });

  it("returns null rather than inventing a boat that does not exist", () => {
    // Honest absence, and it matters more here than almost anywhere: a
    // guessed later sailing strands someone on an island.
    expect(nextDeparture(t.outbound, "23:30")).toBeNull();
    expect(lastDepartureBy(t.inbound, "20:00")).toBeNull();
  });

  it("names the last boat, which is what the day is planned around", () => {
    expect(lastDeparture(t.inbound)).toBe("23:00");
    // Sunset ~20:45 in golden Day 7; the 21:30 is the comfortable one.
    expect(nextDeparture(t.inbound, "21:00")).toBe("21:30");
  });
});
