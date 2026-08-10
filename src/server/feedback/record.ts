/**
 * The two write paths (XXX-33). Two functions, two schemas, two tables,
 * nothing shared but the reporter lookup.
 *
 * `recordEvidence` writes claims about the world. `recordTasteSignal`
 * writes claims about fit. There is deliberately no function that takes
 * both, no shared row builder, and no shared table — comment 10289's
 * "world-facts and taste must not cross-contaminate" is enforced by
 * there being nothing to cross.
 *
 * Authority (comment 10297) is read from the `reporters` row, never
 * accepted from a caller:
 *   founder  -> evidence + (with a correction) an atomic fact flip
 *   trusted  -> evidence at verification_state 'queued'; flips nothing
 *   user     -> evidence at verification_state 'not_queued'; flips nothing
 * The last two are also enforced by the evidence_only_founder_flips
 * CHECK, which is the layer a refactor cannot quietly remove.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  CLAIM_DISPUTES_FACT,
  CLAIM_FLIPS_FACT,
  EVIDENCE_CLAIMS,
  TASTE_SIGNALS,
} from "@/shared/feedback";
import type { JsonValue } from "@/shared/day-grammar/types";
import { weekdayOf } from "@/shared/vocabulary";
import { parseTastingContext, type ShownCard } from "./shown";

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM time");

const correctionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("hours"), closedToday: z.literal(true) }),
  z.strictObject({
    kind: z.literal("hours"),
    closedToday: z.literal(false),
    open: timeSchema,
    close: z.union([timeSchema, z.literal("24:00")]),
  }),
  z.strictObject({
    kind: z.literal("price"),
    min: z.number().min(0),
    max: z.number().min(0),
    currency: z.string().length(3),
  }),
]);

export const evidenceInputSchema = z.strictObject({
  traceId: z.uuid(),
  slotId: z.string().min(1),
  claim: z.enum(EVIDENCE_CLAIMS),
  freeText: z.string().min(1).max(4000).optional(),
  /**
   * Absent = the claim is recorded and nothing flips. "This is wrong" is
   * a complete statement; demanding the right answer before hearing the
   * complaint would collect less truth.
   */
  correction: correctionSchema.optional(),
});
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

export const tasteInputSchema = z.strictObject({
  traceId: z.uuid(),
  /** Absent = a day-level verdict (comment 10296 level 2). */
  slotId: z.string().min(1).optional(),
  signal: z.enum(TASTE_SIGNALS),
  freeText: z.string().min(1).max(4000).optional(),
});
export type TasteInput = z.infer<typeof tasteInputSchema>;

export interface Reporter {
  id: string;
  handle: string;
  authority: "founder" | "trusted" | "user";
}

export async function resolveReporter(
  client: SupabaseClient,
  handle: string,
): Promise<Reporter> {
  const { data, error } = await client
    .from("reporters")
    .select("id, handle, authority, revoked_at")
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(`reporter lookup failed: ${error.message}`);
  if (data === null) throw new Error(`unknown reporter "${handle}"`);
  if (data.revoked_at !== null) {
    throw new Error(`reporter "${handle}" is revoked`);
  }
  return { id: data.id, handle: data.handle, authority: data.authority };
}

interface TraceContext {
  personaKey: string;
  dayDate: string;
  card: ShownCard;
  synthetic: boolean;
}

/**
 * Everything adjudicable comes from the trace the day was generated
 * under — never from the request body. A client can name a card; it
 * cannot claim what that card showed.
 */
async function loadTraceContext(
  client: SupabaseClient,
  traceId: string,
  slotId: string | null,
): Promise<Omit<TraceContext, "card"> & { card: ShownCard | null }> {
  const { data, error } = await client
    .from("traces")
    .select("metadata")
    .eq("id", traceId)
    .maybeSingle();
  if (error) throw new Error(`trace lookup failed: ${error.message}`);
  if (data === null) throw new Error(`unknown trace ${traceId}`);
  const context = parseTastingContext(data.metadata);
  if (context === null) {
    throw new Error(`trace ${traceId} carries no tasting context`);
  }
  const card = slotId === null ? null : (context.cards[slotId] ?? null);
  if (slotId !== null && card === null) {
    throw new Error(`trace ${traceId} has no card "${slotId}"`);
  }
  return {
    personaKey: context.persona_key,
    dayDate: context.day_date,
    card,
    synthetic: context.synthetic,
  };
}

/**
 * The founder's correction, as the value a founder fact would carry.
 * null = nothing to write (no correction supplied, or a claim that names
 * no fact). A mismatched correction kind is a caller error, not a
 * silently ignored field.
 */
function flipValueFor(
  input: EvidenceInput,
  dayDate: string,
): JsonValue | null {
  const key = CLAIM_FLIPS_FACT[input.claim];
  if (key === null) return null;
  if (input.claim === "permanently_closed") return "closed_permanently";
  if (input.correction === undefined) return null;

  if (input.claim === "hours_wrong") {
    if (input.correction.kind !== "hours") {
      throw new Error("hours_wrong needs an hours correction");
    }
    const intervals = input.correction.closedToday
      ? []
      : [{ open: input.correction.open, close: input.correction.close }];
    return { [weekdayOf(dayDate)]: intervals };
  }

  if (input.correction.kind !== "price") {
    throw new Error("price_wrong needs a price correction");
  }
  const { min, max, currency } = input.correction;
  if (max < min) throw new Error("price correction: max must be >= min");
  return { min, max, currency };
}

export interface EvidenceResult {
  evidenceId: string;
  authority: Reporter["authority"];
  verificationState: "bypassed" | "queued" | "not_queued";
  /** null = nothing flipped, which is every non-founder row by law. */
  flippedFactKey: string | null;
  /** Why a founder claim flipped nothing, when it otherwise would have. */
  note?: string;
}

export async function recordEvidence(
  client: SupabaseClient,
  reporter: Reporter,
  input: EvidenceInput,
): Promise<EvidenceResult> {
  const { personaKey, dayDate, card, synthetic } = await loadTraceContext(
    client,
    input.traceId,
    input.slotId,
  );
  if (card === null) throw new Error("evidence requires a card");

  const disputed = CLAIM_DISPUTES_FACT[input.claim];
  const shown = disputed === null ? undefined : card.facts[disputed];

  if (reporter.authority === "founder") {
    const flipKey = CLAIM_FLIPS_FACT[input.claim];
    // A fabricated card must never write ground truth about a real
    // venue. The claim is recorded; only the fact write is withheld.
    const flipValue = synthetic ? null : flipValueFor(input, dayDate);
    const { data, error } = await client.rpc("record_founder_evidence", {
      p_place_id: card.place_id,
      p_claim: input.claim,
      p_fact_key: disputed,
      p_reporter_id: reporter.id,
      p_trace_id: input.traceId,
      p_slot_id: input.slotId,
      p_shown_status: shown?.status ?? null,
      p_shown_source: shown?.source ?? null,
      p_shown_tier: shown?.tier ?? null,
      p_shown_fetched_at: shown?.fetched_at ?? null,
      p_shown_digest: shown?.digest ?? null,
      p_free_text: input.freeText ?? null,
      p_persona_key: personaKey,
      p_day_date: dayDate,
      p_adjacent_rule_ids: card.rule_ids,
      p_flip_fact_key: flipValue === null ? null : flipKey,
      p_flip_value: flipValue,
    });
    if (error) throw new Error(`founder evidence failed: ${error.message}`);
    return {
      evidenceId: data as string,
      authority: "founder",
      verificationState: "bypassed",
      flippedFactKey: flipValue === null ? null : flipKey,
      ...(synthetic
        ? { note: "synthetic day — recorded, but no fact was written" }
        : {}),
    };
  }

  // Trusted reports are flagged for immediate verification rather than
  // corroboration-queueing (10297); user reports queue nothing until
  // XXX-34 sets a threshold. Neither writes a fact — the CHECK agrees.
  const verificationState =
    reporter.authority === "trusted" ? "queued" : "not_queued";
  const { data, error } = await client
    .from("evidence")
    .insert({
      place_id: card.place_id,
      claim: input.claim,
      fact_key: disputed,
      reporter_id: reporter.id,
      reporter_authority: reporter.authority,
      trace_id: input.traceId,
      slot_id: input.slotId,
      shown_status: shown?.status ?? null,
      shown_source: shown?.source ?? null,
      shown_tier: shown?.tier ?? null,
      shown_fetched_at: shown?.fetched_at ?? null,
      shown_digest: shown?.digest ?? null,
      free_text: input.freeText ?? null,
      persona_key: personaKey,
      day_date: dayDate,
      adjacent_rule_ids: card.rule_ids,
      verification_state: verificationState,
    })
    .select("id")
    .single();
  if (error) throw new Error(`evidence insert failed: ${error.message}`);
  return {
    evidenceId: data.id,
    authority: reporter.authority,
    verificationState,
    flippedFactKey: null,
  };
}

export interface TasteResult {
  tasteSignalId: string;
}

export async function recordTasteSignal(
  client: SupabaseClient,
  reporter: Reporter,
  input: TasteInput,
): Promise<TasteResult> {
  const dayVerdict = input.signal === "day_verdict";
  const { personaKey, dayDate, card } = await loadTraceContext(
    client,
    input.traceId,
    dayVerdict ? null : (input.slotId ?? null),
  );
  if (!dayVerdict && card === null) {
    throw new Error(`${input.signal} needs a card`);
  }

  const { data, error } = await client
    .from("taste_signals")
    .insert({
      place_id: dayVerdict ? null : card!.place_id,
      signal: input.signal,
      reporter_id: reporter.id,
      reporter_authority: reporter.authority,
      trace_id: input.traceId,
      slot_id: dayVerdict ? null : input.slotId,
      free_text: input.freeText ?? null,
      persona_key: personaKey,
      day_date: dayDate,
    })
    .select("id")
    .single();
  if (error) throw new Error(`taste signal insert failed: ${error.message}`);
  return { tasteSignalId: data.id };
}
