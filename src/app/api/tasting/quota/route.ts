import { getServerSupabase } from "@/server/supabase";
import { checkGate, gateResponse } from "@/server/tasting/gate";
import { readQuota } from "@/server/tasting/quota";

/**
 * Read the spend gauge on its own (XXX-35, Session 13 Step 1).
 *
 * The gauge existed only as a field on a generation's response, so
 * `readQuota` ran only when the founder paid for a day. The number on
 * screen therefore described *the last generation this page completed*,
 * rather than the month — and Session 12's unexplained 66-event drift was
 * exactly that: a reading taken 2026-08-11T05:36Z, correct when made, still
 * displayed four days and 66 events later (30 from the room, 36 from CLI
 * harness runs the page could never have known about).
 *
 * A spend fence that only moves when you push it is not a fence. This lets
 * the room ask, on mount and after every generation, whatever the outcome.
 *
 * Read-only and free: two counting queries, no Google, no Anthropic, no
 * writes. It spends nothing, so it is deliberately NOT behind the daily
 * runaway guard — refusing to show someone their spend because they have
 * spent too much would be the wrong way round.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const verdict = checkGate(request);
  if (!verdict.ok) return gateResponse(verdict);

  try {
    const quota = await readQuota(getServerSupabase(), new Date().toISOString());
    return Response.json(
      { quota },
      // The whole point is freshness; a cached gauge is the bug again.
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("quota read failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
