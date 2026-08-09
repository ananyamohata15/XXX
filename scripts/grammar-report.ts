/**
 * grammar-report — validate a day and print the report (XXX-5 / XXX-26).
 *
 * The reviewer's tool for poking at days by hand. READ-ONLY and offline:
 * it imports fixture modules or reads one JSON file, runs the pure
 * validator, and prints. No network, no database, no writes, no cost.
 *
 * Usage:
 *   npx tsx scripts/grammar-report.ts                    all golden days
 *   npx tsx scripts/grammar-report.ts day-1-jays         one golden day
 *   npx tsx scripts/grammar-report.ts traps              all trap fixtures
 *   npx tsx scripts/grammar-report.ts trap-closed-place  one trap
 *   npx tsx scripts/grammar-report.ts path/to/day.json   an ad-hoc day
 *   ... --verbose                                        include data payloads
 *
 * The JSON form expects { day, daylight?, windows?, mealPattern?, persona?,
 * budgetBand?, lodging?, anchorBaseline? } — the same shape the fixtures
 * build, so a fixture can be dumped, edited, and fed back in.
 */

import { readFileSync } from "node:fs";
import { describeViolations, regenerationFeedback } from "../src/shared/day-grammar/describe";
import { HaversineStubProvider } from "../src/shared/day-grammar/travel";
import { assertWellFormed, validateDay } from "../src/shared/day-grammar/validate";
import type { TravelTimeProvider } from "../src/shared/day-grammar/types";
import { GOLDEN_DAYS } from "../src/shared/fixtures/golden";
import { contextFor, type GoldenDay } from "../src/shared/fixtures/golden/support";
import { TRAP_FIXTURES } from "../src/shared/fixtures/golden/traps";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const targets = args.filter((a) => !a.startsWith("--"));

interface Subject {
  label: string;
  golden: GoldenDay;
  travel?: TravelTimeProvider;
  expect?: string;
}

function resolve(target: string | undefined): Subject[] {
  if (target === undefined || target === "golden") {
    return GOLDEN_DAYS.map((g) => ({ label: g.title, golden: g }));
  }
  if (target === "traps") {
    return TRAP_FIXTURES.map((t) => ({
      label: t.title,
      golden: t.golden,
      travel: t.travel,
      expect: t.expect,
    }));
  }
  const golden = GOLDEN_DAYS.find((g) => g.key === target);
  if (golden) return [{ label: golden.title, golden }];

  const trap = TRAP_FIXTURES.find((t) => t.key === target);
  if (trap) {
    return [
      { label: trap.title, golden: trap.golden, travel: trap.travel, expect: trap.expect },
    ];
  }

  if (target.endsWith(".json")) {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as Partial<GoldenDay>;
    if (!parsed.day) throw new Error(`${target}: expected a { day: ... } object`);
    return [
      {
        label: target,
        golden: {
          key: target,
          title: target,
          day: parsed.day,
          daylight: parsed.daylight ?? null,
          windows: parsed.windows ?? null,
          mealPattern: parsed.mealPattern ?? null,
          persona: parsed.persona ?? null,
          budgetBand: parsed.budgetBand ?? null,
          lodging: parsed.lodging ?? null,
          anchorBaseline: parsed.anchorBaseline ?? null,
        },
      },
    ];
  }

  const known = [
    ...GOLDEN_DAYS.map((g) => g.key),
    ...TRAP_FIXTURES.map((t) => t.key),
  ];
  throw new Error(`unknown target "${target}". Known keys:\n  ${known.join("\n  ")}`);
}

const RULE = "─".repeat(74);

function report(subject: Subject): boolean {
  const ctx = contextFor(subject.golden, subject.travel ?? new HaversineStubProvider());
  assertWellFormed(subject.golden.day);
  const found = validateDay(subject.golden.day, ctx);
  const narrated = describeViolations(found);
  const day = subject.golden.day;

  console.log(`\n${RULE}`);
  console.log(`${subject.golden.key} — ${subject.label}`);
  console.log(
    `${day.city} · ${day.date} · ${day.archetype} · ${day.slots.length} slots · ` +
      `pattern ${subject.golden.mealPattern ?? "(none)"} · ` +
      `travel ${subject.travel ? "matrix" : "haversine stub"}`,
  );
  console.log(RULE);

  console.log("\n  THE DAY");
  for (const [i, slot] of [...day.slots]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .entries()) {
    const place = day.places[slot.placeId];
    const own = slot.origin === "user" ? " [yours]" : "";
    // Both the position and the id: findings quote "slot 4" (positional,
    // how a reviewer counts) but carry slotIds, and the join needs to be
    // visible or the two look like a contradiction.
    console.log(
      `  slot ${String(i + 1).padStart(2)} (${slot.id.padEnd(3)}) ${slot.startTime}–${slot.endTime}  ` +
        `${(place?.name ?? slot.placeId).padEnd(32)} ${slot.kind}/${slot.arriveBy}${own}`,
    );
  }

  console.log(`\n  ${narrated.headline.toUpperCase()}`);

  if (narrated.violations.length > 0) {
    console.log("\n  VIOLATIONS — this day would be rejected and regenerated");
    for (const line of narrated.violations) {
      console.log(`    ✗ ${line.text}`);
      console.log(`      ${line.ruleId}${line.slotIds.length ? ` · ${line.slotIds.join(", ")}` : ""}`);
      if (verbose) {
        const data = found.find((f) => f.ruleId === line.ruleId && f.slotIds.join() === line.slotIds.join());
        console.log(`      ${JSON.stringify(data?.data)}`);
      }
    }
  }

  if (narrated.advisories.length > 0) {
    console.log("\n  NOTES — the day ships; these become concierge notes");
    for (const line of narrated.advisories) {
      console.log(`    · ${line.text}`);
      console.log(`      ${line.ruleId}${line.slotIds.length ? ` · ${line.slotIds.join(", ")}` : ""}`);
    }
  }

  if (subject.expect !== undefined) {
    const caught = found.some((v) => v.ruleId === subject.expect);
    console.log(`\n  TRAP: expected ${subject.expect} — ${caught ? "CAUGHT" : "MISSED"}`);
    return caught;
  }

  if (verbose && narrated.violations.length > 0) {
    console.log("\n  WHAT THE GENERATOR WOULD BE TOLD");
    for (const line of regenerationFeedback(found).split("\n")) {
      console.log(`    ${line}`);
    }
  }

  return narrated.violations.length === 0;
}

let ok = true;
try {
  for (const target of targets.length > 0 ? targets : [undefined]) {
    for (const subject of resolve(target)) {
      ok = report(subject) && ok;
    }
  }
} catch (error) {
  console.error(`\ngrammar-report: ${(error as Error).message}`);
  process.exit(2);
}

console.log(`\n${RULE}`);
console.log(ok ? "All reported days behaved as expected." : "Something did not behave as expected.");
process.exit(ok ? 0 : 1);
