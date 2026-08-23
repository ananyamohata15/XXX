import { checkGate, gateResponse } from "@/server/tasting/gate";
import { GOLDEN_PERSONAS } from "@/shared/persona";

/**
 * The regression persona list, for the Workshop only (XXX-43).
 *
 * It exists so the drawer can render the keys without the client importing
 * the persona module — and, more to the point, so the PRODUCT surface has no
 * reason to know personas exist at all.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const verdict = checkGate(request);
  if (!verdict.ok) return gateResponse(verdict);
  return Response.json({ keys: Object.keys(GOLDEN_PERSONAS) });
}
