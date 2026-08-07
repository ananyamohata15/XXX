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

/**
 * Absence-based alerting for the XXX-25 compliance sweep: the check asserts
 * the *evidence of success* (a recent ttl_sweep trace), so it catches every
 * upstream failure mode — job erroring, job unscheduled, scheduler dead —
 * without needing any of them to report in.
 */
export interface TtlSweepCheck {
  ok: boolean;
  lastRunAt: string | null;
  ageMinutes: number | null;
  error: string | null;
}

export interface HealthWarning {
  code: string;
  message: string;
}

export interface HealthReport {
  status: "healthy" | "unhealthy";
  checks: { db: DbCheck; ttlSweep: TtlSweepCheck };
  /** Non-fatal, action-needed notices (severity tiering: Checkpoint 1 ruling 5). */
  warnings: HealthWarning[];
  version: string;
  timestamp: string;
}

/**
 * Hourly cadence + one missed slot of slack. Staleness beyond this means the
 * compliance sweep is not running — unhealthy (503), not a warning.
 */
const TTL_SWEEP_MAX_AGE_MINUTES = 120;

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

  const warnings: HealthWarning[] = [];
  const ttlSweep: TtlSweepCheck = supabase
    ? await checkTtlSweep(supabase, warnings)
    : { ok: false, lastRunAt: null, ageMinutes: null, error: configError };

  if (supabase) {
    await recordHealthTrace(supabase, db);
  }

  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return {
    status: db.ok && ttlSweep.ok ? "healthy" : "unhealthy",
    checks: { db, ttlSweep },
    warnings,
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

async function checkTtlSweep(
  supabase: SupabaseClient,
  warnings: HealthWarning[],
): Promise<TtlSweepCheck> {
  try {
    const { data, error } = await supabase
      .from("traces")
      .select("started_at, metadata")
      .eq("kind", "ttl_sweep")
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) {
      return { ok: false, lastRunAt: null, ageMinutes: null, error: error.message };
    }
    const latest = data?.[0];
    if (!latest) {
      return {
        ok: false,
        lastRunAt: null,
        ageMinutes: null,
        error: "no ttl_sweep trace exists — sweep has never run or its schedule is dead",
      };
    }
    const lastRunAt = latest.started_at as string;
    const ageMinutes = Math.round(
      (Date.now() - new Date(lastRunAt).getTime()) / 60_000,
    );
    const stale = ageMinutes > TTL_SWEEP_MAX_AGE_MINUTES;

    const expiring = Number(
      (latest.metadata as Record<string, unknown> | null)?.[
        "expiring_within_7d"
      ] ?? 0,
    );
    if (!stale && expiring > 0) {
      warnings.push({
        code: "coords_expiring",
        message: `${expiring} coordinates expire within 7 days — run: npx tsx scripts/discover-toronto.ts --full`,
      });
    }

    return {
      ok: !stale,
      lastRunAt,
      ageMinutes,
      error: stale
        ? `latest ttl_sweep trace is ${ageMinutes} min old (limit ${TTL_SWEEP_MAX_AGE_MINUTES})`
        : null,
    };
  } catch (err) {
    return {
      ok: false,
      lastRunAt: null,
      ageMinutes: null,
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
