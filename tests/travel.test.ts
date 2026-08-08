/**
 * Tier-1 fixture tests for the XXX-24 travel capability's pure parts:
 * the chain provider's fall-through + first-answer-wins semantics, the
 * doc-003 ceiling math (no override path exists to test), and the
 * founder-shadows-engine precedence in matrix-record building.
 */

import { describe, expect, it } from "vitest";
import {
  ChainTravelProvider,
  HaversineStubProvider,
  MatrixTravelProvider,
} from "@/shared/day-grammar/travel";
import type { TravelQuery } from "@/shared/day-grammar/types";
import { validateDay } from "@/shared/day-grammar/validate";
import { goldenDay6 } from "@/shared/fixtures/golden/day-6-excursion";
import { contextFor } from "@/shared/fixtures/golden/support";
import {
  PAIR_CEILING,
  buildMatrixRecord,
  ceilingBreach,
  type TravelTimeRow,
  type TravelTimeUpsert,
} from "@/server/travel/store";
import { TIERS } from "@/shared/vocabulary";

const A = { lat: 43.6545, lng: -79.4008 };
const B = { lat: 43.6479, lng: -79.399 };
const C = { lat: 43.6387, lng: -79.3816 };

const query = (mode: TravelQuery["mode"] = "walk"): TravelQuery => ({
  origin: A,
  destination: B,
  mode,
  departureLocal: "14:00",
});

describe("ChainTravelProvider", () => {
  const matrixHit = new MatrixTravelProvider({
    [MatrixTravelProvider.key({ origin: A, destination: B, mode: "walk" })]: {
      minutes: 12,
      provenance: { source: "founder_measured", tier: TIERS.verified },
    },
  });

  it("first non-null answer wins, provenance intact", () => {
    const chain = new ChainTravelProvider([
      matrixHit,
      new HaversineStubProvider(),
    ]);
    const estimate = chain.estimate(query());
    expect(estimate).toEqual({
      minutes: 12,
      provenance: { source: "founder_measured", tier: TIERS.verified },
    });
  });

  it("falls through to the stub with honest tier-3 provenance", () => {
    const chain = new ChainTravelProvider([
      matrixHit, // has no cycle entry for this pair
      new HaversineStubProvider(),
    ]);
    const estimate = chain.estimate(query("cycle"));
    expect(estimate?.provenance).toEqual({
      source: HaversineStubProvider.SOURCE,
      tier: TIERS.judgment,
    });
  });

  it("an empty chain answers null — honest absence, never zero", () => {
    expect(new ChainTravelProvider([]).estimate(query())).toBeNull();
  });
});

const upsert = (
  city: string,
  lat: number,
  overrides: Partial<TravelTimeUpsert> = {},
): TravelTimeUpsert => ({
  city,
  originLabel: "o",
  origin: { lat, lng: 0 },
  destLabel: "d",
  dest: { lat, lng: 1 },
  mode: "walk",
  durationMinutes: 10,
  distanceKm: null,
  source: "ors_hosted",
  tier: TIERS.observed,
  license: "CC-BY-SA-4.0",
  fetchedAt: "2026-08-07T12:00:00Z",
  traceId: null,
  ...overrides,
});

describe("ceilingBreach (doc 003: 1,000 pairs/city, no override)", () => {
  const fullCity = new Set(
    Array.from({ length: PAIR_CEILING }, (_, i) => `toronto|${i},0|${i},1`),
  );

  it("refuses the pair that would exceed the ceiling", () => {
    expect(ceilingBreach(fullCity, [upsert("toronto", 0.5)])).toBe("toronto");
  });

  it("allows a refresh/new-mode row for an already-stored pair", () => {
    // Pair 7,0 → 7,1 exists; a cycle row for it adds no new pair.
    expect(
      ceilingBreach(fullCity, [upsert("toronto", 7, { mode: "cycle" })]),
    ).toBeNull();
  });

  it("counts cities independently", () => {
    expect(ceilingBreach(fullCity, [upsert("london", 0.5)])).toBeNull();
  });
});

describe("buildMatrixRecord", () => {
  const row = (
    tier: (typeof TIERS)[keyof typeof TIERS],
    source: string,
    minutes: number,
    mode: TravelTimeRow["mode"] = "walk",
  ): TravelTimeRow => ({
    originLabel: "o",
    origin: A,
    destLabel: "d",
    dest: B,
    mode,
    durationMinutes: minutes,
    source,
    tier,
    license: null,
    fetchedAt: "2026-08-07T12:00:00Z",
  });

  it("founder (tier 1) shadows ORS (tier 2) on the same pair+mode", () => {
    for (const order of [
      [row(TIERS.observed, "ors_hosted", 18), row(TIERS.verified, "founder_measured", 12)],
      [row(TIERS.verified, "founder_measured", 12), row(TIERS.observed, "ors_hosted", 18)],
    ]) {
      const record = buildMatrixRecord(order);
      const key = MatrixTravelProvider.key({
        origin: A,
        destination: B,
        mode: "walk",
      });
      expect(record[key]).toEqual({
        minutes: 12,
        provenance: { source: "founder_measured", tier: TIERS.verified },
      });
    }
  });

  it("pins the Beamsville→NOL doctrine ruling: engine row governs, v2.1 timing infeasible", () => {
    // CHECKPOINT 3 (2026-08-08): the founder's recalled 30-min drive was
    // disproven by live verification (39–44 min); golden-set v2.2 retimed
    // NOL arrival 11:15 → 11:30. Against the engine's 44-min row, the old
    // timing must trip travel.infeasible and the retimed day must not.
    const beamsville = { lat: 43.165, lng: -79.475 };
    const nol = { lat: 43.2557, lng: -79.0715 };
    const engineRow = new MatrixTravelProvider({
      [MatrixTravelProvider.key({ origin: beamsville, destination: nol, mode: "drive" })]: {
        minutes: 44,
        provenance: { source: "ors_hosted", tier: TIERS.observed },
      },
    });
    const provider = new ChainTravelProvider([
      engineRow,
      new HaversineStubProvider(),
    ]);

    const retimed = validateDay(goldenDay6.day, contextFor(goldenDay6, provider));
    expect(
      retimed.filter((v) => v.ruleId === "travel.infeasible"),
    ).toEqual([]);

    const v21Day = {
      ...goldenDay6.day,
      slots: goldenDay6.day.slots.map((s) =>
        s.id === "s2" ? { ...s, startTime: "11:15" } : s,
      ),
    };
    const v21 = validateDay(v21Day, contextFor(goldenDay6, provider));
    expect(v21.some((v) => v.ruleId === "travel.infeasible")).toBe(true);
  });

  it("keeps modes distinct — a drive row never answers a walk query", () => {
    const record = buildMatrixRecord([
      row(TIERS.observed, "ors_hosted", 8, "drive"),
    ]);
    const walkKey = MatrixTravelProvider.key({
      origin: A,
      destination: B,
      mode: "walk",
    });
    expect(record[walkKey]).toBeUndefined();
    expect(
      new MatrixTravelProvider(record).estimate({
        origin: A,
        destination: C,
        mode: "drive",
        departureLocal: "09:00",
      }),
    ).toBeNull(); // different destination — directional, coordinate-exact
  });
});
