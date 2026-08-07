/**
 * The golden exam (XXX-26), in both directions.
 *
 * Six founder-verified days must validate with zero violations, and every
 * trap fixture must be caught by the rule it was built to trip. A
 * validator that passes everything is worthless; one that rejects the
 * founder's own days is worse.
 */

import { describe, expect, it } from "vitest";
import { validateDay, assertWellFormed } from "@/shared/day-grammar/validate";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { GOLDEN_DAYS } from "@/shared/fixtures/golden";
import { contextFor } from "@/shared/fixtures/golden/support";
import { TRAP_FIXTURES } from "@/shared/fixtures/golden/traps";
import { computeDaylight } from "@/server/weather/ephemeris";

describe("golden days", () => {
  it.each(GOLDEN_DAYS.map((g) => [g.key, g] as const))(
    "%s is well-formed",
    (_key, golden) => {
      expect(() => assertWellFormed(golden.day)).not.toThrow();
    },
  );

  it.each(GOLDEN_DAYS.map((g) => [g.key, g] as const))(
    "%s validates with zero violations",
    (_key, golden) => {
      const found = validateDay(golden.day, contextFor(golden));
      const violations = found.filter((v) => v.severity === "violation");
      expect(
        violations.map((v) => `${v.ruleId}: ${v.message}`),
      ).toEqual([]);
    },
  );

  /**
   * Fixtures hard-code daylight because src/shared may not import
   * src/server. This is the guard that keeps a pasted value honest: every
   * digit is re-derived from the ephemeris and must match exactly.
   */
  it.each(GOLDEN_DAYS.filter((g) => g.daylight !== null).map((g) => [g.key, g] as const))(
    "%s daylight matches the computed ephemeris",
    (_key, golden) => {
      const computed = computeDaylight(golden.day.city, golden.day.date);
      expect(golden.daylight).toMatchObject({
        date: computed.date,
        timezone: computed.timezone,
        civilDawnLocal: computed.civilDawnLocal,
        sunriseLocal: computed.sunriseLocal,
        goldenHourAmEndLocal: computed.goldenHourAmEndLocal,
        goldenHourPmStartLocal: computed.goldenHourPmStartLocal,
        sunsetLocal: computed.sunsetLocal,
        civilDuskLocal: computed.civilDuskLocal,
      });
    },
  );

  it("day 3 is the early-January date the Session 6 correction requires", () => {
    const winter = GOLDEN_DAYS.find((g) => g.key === "day-3-winter");
    // The document said "mid-Jan"; the 16:55-ish sunset lives Jan 5–8.
    expect(winter?.day.date).toBe("2027-01-06");
    expect(winter?.daylight?.sunsetLocal).toBe("16:56");
  });

  it("day 3 derives its windows through Session 6's function, not a copy", () => {
    const winter = GOLDEN_DAYS.find((g) => g.key === "day-3-winter");
    expect(winter?.windows?.paramsVersion).toBe("v1");
    // Cold snap outside the middle of the day, snow window late morning,
    // one clear midday stretch — the winter front-load shape.
    expect(winter?.windows?.outdoorFriendlyWindows).toEqual([
      { startLocal: "12:00", endLocal: "17:00" },
    ]);
    expect(winter?.windows?.aqiConsidered).toBe(false);
  });
});

describe("trap fixtures", () => {
  it.each(TRAP_FIXTURES.map((t) => [t.key, t] as const))(
    "%s is caught",
    (_key, trap) => {
      const ctx = contextFor(
        trap.golden,
        trap.travel ?? new HaversineStubProvider(),
      );
      const found = validateDay(trap.golden.day, ctx);
      const hit = found.find((v) => v.ruleId === trap.expect);
      expect(
        hit,
        `expected ${trap.expect}; got ${found.map((v) => v.ruleId).join(", ") || "nothing"}`,
      ).toBeDefined();
      expect(hit?.message.length ?? 0).toBeGreaterThan(20);
    },
  );

  it("covers all seven founder trap classes", () => {
    const covered = new Set(
      TRAP_FIXTURES.map((t) => t.trapClass).filter(
        (c): c is number => c !== null,
      ),
    );
    expect([...covered].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("every trap's message names the offending subject, not just the rule", () => {
    for (const trap of TRAP_FIXTURES) {
      const ctx = contextFor(
        trap.golden,
        trap.travel ?? new HaversineStubProvider(),
      );
      const hit = validateDay(trap.golden.day, ctx).find(
        (v) => v.ruleId === trap.expect,
      );
      // A regeneration prompt needs something to act on: the place whose
      // fact is wrong, or the number that is out of bounds. Not every rule
      // has a number — travel.uncertifiable names a place with no
      // coordinates, which is exactly the actionable detail.
      const names = Object.values(trap.golden.day.places).map((p) => p.name);
      const namesSomething =
        /\d/.test(hit?.message ?? "") ||
        names.some((n) => hit?.message.includes(n));
      expect(namesSomething, `${trap.key}: ${hit?.message}`).toBe(true);
    }
  });
});
