/**
 * Narration (CP1 §1.3 call 2): Tier-3 reasons per card, day notes from
 * the advisories. The model re-voices what lower layers decided — every
 * reason must cite a concrete fact already in the card data, and the
 * mechanical tone gate (tone.ts — the describe.test.ts register) runs
 * over the parsed output in code. One retry with the breaches named;
 * then the honest fallback is `describeViolations`' own text.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { describeViolations } from "@/shared/day-grammar/describe";
import type { GrammarDay, Violation } from "@/shared/day-grammar/types";
import type { Persona } from "@/shared/persona";
import {
  costUsd,
  GENERATION_MODEL,
  safeParseStructured,
  TORONTO_CONTEXT,
  type UsageRecorder,
} from "./llm";
import { checkTone, type ToneBreach } from "./tone";
import type { CardReason } from "./types";

const MAX_ATTEMPTS = 2;

const narrationSchema = z.object({
  cards: z.array(
    z.object({
      slotId: z.string(),
      /** One sentence, ≤200 chars, citing a fact from the card data. */
      reason: z.string().max(220),
    }),
  ),
  /** Prep-kit style, from the advisories only. ≤3. */
  dayNotes: z.array(z.string().max(280)).max(3),
});

const SYSTEM = `You are the voice of a travel concierge. Everything below was decided and fact-checked by other layers; you re-voice it, you never re-decide it.

${TORONTO_CONTEXT}

Register (absolute — mechanical checks reject breaches):
- Clipped, confident, never listy. One sentence per card, under 200
  characters. The concierge states what it did and why; it does not
  perform.
- Every card reason cites at least one concrete fact from that card's
  data: an hour, a price, a walk time, a light or weather boundary, a
  rating count. Never invent a fact that is not in the data.
- Forbidden: exclamation marks; apology or hedging (sorry, maybe,
  perhaps, possibly); gushing (amazing, incredible, stunning, wonderful,
  delightful, must-see, hidden gem); emoji; "you'll love".
- Day notes: at most three, derived ONLY from the advisories given
  (prep-kit lines, timing cautions, budget position). No advisory, no
  note.`;

export interface NarrateInput {
  client: Anthropic;
  usage: UsageRecorder;
  day: GrammarDay;
  advisories: Violation[];
  persona: Persona;
  reasonSeeds: Map<string, string>;
}

export interface NarrateResult {
  reasons: CardReason[];
  dayNotes: string[];
  /** True when the describeViolations fallback shipped instead. */
  fallback: boolean;
}

export async function narrateDay(input: NarrateInput): Promise<NarrateResult> {
  const { day } = input;
  const conciergeSlots = [...day.slots]
    .filter((s) => s.origin === "concierge")
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const cardData = conciergeSlots
    .map((slot) => {
      const place = day.places[slot.placeId];
      const facts: string[] = [
        `${slot.startTime}-${slot.endTime}`,
        `kind=${slot.kind}`,
        `arrive by ${slot.arriveBy}`,
      ];
      if (place?.category?.status === "present") facts.push(place.category.value);
      if (place?.priceRange?.status === "present") {
        facts.push(
          `$${place.priceRange.value.min}-${place.priceRange.value.max} ${place.priceRange.value.currency}`,
        );
      }
      if (place?.hours?.status === "present") facts.push("hours verified today");
      const seed = input.reasonSeeds.get(slot.id);
      return `card ${slot.id}: ${place?.name ?? slot.placeId} (${place?.neighborhood ?? "?"}) — ${facts.join(", ")}${seed ? ` — selector's why: ${seed}` : ""}`;
    })
    .join("\n");

  const advisoriesText =
    input.advisories.length === 0
      ? "(none)"
      : input.advisories.map((a) => `- [${a.ruleId}] ${a.message}`).join("\n");

  const personaText = `persona: pace=${input.persona.pace}, gravity=${input.persona.gravity.join(">")}, lens=${input.persona.lens}`;

  let breachNote = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    // messages.create + explicit safeParse (not .parse): a schema miss
    // must land in the retry loop with its usage counted, not throw.
    const response = await input.client.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 1200,
      // Thinking off for latency (see select-llm.ts). CP1 ruling 6's
      // standing lever: if narration reads flat at CP3, raise effort on
      // this call only.
      thinking: { type: "disabled" },
      output_config: {
        effort: "low",
        format: zodOutputFormat(narrationSchema),
      },
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: `${personaText}\n\nCards:\n${cardData}\n\nAdvisories (day notes may draw ONLY on these):\n${advisoriesText}${breachNote}`,
        },
      ],
    });
    const usage = {
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_read_input_tokens ?? 0) +
        (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
    input.usage.record({
      stage: "narration",
      ...usage,
      estCostUsd: costUsd(usage.inputTokens, usage.outputTokens),
      durationMs: Date.now() - started,
      contractRetry: false,
      toneRetry: attempt > 1,
    });

    const parsed = safeParseStructured(response, narrationSchema);
    if (typeof parsed !== "string") {
      const breaches: ToneBreach[] = [];
      const knownSlots = new Set(conciergeSlots.map((s) => s.id));
      let contractOk = true;
      for (const card of parsed.cards) {
        if (!knownSlots.has(card.slotId)) {
          contractOk = false;
          break;
        }
        breaches.push(...checkTone(card.reason, "card"));
      }
      for (const note of parsed.dayNotes) {
        breaches.push(...checkTone(note, "note"));
      }
      const covered =
        contractOk &&
        conciergeSlots.every((s) =>
          parsed.cards.some((c) => c.slotId === s.id),
        );
      if (covered && breaches.length === 0) {
        return {
          reasons: parsed.cards.map((c) => ({
            slotId: c.slotId,
            reason: c.reason,
          })),
          dayNotes: parsed.dayNotes,
          fallback: false,
        };
      }
      breachNote = `\n\nYour previous answer was rejected: ${
        !covered
          ? "every concierge card must have exactly one reason with a valid slotId. "
          : ""
      }${breaches
        .slice(0, 4)
        .map((b) => `"${b.text.slice(0, 40)}…" breaks the register (${b.rule})`)
        .join("; ")}. Rewrite within the register.`;
    } else {
      breachNote = `\n\nYour previous answer was rejected (${parsed}). Return the structured narration exactly.`;
    }
  }

  // The validator's own voice is the honest floor.
  const narrated = describeViolations(input.advisories);
  return {
    reasons: [],
    dayNotes: narrated.advisories.slice(0, 3).map((line) => line.text),
    fallback: true,
  };
}
