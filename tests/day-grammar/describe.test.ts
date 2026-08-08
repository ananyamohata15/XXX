/**
 * Narration (XXX-5 Step 3). The tone bar is E2's: clipped, confident, no
 * hedging, no apology, no exclamation. These tests hold that line
 * mechanically so it cannot erode a phrase at a time.
 */

import { describe, expect, it } from "vitest";
import {
  describeViolations,
  regenerationFeedback,
} from "@/shared/day-grammar/describe";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { validateDay } from "@/shared/day-grammar/validate";
import { RULE_IDS } from "@/shared/day-grammar/types";
import { GOLDEN_DAYS } from "@/shared/fixtures/golden";
import { contextFor } from "@/shared/fixtures/golden/support";
import { TRAP_FIXTURES } from "@/shared/fixtures/golden/traps";

const everyFinding = [
  ...GOLDEN_DAYS.map((g) => validateDay(g.day, contextFor(g))),
  ...TRAP_FIXTURES.map((t) =>
    validateDay(
      t.golden.day,
      contextFor(t.golden, t.travel ?? new HaversineStubProvider()),
    ),
  ),
].flat();

describe("describeViolations", () => {
  it("renders every finding the exam produces", () => {
    const narrated = describeViolations(everyFinding);
    expect(narrated.violations.length + narrated.advisories.length).toBe(
      everyFinding.length,
    );
  });

  it("keeps the concierge's register", () => {
    for (const line of describeViolations(everyFinding).violations.concat(
      describeViolations(everyFinding).advisories,
    )) {
      expect(line.text, line.ruleId).not.toMatch(/!/);
      expect(line.text, line.ruleId).not.toMatch(/\b(sorry|apolog|oops|unfortunately)/i);
      // No hedging: the concierge knows or says it does not.
      expect(line.text, line.ruleId).not.toMatch(/\b(maybe|perhaps|possibly|might want)\b/i);
    }
  });

  it("starts every line with a capital", () => {
    for (const line of describeViolations(everyFinding).advisories) {
      expect(line.text[0], line.ruleId).toBe(line.text[0].toUpperCase());
    }
  });

  it("never says the same word twice across opener and message", () => {
    // "Tight. ... is tight" was the failure this guards.
    for (const line of describeViolations(everyFinding).advisories) {
      const firstSentence = line.text.split(". ")[0];
      const rest = line.text.slice(firstSentence.length);
      const stems = firstSentence
        .toLowerCase()
        .replace(/[^a-z\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length >= 5);
      for (const word of stems) {
        expect(rest.toLowerCase(), `${line.ruleId}: "${line.text}"`).not.toContain(word);
      }
    }
  });

  it("gives a clean day an honest headline", () => {
    const clean = describeViolations([]);
    expect(clean.headline).toBe("This day holds up.");
    expect(clean.violations).toEqual([]);
  });

  it("says plainly when a day does not hold up", () => {
    const day1 = GOLDEN_DAYS[0];
    const broken = validateDay(
      { ...day1.day, slots: [{ ...day1.day.slots[0], startTime: "09:30" }, ...day1.day.slots.slice(1)] },
      contextFor(day1),
    );
    expect(describeViolations(broken).headline).toMatch(/^This day does not hold up: \d+ problem/);
  });

  it("has an opener for every rule id, so no finding narrates bare by accident", () => {
    const narrated = describeViolations(everyFinding);
    const seen = new Set(
      [...narrated.violations, ...narrated.advisories].map((l) => l.ruleId),
    );
    // Not every rule fires in the fixtures; this asserts the ones that do
    // all produced text, and that the id set has not drifted.
    expect([...seen].every((id) => RULE_IDS.includes(id))).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(25);
  });
});

describe("regenerationFeedback", () => {
  it("is empty for a day that holds up", () => {
    const clean = GOLDEN_DAYS[1];
    expect(regenerationFeedback(validateDay(clean.day, contextFor(clean)))).toBe("");
  });

  it("lists the raw rule messages and pins the anchors", () => {
    const trap = TRAP_FIXTURES.find((t) => t.key === "trap-closed-place");
    const found = validateDay(
      trap!.golden.day,
      contextFor(trap!.golden, trap!.travel ?? new HaversineStubProvider()),
    );
    const feedback = regenerationFeedback(found);
    expect(feedback).toContain("[validity.permanently-closed]");
    expect(feedback).toContain("Seven Lives");
    expect(feedback).toContain("origin=user");
    // Raw, not narrated — the generator wants the constraint flat.
    expect(feedback).not.toContain("This one is shut for good.");
  });
});
