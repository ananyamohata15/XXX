import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  factDigest,
} from "@/server/feedback/digest";
import {
  mintSessionToken,
  sessionTokenValid,
} from "@/server/tasting/gate";
import { cityDayStart, monthStart } from "@/server/tasting/quota";
import {
  CLAIM_DISPUTES_FACT,
  CLAIM_FLIPS_FACT,
  EVIDENCE_CLAIMS,
  TASTE_SIGNALS,
} from "@/shared/feedback";
import { toTimelineDay, hoursToday } from "@/shared/timeline-mapping";
import { timelineDaySchema } from "@/shared/timeline";
import { GOLDEN_DAYS } from "@/shared/fixtures/golden";

describe("fact digests (decision 001 addendum)", () => {
  it("is stable against key order — it fingerprints the fact, not the JSON", () => {
    const a = { open: "09:00", close: "17:00" };
    const b = { close: "17:00", open: "09:00" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(factDigest(a)).toBe(factDigest(b));
  });

  it("changes when the value changes — the whole point", () => {
    expect(factDigest({ open: "09:00", close: "17:00" })).not.toBe(
      factDigest({ open: "10:00", close: "17:00" }),
    );
  });

  it("stores nothing recoverable: a digest is fixed-width hex", () => {
    expect(factDigest({ secret: "10:00-23:00" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps array order significant", () => {
    expect(factDigest([1, 2])).not.toBe(factDigest([2, 1]));
  });
});

describe("the gate", () => {
  const SECRET = "0".repeat(64);
  const NOW = 1_754_700_000_000;

  it("accepts a token it minted", () => {
    expect(sessionTokenValid(SECRET, mintSessionToken(SECRET, NOW), NOW)).toBe(
      true,
    );
  });

  it("rejects a token minted under a different secret", () => {
    const token = mintSessionToken("a".repeat(64), NOW);
    expect(sessionTokenValid(SECRET, token, NOW)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = mintSessionToken(SECRET, NOW);
    expect(sessionTokenValid(SECRET, token, NOW + 13 * 3600_000)).toBe(false);
  });

  it("rejects a tampered expiry — the HMAC covers it", () => {
    const token = mintSessionToken(SECRET, NOW);
    const [, signature] = token.split(".");
    const forged = `${Buffer.from(String(NOW + 10 ** 12), "utf8").toString("base64url")}.${signature}`;
    expect(sessionTokenValid(SECRET, forged, NOW)).toBe(false);
  });

  it("rejects malformed tokens rather than throwing", () => {
    for (const bad of ["", ".", "abc", "abc.def", "!!.??"]) {
      expect(sessionTokenValid(SECRET, bad, NOW)).toBe(false);
    }
  });
});

describe("the self-cap window", () => {
  it("resets at Toronto midnight, not UTC midnight", () => {
    // 03:00 UTC on the 9th is 23:00 on the 8th in Toronto (EDT): the
    // day being counted is still the 8th.
    expect(cityDayStart("2026-08-09T03:00:00.000Z", "toronto")).toBe(
      "2026-08-08T04:00:00.000Z",
    );
    expect(cityDayStart("2026-08-09T13:00:00.000Z", "toronto")).toBe(
      "2026-08-09T04:00:00.000Z",
    );
  });

  it("gauges Details events against the UTC calendar month", () => {
    expect(monthStart("2026-08-09T13:00:00.000Z")).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
});

describe("evidence and taste vocabularies", () => {
  it("share no member — contamination is unspellable", () => {
    const overlap = EVIDENCE_CLAIMS.filter((c) =>
      (TASTE_SIGNALS as readonly string[]).includes(c),
    );
    expect(overlap).toEqual([]);
  });

  it("names a disputed fact for every claim except not_as_described", () => {
    for (const claim of EVIDENCE_CLAIMS) {
      const disputed = CLAIM_DISPUTES_FACT[claim];
      expect(disputed === null).toBe(claim === "not_as_described");
    }
  });

  it("writes a founder key distinct from the key it disputes, for hours", () => {
    expect(CLAIM_DISPUTES_FACT.hours_wrong).toBe("hours");
    expect(CLAIM_FLIPS_FACT.hours_wrong).toBe("hours_corrections");
    expect(CLAIM_FLIPS_FACT.not_as_described).toBeNull();
  });
});

describe("GrammarDay → TimelineDay", () => {
  const day = GOLDEN_DAYS[0].day;
  const mapped = toTimelineDay({
    day,
    legs: [],
    reasons: new Map(
      day.slots
        .filter((s) => s.origin === "concierge")
        .map((s) => [s.id, `because of ${s.placeId}`]),
    ),
    reasonSource: "test",
    generatedAt: "2026-08-09T12:00:00.000Z",
  });

  it("produces a day the timeline components accept", () => {
    expect(timelineDaySchema.safeParse(mapped).success).toBe(true);
  });

  it("carries every slot and place across", () => {
    expect(mapped.slots).toHaveLength(day.slots.length);
    expect(Object.keys(mapped.places).sort()).toEqual(
      Object.keys(day.places).sort(),
    );
  });

  it("renders hours for the day being shown, keeping provenance", () => {
    const slot = day.slots.find(
      (s) => day.places[s.placeId]?.hours?.status === "present",
    );
    if (slot === undefined) throw new Error("fixture has no hours to map");
    const source = day.places[slot.placeId].hours;
    const view = mapped.places[slot.placeId].hoursToday;
    expect(view.status).toBe("present");
    if (view.status !== "present" || source?.status !== "present") {
      throw new Error("unreachable");
    }
    expect(view.source).toBe(source.source);
    expect(view.tier).toBe(source.tier);
  });

  it("says 'not recorded' for a fact nothing ever fetched", () => {
    // The engine fetches no vibe at all: the third arm exists so the card
    // does not claim we looked.
    for (const place of Object.values(mapped.places)) {
      expect(place.vibe.status).toBe("unknown");
    }
  });

  it("leaves an unnarrated concierge slot honestly reasonless", () => {
    const bare = toTimelineDay({
      day,
      legs: [],
      reasons: new Map(),
      reasonSource: "test",
      generatedAt: "2026-08-09T12:00:00.000Z",
    });
    expect(bare.slots.every((s) => s.reason === null)).toBe(true);
    expect(timelineDaySchema.safeParse(bare).success).toBe(true);
  });

  it("maps hours absence and never-fetched to different states", () => {
    const absent = hoursToday(
      { status: "absent", source: "google_places", tier: 1, fetchedAt: "x" },
      "2026-08-15",
    );
    expect(absent.status).toBe("absent");
    expect(hoursToday(undefined, "2026-08-15").status).toBe("unknown");
  });

  it("names every travel provider that contributed, at the worst tier", () => {
    const withLegs = toTimelineDay({
      day,
      legs: [
        {
          fromPlaceId: "a",
          toPlaceId: "b",
          minutes: 10,
          mode: "walk",
          source: "ors",
          tier: 1,
        },
        {
          fromPlaceId: "b",
          toPlaceId: "c",
          minutes: 20,
          mode: "transit",
          source: "haversine_stub",
          tier: 3,
        },
      ],
      reasons: new Map(),
      reasonSource: "test",
      generatedAt: "2026-08-09T12:00:00.000Z",
    });
    expect(withLegs.travelProvenance.source).toBe("haversine_stub + ors");
    expect(withLegs.travelProvenance.tier).toBe(3);
  });
});
