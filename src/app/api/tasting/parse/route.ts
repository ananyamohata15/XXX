import { z } from "zod";
import { checkGate, gateResponse } from "@/server/tasting/gate";
import { createAnthropic, UsageRecorder } from "@/server/generation/llm";
import { parseDayRequest } from "@/server/generation/parse-llm";
import { getServerSupabase } from "@/server/supabase";
import { readProfile } from "@/server/profile/repo";
import { mergeConstraints } from "@/shared/intent";

/**
 * Free text → a request the engine accepts (XXX-43, Session 15).
 *
 * SEPARATE FROM `/generate` ON PURPOSE. The parse is shown to the traveller
 * as editable chips BEFORE anything is generated, which is both the UX (no
 * dropdowns, one primary action) and the honesty law: the machine's reading
 * of you is visible and correctable before a cent is spent. Folding the parse
 * into generation would make a misread cost a whole day instead of one tap.
 *
 * Costs about $0.002 — two orders of magnitude under a generation, which is
 * the whole economic argument for asking rather than guessing.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.strictObject({
  text: z.string().max(2000),
  /** City-local "YYYY-MM-DD" — relative dates resolve against the traveller's day. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: Request) {
  const verdict = checkGate(request);
  if (!verdict.ok) return gateResponse(verdict);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "malformed body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "request rejected" }, { status: 400 });
  }

  try {
    const usage = new UsageRecorder();
    const outcome = await parseDayRequest(parsed.data.text, {
      client: createAnthropic(),
      usage,
      today: parsed.data.today,
    });
    const spentUsd = usage
      .drain()
      .reduce((sum, e) => sum + e.estCostUsd, 0);

    if (outcome.status === "needs-clarification") {
      return Response.json(
        {
          status: "needs-clarification",
          question: outcome.question,
          suggestions: outcome.suggestions,
          spentUsd,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    /**
     * MONOTONIC COMPOSITION, applied at the boundary rather than in the UI.
     *
     * The sentence may ADD a constraint; it may never silently lift one the
     * traveller set deliberately on their profile sheet. Where the two
     * genuinely conflict the traveller is asked — the answer is theirs, and
     * a server that resolved it would be making a decision on tier-1 evidence
     * it does not own.
     */
    const { profile } = await readProfile(getServerSupabase());

    /**
     * NOTE ON THE CONFLICT CHECK, recorded rather than faked.
     *
     * `conflictsWithProfile` exists and is tested, but it cannot fire from
     * here yet: the parse contract has a field for what a sentence REFUSES
     * and none for what it WANTS, so there is nothing to compare against a
     * standing exclusion. Wiring a branch that can never run would be the
     * dead-guard defect this project has now been bitten by twice.
     *
     * The honest statement of where that leaves us: a request like "find me a
     * great cocktail bar" from a no-alcohol profile currently parses with the
     * exclusion intact and simply produces a day without bars — the
     * constraint holds, which is the safe direction, but the traveller is not
     * asked. Asking needs a `wants` field on the contract, which is a
     * contract change and belongs to the refinement ticket (E5), not smuggled
     * in here.
     */
    return Response.json(
      {
        status: "parsed",
        request: {
          ...outcome.request,
          excludedCategories: mergeConstraints(
            profile.excludedCategories,
            outcome.request.excludedCategories,
          ),
          lovedCuisines: [
            ...new Set([
              ...profile.lovedCuisines,
              ...outcome.request.lovedCuisines,
            ]),
          ],
        },
        spentUsd,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("parse failed:", message);
    return Response.json({ error: "parse failed" }, { status: 500 });
  }
}
