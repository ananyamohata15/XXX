/**
 * Anthropic plumbing for the two LLM stages (CP1 §1.3). Model: Sonnet 5
 * (the brief's Sonnet-class ruling), adaptive thinking (model default),
 * effort low — both stages are well-specified selection/rewriting, not
 * open reasoning. Costs are recorded at list ($3/$15 per MTok; intro
 * billing through 2026-08-31 runs lower — the trace states its basis).
 *
 * The static system blocks carry `cache_control` and are padded past the
 * 1,024-token Sonnet 5 cache minimum with *stable, genuinely useful*
 * city context (zones, fares, register rules) — never volatile content
 * (prompt-caching law: stable first, volatile after the breakpoint).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const GENERATION_MODEL = "claude-sonnet-5";
export const SONNET_INPUT_USD_PER_MTOK = 3;
export const SONNET_OUTPUT_USD_PER_MTOK = 15;

export interface LlmUsageEvent {
  stage: "selection" | "narration";
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  durationMs: number;
  contractRetry: boolean;
  toneRetry: boolean;
}

/** Shared between the selector/narrator and the engine's trace writer. */
export class UsageRecorder {
  private events: LlmUsageEvent[] = [];
  record(event: LlmUsageEvent): void {
    this.events.push(event);
  }
  drain(): LlmUsageEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}

export function costUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * SONNET_INPUT_USD_PER_MTOK) / 1_000_000 +
    (outputTokens * SONNET_OUTPUT_USD_PER_MTOK) / 1_000_000
  );
}

/**
 * Structured output, parsed without throwing: a schema miss is a
 * contract event for the caller's retry loop (with the model's usage
 * still counted), never an exception that loses the accounting.
 */
export function safeParseStructured<Schema extends z.ZodType>(
  response: Anthropic.Message,
  schema: Schema,
): z.infer<Schema> | string {
  const text = response.content.find((b) => b.type === "text");
  if (text === undefined || text.type !== "text") {
    return "no text content in the response";
  }
  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    return "output was not valid JSON";
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return `schema mismatch: ${result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
      .slice(0, 300)}`;
  }
  return result.data;
}

export function createAnthropic(): Anthropic {
  // Key resolution is the SDK's own (ANTHROPIC_API_KEY) — the session
  // never reads the env file; scripts self-report absence.
  return new Anthropic();
}

/**
 * Stable Toronto context shared by both stages. This is cache filler
 * that earns its place: the model uses it, and it never changes within
 * a deploy, so the prefix caches.
 */
export const TORONTO_CONTEXT = `
Toronto context (stable):
- Zones the pool draws from: Downtown core (City Hall to the waterfront
  grid), St. Lawrence Market / Old Town, Distillery District, Harbourfront,
  Yorkville, Kensington Market & Chinatown, Queen West & Ossington, The
  Annex, Leslieville. Icons personas gravitate to the first five; corners
  personas to the last four. Adjacent zones are 15-40 minutes apart on
  foot; cross-town pairs (Leslieville to the Annex) need transit.
- Transit fares are structures, not numbers: a PRESTO tap is $3.30 CAD
  with a two-hour free transfer window; the day pass is $13.50 and breaks
  even around five separate fare events. A day that rides more than four
  times is a day-pass day.
- Category vocabulary (the only seven): restaurants, cafes,
  museums_galleries, historic_sites, markets, nightlife_bars, parks.
- Meal patterns: classic (breakfast 07:00-11:00, lunch 11:30-14:30,
  dinner 17:30-21:30), coffee_then_brunch, grazing. The pattern is an
  input; you never move a meal outside its window.
- Seasonal truths: summer sunsets run past 20:30, winter light dies
  before 17:00 and outdoor time is front-loaded; markets are at their
  best before 14:00 (afternoons are picked over); stadium events crush
  nearby streets for half an hour after the final out.
`.trim();
