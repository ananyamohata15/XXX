import { createAnthropic, UsageRecorder } from "@/server/generation/llm";
import { parseDayRequest } from "@/server/generation/parse-llm";
import { themeFromKey, themeId } from "@/shared/theme";

/**
 * Parse probe (XXX-48 / XXX-47, Session 16 CP3) — does a sentence REACH the
 * new modes?
 *
 * The AC is stated in a traveller's words, not in enum values: *"picnic", "a
 * day in the park", "hang out with friends outside"* must derive the picnic;
 * a named district must derive a zone day. A prompt that lists the option is
 * not evidence that a sentence lands on it — that is the same gap as a stage
 * present in the source and never run.
 *
 * COSTS ANTHROPIC TOKENS, and is the only script in this session that does.
 * A parse is a short prompt and a small structured reply — cents, against a
 * generation's ~$0.50 — and spending them here is what keeps the founder's
 * own session from being the first time these sentences are tried.
 *
 * Every case asserts, and the script exits non-zero on any miss.
 *
 *   npx tsx --env-file=.env.local scripts/parse-probe.ts
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 62 - s.length))}`);
};

interface Case {
  text: string;
  /** The theme key this sentence must produce, or null for "no theme". */
  theme: string | null;
  /** Interest tags that must appear in `wants`. */
  wants?: string[];
  why: string;
}

const CASES: Case[] = [
  {
    text: "picnic",
    theme: "experience:park-picnic",
    why: "the founder's own word, alone",
  },
  {
    text: "a day in the park",
    theme: "experience:park-picnic",
    why: "the same day, said differently",
  },
  {
    text: "hang out with friends outside",
    theme: "experience:park-picnic",
    why: "no noun for the day at all — only its shape",
  },
  {
    text: "shopping, pub hopping and food for today",
    theme: null,
    wants: ["shopping", "nightlife", "food"],
    why: "his failed sentence. Shopping with NO district named is not a zone day — it is three wants and no theme",
  },
  {
    text: "I want to spend the day in Yorkville",
    theme: "zone:yorkville",
    why: "a named district is a destination",
  },
  {
    text: "shopping on Queen St W",
    theme: "zone:queen_west_ossington",
    wants: ["shopping"],
    why: "both at once: a want AND a district, and neither may swallow the other",
  },
  {
    text: "the islands if the weather's good",
    theme: "experience:toronto-islands",
    why: "the existing experience still wins its own sentence — a widened vocabulary must not cost the old one",
  },
];

async function main(): Promise<void> {
  const usage = new UsageRecorder();
  const client = createAnthropic();
  const failures: string[] = [];

  head("does a sentence reach the mode?");
  for (const testCase of CASES) {
    const outcome = await parseDayRequest(testCase.text, {
      client,
      usage,
      today: "2026-08-29",
    });
    if (outcome.status !== "parsed") {
      line(`  ? "${testCase.text}"`);
      line(`      asked instead: "${outcome.question}"`);
      failures.push(`"${testCase.text}" was not parsed — it asked a question`);
      continue;
    }
    const got = outcome.request.theme;
    const themeOk = got === testCase.theme;
    // A key the vocabulary cannot resolve is worse than a wrong one: it
    // vanishes at the seam instead of building the wrong day loudly.
    const resolvable = got === null || themeFromKey(got) !== null;
    const wantsOk = (testCase.wants ?? []).every((w) =>
      outcome.request.wants.includes(w as never),
    );
    const ok = themeOk && wantsOk && resolvable;
    line(`  ${ok ? "✓" : "✗"} "${testCase.text}"`);
    line(
      `      theme=${got ?? "null"}${themeOk ? "" : ` (expected ${testCase.theme ?? "null"})`}` +
        ` · wants=[${outcome.request.wants.join(", ")}]` +
        (resolvable ? "" : " · UNRESOLVABLE KEY"),
    );
    line(`      ${testCase.why}`);
    if (!ok) {
      failures.push(
        `"${testCase.text}": theme=${got ?? "null"} wants=[${outcome.request.wants.join(", ")}]`,
      );
    }
  }

  const spent = usage.drain().reduce((sum, e) => sum + e.estCostUsd, 0);
  head("spend");
  line(`  ${CASES.length} parses · $${spent.toFixed(4)}`);

  head("verdict");
  if (failures.length > 0) {
    for (const f of failures) line(`  ✗ ${f}`);
    console.error("\nFAIL — a sentence cannot reach a mode the engine has.");
    process.exit(1);
  }
  line("  PASS — every sentence reached its mode.");
  line(`  (Themes seen: ${CASES.map((c) => c.theme).filter(Boolean).map((k) => themeId(themeFromKey(k)!)).join(", ")})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
