import { z } from "zod";
import { checkGate, gateResponse } from "@/server/tasting/gate";
import {
  evidenceInputSchema,
  recordEvidence,
  resolveReporter,
} from "@/server/feedback/record";
import { getServerSupabase } from "@/server/supabase";

/**
 * Claims about the WORLD (XXX-33). Its twin, /api/tasting/taste, takes
 * claims about FIT. Two routes rather than one dispatcher so the split
 * is visible in a network tab — which is what makes "taste never touches
 * evidence" a thing a reviewer can watch rather than trust.
 *
 * The reporter handle is a server-side default, not a request field:
 * until XXX-17 there is exactly one identity behind this gate, and
 * letting a body name its own reporter would let it name its own
 * authority.
 */

export const dynamic = "force-dynamic";

const FOUNDER_HANDLE = "founder";

export async function POST(request: Request) {
  const verdict = checkGate(request);
  if (!verdict.ok) return gateResponse(verdict);

  const parsed = evidenceInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "bad request", detail: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const supabase = getServerSupabase();
    const handle = request.headers.get("x-tasting-reporter") ?? FOUNDER_HANDLE;
    const reporter = await resolveReporter(supabase, handle);
    const result = await recordEvidence(supabase, reporter, parsed.data);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("evidence write failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
