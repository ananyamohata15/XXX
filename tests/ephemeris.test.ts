import { describe, expect, it } from "vitest";
import { computeDaylight } from "@/server/weather/ephemeris";

/**
 * Known-answer tests: astronomy-engine output for Toronto (43.6532 N,
 * 79.3832 W — CITY_GEO reference point) against an independent published
 * source. References fetched live 2026-08-07 from api.sunrise-sunset.org
 * (NOAA solar algorithm), UTC, for the 2026 solstices/equinoxes plus the
 * golden-set winter checks. Tolerance ±2 min per the session brief.
 */

const TOLERANCE_MS = 2 * 60 * 1000;

const KNOWN_ANSWERS = [
  { date: "2026-03-20", riseUtc: "2026-03-20T11:18:39Z", setUtc: "2026-03-20T23:31:10Z", label: "March equinox" },
  { date: "2026-06-21", riseUtc: "2026-06-21T09:34:23Z", setUtc: "2026-06-22T01:04:25Z", label: "June solstice" },
  { date: "2026-09-23", riseUtc: "2026-09-23T11:04:48Z", setUtc: "2026-09-23T23:14:49Z", label: "September equinox" },
  { date: "2026-12-21", riseUtc: "2026-12-21T12:46:10Z", setUtc: "2026-12-21T21:45:14Z", label: "December solstice" },
  { date: "2027-01-07", riseUtc: "2027-01-07T12:48:57Z", setUtc: "2027-01-07T21:58:37Z", label: "early-January (16:55-ish sunset)" },
  { date: "2027-01-15", riseUtc: "2027-01-15T12:46:11Z", setUtc: "2027-01-15T22:07:39Z", label: "mid-January" },
] as const;

describe("ephemeris known-answer tests (Toronto, ±2 min vs published values)", () => {
  for (const known of KNOWN_ANSWERS) {
    it(`${known.label} ${known.date}`, () => {
      const daylight = computeDaylight("toronto", known.date);
      const riseDelta = Math.abs(
        new Date(daylight.sunriseUtc).getTime() - new Date(known.riseUtc).getTime(),
      );
      const setDelta = Math.abs(
        new Date(daylight.sunsetUtc).getTime() - new Date(known.setUtc).getTime(),
      );
      expect(riseDelta, `sunrise off by ${Math.round(riseDelta / 1000)}s`).toBeLessThanOrEqual(TOLERANCE_MS);
      expect(setDelta, `sunset off by ${Math.round(setDelta / 1000)}s`).toBeLessThanOrEqual(TOLERANCE_MS);
    });
  }

  it("renders the winter-day local times the grammar will schedule against", () => {
    // Local renders of the engine's own output (validated ±2 min against
    // the reference above; the engine agrees with timeanddate's published
    // 4:43 PM for the solstice — sunrise-sunset.org runs ~2 min late).
    expect(computeDaylight("toronto", "2026-12-21").sunsetLocal).toBe("16:43");
    // Early January: 16:57 — the "16:55-ish" golden-set winter sunset.
    // (Mid-January is already 17:06; the 16:55 crossing is ~Jan 6–7.
    // Recorded honestly in SESSION_NOTES.)
    expect(computeDaylight("toronto", "2027-01-07").sunsetLocal).toBe("16:57");
    expect(computeDaylight("toronto", "2027-01-15").sunsetLocal).toBe("17:06");
  });

  it("orders the daylight boundaries correctly and stamps provenance", () => {
    const d = computeDaylight("toronto", "2026-08-15");
    expect(d.civilDawnLocal < d.sunriseLocal).toBe(true);
    expect(d.sunriseLocal < d.goldenHourAmEndLocal).toBe(true);
    expect(d.goldenHourAmEndLocal < d.goldenHourPmStartLocal).toBe(true);
    expect(d.goldenHourPmStartLocal < d.sunsetLocal).toBe(true);
    expect(d.sunsetLocal < d.civilDuskLocal).toBe(true);
    expect(d.provenance).toMatchObject({
      source: "ephemeris:astronomy-engine",
      tier: 1,
    });
    expect(new Date(d.provenance.computedAt).getTime()).not.toBeNaN();
  });

  it("is deterministic — recomputation agrees with itself exactly", () => {
    const a = computeDaylight("toronto", "2026-12-21");
    const b = computeDaylight("toronto", "2026-12-21");
    expect(a.sunriseUtc).toBe(b.sunriseUtc);
    expect(a.sunsetUtc).toBe(b.sunsetUtc);
  });
});
