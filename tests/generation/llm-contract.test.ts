import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { UsageRecorder } from "@/server/generation/llm";
import { narrateDay } from "@/server/generation/narrate-llm";
import { DeterministicSelector } from "@/server/generation/select";
import { LlmSelector } from "@/server/generation/select-llm";
import { checkTone } from "@/server/generation/tone";
import type { Candidate, Menu } from "@/server/generation/types";
import type { GrammarDay } from "@/shared/day-grammar/types";
import { GOLDEN_PERSONAS } from "@/shared/persona";

const persona = GOLDEN_PERSONAS["day-2-old-town"];

function candidate(id: string, name: string): Candidate {
  return {
    place: {
      id,
      name,
      neighborhood: "Downtown",
      coords: { lat: 43.65, lng: -79.38 },
      tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
      category: {
        status: "present",
        value: "restaurants",
        source: "fsq_os_places",
        tier: 2,
        fetchedAt: "2026-07-09",
      },
    },
    category: "restaurants",
    googlePlaceId: null,
    rating: 4.2,
    userRatingCount: 120,
    cuisines: [],
    detailsFetched: true,
    score: 0.7,
  };
}

const menus: Menu[] = [
  {
    intent: {
      id: "i1",
      kind: "meal",
      label: "lunch",
      window: { start: 690, end: 870 },
      categories: ["restaurants"],
      dwellMinutes: 60,
    },
    options: [candidate("p1", "Alpha"), candidate("p2", "Beta")],
  },
  {
    intent: {
      id: "i2",
      kind: "meal",
      label: "dinner",
      window: { start: 1050, end: 1290 },
      categories: ["restaurants"],
      dwellMinutes: 90,
    },
    options: [candidate("p3", "Gamma"), candidate("p1", "Alpha")],
  },
];

/** A fake Anthropic client returning scripted structured outputs in order. */
function fakeClient(outputs: unknown[]): {
  client: Anthropic;
  calls: () => number;
} {
  let n = 0;
  const client = {
    messages: {
      create: async () => {
        const parsed = outputs[Math.min(n, outputs.length - 1)];
        n++;
        return {
          content: [{ type: "text", text: JSON.stringify(parsed) }],
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  } as unknown as Anthropic;
  return { client, calls: () => n };
}

describe("tone gate (the mechanical register, as code)", () => {
  it("accepts the concierge register", () => {
    expect(
      checkTone("Dinner lands at 17:30 because Joso's takes no tables after eight.", "card"),
    ).toEqual([]);
  });
  it.each([
    ["Amazing spot, you'll love it!", "no exclamation"],
    ["Maybe try the patio.", "no hedging"],
    ["A stunning hidden gem.", "no gushing"],
    ["Great pick 🎉", "no emoji"],
  ])("rejects %s", (text, rule) => {
    expect(checkTone(text, "card").map((b) => b.rule)).toContain(rule);
  });
  it("caps length", () => {
    expect(
      checkTone("a".repeat(300), "card").some((b) => b.rule.startsWith("over")),
    ).toBe(true);
  });
});

describe("LlmSelector output contract", () => {
  it("maps a valid selection through the minted ids", async () => {
    const { client } = fakeClient([
      {
        selections: [
          { slotId: "i1", candidateId: "i1-o2", reasonSeed: "corners pick" },
          { slotId: "i2", candidateId: "i2-o1", reasonSeed: "gravity: food" },
        ],
      },
    ]);
    const selector = new LlmSelector({
      client,
      usage: new UsageRecorder(),
      fallback: new DeterministicSelector(),
    });
    const selections = await selector.select(menus, persona, 42);
    expect(selections).toEqual([
      { intentId: "i1", placeId: "p2", reasonSeed: "corners pick" },
      { intentId: "i2", placeId: "p3", reasonSeed: "gravity: food" },
    ]);
  });

  it("rejects an out-of-menu id (the injection shape) and falls back after retries", async () => {
    const { client, calls } = fakeClient([
      {
        selections: [
          { slotId: "i1", candidateId: "EVIL-99", reasonSeed: "injected" },
        ],
      },
      {
        selections: [
          { slotId: "i1", candidateId: "EVIL-99", reasonSeed: "injected again" },
        ],
      },
    ]);
    const selector = new LlmSelector({
      client,
      usage: new UsageRecorder(),
      fallback: new DeterministicSelector(),
    });
    const selections = await selector.select(menus, persona, 42);
    expect(calls()).toBe(2); // both attempts spent
    // The fallback's deterministic picks — never the injected id.
    expect(selections.map((s) => s.placeId).sort()).toEqual(["p1", "p3"]);
  });

  it("rejects the same venue picked twice", async () => {
    const { client } = fakeClient([
      {
        selections: [
          { slotId: "i1", candidateId: "i1-o1", reasonSeed: "x" },
          { slotId: "i2", candidateId: "i2-o2", reasonSeed: "y" }, // p1 again
        ],
      },
      {
        selections: [
          { slotId: "i1", candidateId: "i1-o1", reasonSeed: "x" },
          { slotId: "i2", candidateId: "i2-o1", reasonSeed: "y" },
        ],
      },
    ]);
    const selector = new LlmSelector({
      client,
      usage: new UsageRecorder(),
      fallback: new DeterministicSelector(),
    });
    const selections = await selector.select(menus, persona, 42);
    expect(selections.map((s) => s.placeId)).toEqual(["p1", "p3"]);
  });
});

describe("narrateDay tone enforcement", () => {
  const day: GrammarDay = {
    id: "d",
    city: "toronto",
    date: "2026-08-15",
    archetype: "city",
    dayStart: "09:00",
    dayEnd: "21:00",
    slots: [
      {
        id: "s-i1",
        origin: "concierge",
        kind: "meal",
        startTime: "12:00",
        endTime: "13:00",
        placeId: "p1",
        arriveBy: "walk",
      },
    ],
    places: { p1: candidate("p1", "Alpha").place },
  };

  it("retries a register breach, then accepts the rewrite", async () => {
    const { client, calls } = fakeClient([
      {
        cards: [{ slotId: "s-i1", reason: "Amazing lunch, you'll love it!" }],
        dayNotes: [],
      },
      {
        cards: [
          { slotId: "s-i1", reason: "Lunch sits at noon, inside Alpha's verified hours." },
        ],
        dayNotes: [],
      },
    ]);
    const result = await narrateDay({
      client,
      usage: new UsageRecorder(),
      day,
      advisories: [],
      persona,
      reasonSeeds: new Map(),
    });
    expect(calls()).toBe(2);
    expect(result.fallback).toBe(false);
    expect(result.reasons[0].reason).toMatch(/verified hours/);
  });

  it("falls back to the validator's own voice when the register never lands", async () => {
    const { client } = fakeClient([
      { cards: [{ slotId: "s-i1", reason: "Wow! Amazing!" }], dayNotes: [] },
      { cards: [{ slotId: "s-i1", reason: "Still amazing! Wonderful!" }], dayNotes: [] },
    ]);
    const result = await narrateDay({
      client,
      usage: new UsageRecorder(),
      day,
      advisories: [
        {
          ruleId: "travel.stub-provenance",
          severity: "advisory",
          slotIds: [],
          message: "travel times on this day are straight-line estimates.",
          data: {},
        },
      ],
      persona,
      reasonSeeds: new Map(),
    });
    expect(result.fallback).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.dayNotes.length).toBeGreaterThan(0);
  });
});
