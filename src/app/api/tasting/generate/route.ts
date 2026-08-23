import { z } from "zod";
import { CUISINE_TAGS } from "@/shared/cuisine";
import { INTEREST_TAGS } from "@/shared/persona";
import { PLACE_CATEGORIES } from "@/shared/vocabulary";
import { checkGate, gateResponse } from "@/server/tasting/gate";
import { runTastingGeneration } from "@/server/tasting/generate";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { EXPERIENCE_IDS, THREAD_IDS } from "@/shared/theme";

/**
 * Generate a fresh Toronto day for the founder (XXX-32).
 *
 * The gate runs FIRST — before the body is parsed and before any
 * database access — so an unauthenticated request cannot even cause a
 * query, let alone see one. Missing secret is 503 (our misconfiguration),
 * wrong secret is 401 (theirs): the CRON_SECRET route's precedent.
 */

export const dynamic = "force-dynamic";
// Generation runs 9.8–14.8s on the LLM path (Session 9 actuals). An
// honest bound, rather than inheriting the platform's 300s default.
export const maxDuration = 60;

const bodySchema = z.strictObject({
  personaKey: z.enum(
    Object.keys(GOLDEN_PERSONAS) as [string, ...string[]],
  ),
  date: z.iso.date(),
  budgetMax: z.number().positive().nullable().default(null),
  seed: z.number().int().nullable().default(null),
  synthetic: z.boolean().default(false),
  /**
   * The picker's theme (XXX-40). `null` is "concierge's choice" — the
   * ABSENCE of a request, which the engine derives from. The union is built
   * from the shared vocabulary so the route cannot drift from the engine.
   */
  theme: z
    .discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("venue") }),
      z.strictObject({
        mode: z.literal("thread"),
        threadId: z.enum(THREAD_IDS),
      }),
      z.strictObject({
        mode: z.literal("experience"),
        experienceId: z.enum(EXPERIENCE_IDS),
      }),
    ])
    .nullable()
    .default(null),
  /** Generate for the traveller's stored profile rather than a persona (XXX-43). */
  useProfile: z.boolean().default(false),
  /** Per-day constraints from the parsed chat request. */
  excludedCategories: z.array(z.enum(PLACE_CATEGORIES)).default([]),
  lovedCuisines: z.array(z.enum(CUISINE_TAGS)).default([]),
  /** What the traveller asked to DO today — overrides standing gravity. */
  wants: z.array(z.enum(INTEREST_TAGS)).default([]),
  /** Trip circumstance. `null` = unknown, and the room says so. */
  lodging: z
    .strictObject({ lat: z.number(), lng: z.number() })
    .nullable()
    .default(null),
});

export async function POST(request: Request) {
  const verdict = checkGate(request);
  if (!verdict.ok) return gateResponse(verdict);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "bad request", detail: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const outcome = await runTastingGeneration(parsed.data);
    if (outcome.status === "capped") {
      // Never a silent no-op: the refusal names the cap, the count and
      // when it lifts.
      return Response.json(outcome, { status: 429 });
    }
    return Response.json(outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("tasting generation failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
