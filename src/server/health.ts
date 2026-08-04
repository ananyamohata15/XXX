import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "./supabase";
import { createInstrumentation } from "./instrumentation";
import pkg from "../../package.json";

export interface DbCheck {
  ok: boolean;
  /** null when the check could not run at all (e.g. Supabase unconfigured). */
  latencyMs: number | null;
  error: string | null;
}

export interface HealthReport {
  status: "healthy" | "unhealthy";
  checks: { db: DbCheck };
  version: string;
  timestamp: string;
}

/**
 * Checks Supabase connectivity and records the check itself as a trace
 * (proof-of-life for the instrumentation scaffolding, XXX-14).
 *
 * `client` is injectable for tests; production callers pass nothing.
 */
export async function checkHealth(
  client?: SupabaseClient,
): Promise<HealthReport> {
  let supabase: SupabaseClient | null = null;
  let configError: string | null = null;
  try {
    supabase = client ?? getServerSupabase();
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }

  const db: DbCheck = supabase
    ? await checkDb(supabase)
    : { ok: false, latencyMs: null, error: configError };

  if (supabase) {
    await recordHealthTrace(supabase, db);
  }

  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return {
    status: db.ok ? "healthy" : "unhealthy",
    checks: { db },
    version: sha ? `${pkg.version}+${sha}` : pkg.version,
    timestamp: new Date().toISOString(),
  };
}

async function checkDb(supabase: SupabaseClient): Promise<DbCheck> {
  const startedAt = Date.now();
  try {
    // A real GET, not head:true — PostgREST HEAD responses carry no error
    // body, so a missing table reads as success (observed live on Vercel:
    // "healthy" while startTrace failed with table-not-found).
    const { error } = await supabase.from("traces").select("id").limit(1);
    const latencyMs = Date.now() - startedAt;
    if (error) return { ok: false, latencyMs, error: error.message };
    return { ok: true, latencyMs, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * A failed trace must never fail the health check itself — instrumentation
 * degrades gracefully at this boundary (it is the thing being scaffolded,
 * not the thing being checked).
 */
async function recordHealthTrace(
  supabase: SupabaseClient,
  db: DbCheck,
): Promise<void> {
  try {
    const instrumentation = createInstrumentation(supabase);
    const traceId = await instrumentation.startTrace("health_check");
    await instrumentation.logEvent(traceId, {
      provider: "supabase",
      endpoint: "traces.select_limit_1",
      estCostUsd: 0,
      durationMs: db.latencyMs ?? undefined,
      metadata: { ok: db.ok },
    });
    await instrumentation.endTrace(traceId, { totalCostUsd: 0 });
  } catch (err) {
    console.error("health trace failed (non-fatal):", err);
  }
}
