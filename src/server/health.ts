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

/**
 * Are the generation path's credentials PRESENT? (Session 16 close-out.)
 *
 * WHY THIS EXISTS, and it is an incident rather than an idea:
 * `ANTHROPIC_API_KEY` was missing from Vercel Production. `/api/health`
 * reported **healthy** throughout, because it checked the database and the
 * sweep and nothing else — and the first symptom was the founder's own
 * generation failing.
 *
 * The key is the hardest of the four to notice missing, and for a structural
 * reason: `createAnthropic()` lets the SDK resolve `ANTHROPIC_API_KEY`
 * itself, so **the one credential that broke production is the one the
 * codebase never names.** A grep for `process.env` does not find it. Nothing
 * would have, short of a generation.
 *
 * PRESENCE ONLY — never a value, never a length, never a prefix. The question
 * "is it configured" is answerable without disclosing anything, and answering
 * more than the question is how a health endpoint becomes a leak.
 *
 * `db` and `ttlSweep` describe whether the app is SERVING. This describes
 * whether it can DO ITS JOB, which is a different question and gets its own
 * answer rather than being folded into the first.
 */
export interface CredentialsCheck {
  ok: boolean;
  /** Present-or-not, per credential. Never the value. */
  present: Record<string, boolean>;
  missing: string[];
}

export interface HealthReport {
  status: "healthy" | "unhealthy";
  checks: {
    db: DbCheck;
    ttlSweep: TtlSweepCheck;
    credentials: CredentialsCheck;
  };
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
 * What a day generation needs, and what happens without each.
 *
 * Named here rather than derived from a grep, because `ANTHROPIC_API_KEY` is
 * invisible to a grep — the SDK resolves it — and a list that only contains
 * what a grep can find would have missed the exact key that broke production.
 */
const GENERATION_CREDENTIALS: readonly { name: string; without: string }[] = [
  {
    name: "ANTHROPIC_API_KEY",
    without: "no selection and no narration — every generation fails",
  },
  {
    name: "GOOGLE_MAPS_API_KEY",
    without: "no Details, no links, no transit — days ship on honest absence",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    without: "no pool at all",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    without: "no pool at all",
  },
];

/**
 * Presence, never value. `Boolean(process.env.X)` treats an empty string as
 * absent, which is correct: a variable set to "" is a variable that will fail
 * at the first call, and reporting it present would be the false-healthy this
 * check exists to end.
 */
export function checkCredentials(
  env: Record<string, string | undefined> = process.env,
): CredentialsCheck {
  const present: Record<string, boolean> = {};
  const missing: string[] = [];
  for (const credential of GENERATION_CREDENTIALS) {
    const ok = Boolean(env[credential.name]);
    present[credential.name] = ok;
    if (!ok) missing.push(credential.name);
  }
  return { ok: missing.length === 0, present, missing };
}

/**
 * Checks Supabase connectivity and records the check itself as a trace
 * (proof-of-life for the instrumentation scaffolding, XXX-14).
 *
 * `client` is injectable for tests; production callers pass nothing.
 */
export async function checkHealth(
  client?: SupabaseClient,
  /** Injectable for tests, exactly as `client` is. Production passes nothing. */
  env: Record<string, string | undefined> = process.env,
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
    await warnIfWeatherStale(supabase, warnings);
  }

  const credentials = checkCredentials(env);
  for (const name of credentials.missing) {
    const spec = GENERATION_CREDENTIALS.find((c) => c.name === name);
    warnings.push({
      code: "credential_missing",
      message: `${name} is not set — ${spec?.without ?? "the generation path is degraded"}.`,
    });
  }

  if (supabase) {
    await recordHealthTrace(supabase, db);
  }

  const sha = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return {
    /**
     * A deployment that cannot generate is not healthy, whatever the database
     * says. Folding this into the verdict rather than leaving it a warning is
     * the whole point: Production ran for a day reporting healthy with no
     * Anthropic key, and a warning nobody was paged on would have done the
     * same.
     */
    status: db.ok && ttlSweep.ok && credentials.ok ? "healthy" : "unhealthy",
    checks: { db, ttlSweep, credentials },
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
 * Weather staleness is a WARNING, never a 503 (Checkpoint 1 ruling 5):
 * stale weather is product-degrading but honest — rows carry fetched_at and
 * generation degrades gracefully — while 503 is reserved for the compliance
 * sweep. 48h = two missed daily runs.
 */
const WEATHER_MAX_AGE_HOURS = 48;

async function warnIfWeatherStale(
  supabase: SupabaseClient,
  warnings: HealthWarning[],
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("traces")
      .select("started_at")
      .eq("kind", "weather_ingest")
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) {
      warnings.push({
        code: "weather_stale",
        message: `weather_ingest trace lookup failed: ${error.message}`,
      });
      return;
    }
    const latest = data?.[0];
    if (!latest) {
      warnings.push({
        code: "weather_stale",
        message: "no weather_ingest trace exists — weather has never been ingested",
      });
      return;
    }
    const ageHours =
      (Date.now() - new Date(latest.started_at as string).getTime()) /
      3_600_000;
    if (ageHours > WEATHER_MAX_AGE_HOURS) {
      warnings.push({
        code: "weather_stale",
        message: `latest weather_ingest is ${Math.round(ageHours)}h old (limit ${WEATHER_MAX_AGE_HOURS}h) — run: npx tsx scripts/ingest-weather.ts`,
      });
    }
  } catch (err) {
    warnings.push({
      code: "weather_stale",
      message: err instanceof Error ? err.message : String(err),
    });
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
