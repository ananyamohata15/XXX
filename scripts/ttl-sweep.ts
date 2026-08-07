import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  expiresWithinDays,
  sweepWouldExpire,
  type SweepPredicateRow,
} from "../src/server/discovery/ttl";

/**
 * XXX-25 TTL sweep operations (Session 6 Step 2). The sweep itself is the
 * SQL function sweep_expired_coords() scheduled hourly by pg_cron
 * (migration 20260806200000); this script exists to invoke, inspect, and
 * prove it — every mode is an evidence-producing repo script per the
 * Session 5 standing rule.
 *
 * Usage: npx tsx --env-file <env> scripts/ttl-sweep.ts <mode>
 *   --status            counts by coords_status (fixture rows split out),
 *                       sweep-predicate preview, latest ttl_sweep traces
 *   --run-once          invoke sweep_expired_coords() via RPC, print the
 *                       resulting trace
 *   --insert-synthetic  insert one fixture row backdated 31 days (the live
 *                       proof row; source='fixture', unmistakable place id)
 *   --delete-synthetic  remove synthetic probe rows
 *   --cron-status       show cron.job + recent run details for 'ttl-sweep'
 *                       (management API; needs SUPABASE_ACCESS_TOKEN +
 *                       SUPABASE_PROJECT_REF)
 *   --cron-set <expr>   reschedule the job (observation aid; final state
 *                       must match the migration: '7 * * * *')
 */

const SYNTHETIC_PREFIX = "SYNTHETIC-TTL-PROBE-";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function makeClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

interface StatusRow extends SweepPredicateRow {
  source: string;
}

async function selectAllStatusRows(client: SupabaseClient): Promise<StatusRow[]> {
  const pageSize = 1000;
  const all: StatusRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await client
      .from("discovered_places")
      .select("coords_status, coords_fetched_at, source")
      .order("id")
      .range(from, from + pageSize - 1);
    if (page.error) throw new Error(`discovered_places: ${page.error.message}`);
    all.push(...(page.data as StatusRow[]));
    if (page.data.length < pageSize) return all;
  }
}

async function showStatus(client: SupabaseClient): Promise<void> {
  const now = new Date();
  const rows = await selectAllStatusRows(client);
  const real = rows.filter((r) => r.source !== "fixture");
  const fixture = rows.filter((r) => r.source === "fixture");

  const byStatus = (set: StatusRow[]) =>
    set.reduce<Record<string, number>>((acc, r) => {
      acc[r.coords_status] = (acc[r.coords_status] ?? 0) + 1;
      return acc;
    }, {});

  console.log(JSON.stringify({
    now: now.toISOString(),
    real: {
      total: real.length,
      by_status: byStatus(real),
      sweep_would_expire_now: real.filter((r) => sweepWouldExpire(r, now)).length,
      expiring_within_7d: real.filter((r) => expiresWithinDays(r, now, 7)).length,
    },
    fixture: {
      total: fixture.length,
      by_status: byStatus(fixture),
      sweep_would_expire_now: fixture.filter((r) => sweepWouldExpire(r, now)).length,
    },
  }, null, 2));

  const traces = await client
    .from("traces")
    .select("id, kind, started_at, finished_at, metadata")
    .eq("kind", "ttl_sweep")
    .order("started_at", { ascending: false })
    .limit(5);
  if (traces.error) throw new Error(`traces: ${traces.error.message}`);
  console.log("latest ttl_sweep traces (newest first):");
  console.log(JSON.stringify(traces.data, null, 2));
}

async function runOnce(client: SupabaseClient): Promise<void> {
  const { error } = await client.rpc("sweep_expired_coords");
  if (error) throw new Error(`sweep_expired_coords RPC failed: ${error.message}`);
  const trace = await client
    .from("traces")
    .select("id, kind, started_at, finished_at, total_cost_usd, metadata")
    .eq("kind", "ttl_sweep")
    .order("started_at", { ascending: false })
    .limit(1);
  if (trace.error) throw new Error(`traces: ${trace.error.message}`);
  console.log("sweep ran; resulting trace:");
  console.log(JSON.stringify(trace.data?.[0], null, 2));
}

async function insertSynthetic(client: SupabaseClient): Promise<void> {
  const now = Date.now();
  const backdated = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
  const inserted = await client
    .from("discovered_places")
    .insert({
      city: "toronto",
      google_place_id: `${SYNTHETIC_PREFIX}${now}`,
      lat: 43.0,
      lng: -79.0,
      coords_status: "present",
      coords_fetched_at: backdated,
      source: "fixture", // fixture provenance, clearly marked (constraint 2)
      tier: 1,
      first_discovered_at: backdated,
    })
    .select()
    .single();
  if (inserted.error) {
    throw new Error(`synthetic insert failed: ${inserted.error.message}`);
  }
  console.log("synthetic row inserted (coords_fetched_at backdated 31 days):");
  console.log(JSON.stringify(inserted.data, null, 2));
}

async function deleteSynthetic(client: SupabaseClient): Promise<void> {
  const deleted = await client
    .from("discovered_places")
    .delete()
    .eq("source", "fixture")
    .like("google_place_id", `${SYNTHETIC_PREFIX}%`)
    .select("id, google_place_id, lat, lng, coords_status, coords_fetched_at");
  if (deleted.error) {
    throw new Error(`synthetic delete failed: ${deleted.error.message}`);
  }
  console.log(`deleted ${deleted.data.length} synthetic row(s):`);
  console.log(JSON.stringify(deleted.data, null, 2));
}

/**
 * cron.* tables are not exposed over PostgREST; read them via the Supabase
 * management query API. Read-only except --cron-set, whose only legitimate
 * use is temporarily tightening the schedule to observe a firing.
 */
async function managementQuery(query: string): Promise<unknown> {
  const token = requireEnv("SUPABASE_ACCESS_TOKEN");
  const ref = requireEnv("SUPABASE_PROJECT_REF");
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!res.ok) {
    // Management-API errors may echo request context; keep output terse.
    throw new Error(`management query failed: HTTP ${res.status}`);
  }
  return res.json();
}

async function cronStatus(): Promise<void> {
  const job = await managementQuery(
    "select jobid, jobname, schedule, command, active from cron.job where jobname = 'ttl-sweep'",
  );
  console.log("cron.job:");
  console.log(JSON.stringify(job, null, 2));
  const runs = await managementQuery(
    `select runid, status, return_message, start_time, end_time
       from cron.job_run_details
      where jobid in (select jobid from cron.job where jobname = 'ttl-sweep')
      order by start_time desc limit 5`,
  );
  console.log("cron.job_run_details (newest first):");
  console.log(JSON.stringify(runs, null, 2));
}

async function cronSet(schedule: string): Promise<void> {
  if (!/^[\d*/, -]+$/.test(schedule) || schedule.split(/\s+/).length !== 5) {
    throw new Error(`not a plausible 5-field cron expression: "${schedule}"`);
  }
  const result = await managementQuery(
    `select cron.schedule('ttl-sweep', '${schedule}', $$select public.sweep_expired_coords()$$)`,
  );
  console.log(`rescheduled ttl-sweep to "${schedule}":`);
  console.log(JSON.stringify(result, null, 2));
  if (schedule !== "7 * * * *") {
    console.log("NOTE: temporary cadence — restore '7 * * * *' (the migration's final state) when done observing.");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  switch (mode) {
    case "--status":
      return showStatus(makeClient());
    case "--run-once":
      return runOnce(makeClient());
    case "--insert-synthetic":
      return insertSynthetic(makeClient());
    case "--delete-synthetic":
      return deleteSynthetic(makeClient());
    case "--cron-status":
      return cronStatus();
    case "--cron-set": {
      const expr = argv[1];
      if (!expr) throw new Error("--cron-set requires a cron expression");
      return cronSet(expr);
    }
    default:
      console.error(
        "usage: ttl-sweep.ts --status | --run-once | --insert-synthetic | --delete-synthetic | --cron-status | --cron-set <expr>",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
