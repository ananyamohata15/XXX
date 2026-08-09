/**
 * The tasting-room gate (XXX-32).
 *
 * Founder-only until XXX-17 brings real auth. One shared secret,
 * `TASTING_ROOM_SECRET`, and two ways to present it:
 *
 *   * `x-tasting-secret` header — for scripts and the CP2 curl proofs
 *   * a session cookie — for the phone
 *
 * The cookie does NOT carry the secret. It carries an expiry and an HMAC
 * of that expiry keyed by the secret, so the shared secret never leaves
 * the server and the raw value exists in the browser for exactly one
 * request. The cookie is httpOnly (no JS can read it, so an XSS or a
 * stray log cannot lift it), Secure, SameSite=Strict, and short-lived.
 * Stateless by design: no session table to grow, revoke or leak.
 *
 * The secret never appears in a URL — no query parameter, no path
 * segment. URLs land in server logs, Referer headers and screenshots.
 *
 * Failure modes are kept distinct, following the CRON_SECRET route's
 * precedent: a missing env var is 503 (our misconfiguration), a wrong
 * secret is 401 (their problem). Collapsing them would hide an outage.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const TASTING_COOKIE = "tasting_session";
const SESSION_MS = 12 * 60 * 60 * 1000;

export type GateVerdict =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

function secretOrNull(): string | null {
  const secret = process.env.TASTING_ROOM_SECRET;
  return secret === undefined || secret === "" ? null : secret;
}

/** Constant-time compare that also survives length mismatches. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintSessionToken(secret: string, nowMs: number): string {
  const expiry = String(nowMs + SESSION_MS);
  return `${Buffer.from(expiry, "utf8").toString("base64url")}.${sign(secret, expiry)}`;
}

export function sessionTokenValid(
  secret: string,
  token: string,
  nowMs: number,
): boolean {
  const [encoded, signature] = token.split(".");
  if (encoded === undefined || signature === undefined) return false;
  const expiry = Buffer.from(encoded, "base64url").toString("utf8");
  if (!/^\d+$/.test(expiry)) return false;
  if (!equals(sign(secret, expiry), signature)) return false;
  return Number(expiry) > nowMs;
}

/**
 * `Secure` is conditional, and deliberately so. Browsers REJECT a Secure
 * cookie served over plain http (localhost excepted), which would make
 * the gate un-openable on the phone-over-LAN review loop — a
 * device-specific failure of exactly the kind Session 3 taught us to
 * catch before the founder does. Production and preview on Vercel are
 * always https, so the flag is always set where it matters.
 */
export const sessionCookie = (token: string, secure: boolean): string =>
  `${TASTING_COOKIE}=${token}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;

/** Is this request already on https? Vercel terminates TLS upstream. */
export function isSecureRequest(request: Request): boolean {
  if (request.headers.get("x-forwarded-proto") === "https") return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function cookieValue(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * The gate itself. Call it FIRST in every tasting route, before parsing
 * a body or touching the database: an unauthenticated request must not
 * be able to cause a query, let alone see its result.
 */
export function checkGate(request: Request, nowMs = Date.now()): GateVerdict {
  const secret = secretOrNull();
  if (secret === null) {
    return { ok: false, status: 503, error: "TASTING_ROOM_SECRET not configured" };
  }
  const header = request.headers.get("x-tasting-secret");
  if (header !== null && equals(header, secret)) return { ok: true };
  const token = cookieValue(request.headers.get("cookie"), TASTING_COOKIE);
  if (token !== null && sessionTokenValid(secret, token, nowMs)) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}

/** The refusal, with nothing in it: no counts, no names, no pool data. */
export const gateResponse = (verdict: Extract<GateVerdict, { ok: false }>) =>
  Response.json({ error: verdict.error }, { status: verdict.status });

export function verifySecret(candidate: string): GateVerdict {
  const secret = secretOrNull();
  if (secret === null) {
    return { ok: false, status: 503, error: "TASTING_ROOM_SECRET not configured" };
  }
  return equals(candidate, secret)
    ? { ok: true }
    : { ok: false, status: 401, error: "unauthorized" };
}

export function mintForRequest(nowMs = Date.now()): string {
  const secret = secretOrNull();
  if (secret === null) throw new Error("TASTING_ROOM_SECRET not configured");
  return mintSessionToken(secret, nowMs);
}
