import { z } from "zod";
import { checkGate, gateResponse } from "@/server/tasting/gate";
import {
  recordTasteSignal,
  resolveReporter,
  tasteInputSchema,
} from "@/server/feedback/record";
import { getServerSupabase } from "@/server/supabase";

/**
 * Claims about FIT (XXX-33) — "wouldn't recommend", "not for me", and
 * the day-level verdict. Nothing written here can name a fact, cite a
 * displayed value, or flip anything: taste_signals has no column for it.
 */

export const dynamic = "force-dynamic";

const FOUNDER_HANDLE = "founder";

export async function POST(request: Request) {
  const verdict = checkGate(request);
  if (!verdict.ok) return gateResponse(verdict);

  const parsed = tasteInputSchema.safeParse(
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
    const result = await recordTasteSignal(supabase, reporter, parsed.data);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("taste signal write failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
