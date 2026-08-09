import { z } from "zod";
import {
  gateResponse,
  mintForRequest,
  sessionCookie,
  verifySecret,
} from "@/server/tasting/gate";

/**
 * Exchange the shared secret for a short-lived session cookie (XXX-32).
 * The secret arrives in a POST body — never a URL, which would leak it
 * into server logs, Referer headers and screenshots.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ secret: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const verdict = verifySecret(parsed.data.secret);
  if (!verdict.ok) return gateResponse(verdict);

  return Response.json(
    { ok: true },
    { status: 200, headers: { "set-cookie": sessionCookie(mintForRequest()) } },
  );
}
