import { describe, expect, it } from "vitest";
import { checkHealth } from "@/server/health";
import { createFakeSupabase } from "./fixtures/fake-supabase";

/** A ttl_sweep trace row as the health check reads it. */
function sweepTrace(ageMinutes: number, metadata: Record<string, unknown> = {}) {
  return {
    kind: "ttl_sweep",
    started_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
    metadata: { rows_examined: 760, rows_expired: 0, expiring_within_7d: 0, ...metadata },
  };
}

/** A weather_ingest trace row as the staleness warning reads it. */
function weatherTrace(ageHours: number) {
  return {
    kind: "weather_ingest",
    started_at: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
    metadata: {},
  };
}

describe("health service (XXX-12 / XXX-14 proof-of-life)", () => {
  it("reports healthy and records a trace with one event when the db responds", async () => {
    const fake = createFakeSupabase({
      rows: { traces: [sweepTrace(30), weatherTrace(2)] },
    });

    const report = await checkHealth(fake.client);

    expect(report.status).toBe("healthy");
    expect(report.checks.db.ok).toBe(true);
    expect(report.checks.db.error).toBeNull();
    expect(report.checks.db.latencyMs).toEqual(expect.any(Number));
    expect(report.warnings).toEqual([]);
    expect(report.version).toBeTruthy();
    expect(new Date(report.timestamp).getTime()).not.toBeNaN();

    // Proof-of-life: the health check itself produced one trace + one event.
    const traceInserts = fake.inserts.filter((i) => i.table === "traces");
    const eventInserts = fake.inserts.filter((i) => i.table === "trace_events");
    expect(traceInserts).toEqual([
      { table: "traces", row: { kind: "health_check" } },
    ]);
    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0].row.provider).toBe("supabase");
    expect(eventInserts[0].row.est_cost_usd).toBe(0);
    expect(fake.updates).toHaveLength(1); // endTrace closed the trace
  });

  it("reports unhealthy with the db error, and the failed trace does not throw", async () => {
    const fake = createFakeSupabase({ failWith: "connection refused" });

    const report = await checkHealth(fake.client);

    expect(report.status).toBe("unhealthy");
    expect(report.checks.db.ok).toBe(false);
    expect(report.checks.db.error).toBe("connection refused");
    expect(fake.inserts).toHaveLength(0);
  });
});

describe("ttl-sweep recency check (XXX-25 absence-based alerting)", () => {
  it("is unhealthy when no ttl_sweep trace exists (sweep never ran / schedule dead)", async () => {
    const fake = createFakeSupabase({ rows: { traces: [] } });

    const report = await checkHealth(fake.client);

    expect(report.checks.db.ok).toBe(true);
    expect(report.checks.ttlSweep.ok).toBe(false);
    expect(report.checks.ttlSweep.lastRunAt).toBeNull();
    expect(report.checks.ttlSweep.error).toMatch(/never run|schedule is dead/);
    expect(report.status).toBe("unhealthy");
  });

  it("is unhealthy when the latest ttl_sweep trace is older than 2 hours", async () => {
    const fake = createFakeSupabase({
      rows: { traces: [sweepTrace(121)] },
    });

    const report = await checkHealth(fake.client);

    expect(report.checks.ttlSweep.ok).toBe(false);
    expect(report.checks.ttlSweep.ageMinutes).toBeGreaterThan(120);
    expect(report.checks.ttlSweep.error).toMatch(/121 min old/);
    expect(report.status).toBe("unhealthy");
  });

  it("picks the newest trace when several exist", async () => {
    const fake = createFakeSupabase({
      rows: { traces: [sweepTrace(300), sweepTrace(10), sweepTrace(180), weatherTrace(2)] },
    });

    const report = await checkHealth(fake.client);

    expect(report.checks.ttlSweep.ok).toBe(true);
    expect(report.checks.ttlSweep.ageMinutes).toBe(10);
    expect(report.status).toBe("healthy");
  });

  it("surfaces the coords_expiring warning without going unhealthy", async () => {
    const fake = createFakeSupabase({
      rows: { traces: [sweepTrace(5, { expiring_within_7d: 412 }), weatherTrace(2)] },
    });

    const report = await checkHealth(fake.client);

    expect(report.status).toBe("healthy"); // a to-do, not an outage
    expect(report.warnings).toEqual([
      {
        code: "coords_expiring",
        message: expect.stringContaining("412 coordinates expire within 7 days"),
      },
    ]);
  });
});

describe("weather staleness warning (XXX-23, severity tiering: warning not 503)", () => {
  it("warns when the latest weather_ingest is older than 48h — status stays healthy", async () => {
    const fake = createFakeSupabase({
      rows: { traces: [sweepTrace(30), weatherTrace(50)] },
    });

    const report = await checkHealth(fake.client);

    expect(report.status).toBe("healthy");
    expect(report.warnings).toEqual([
      {
        code: "weather_stale",
        message: expect.stringContaining("50h old"),
      },
    ]);
  });

  it("warns when weather has never been ingested — status stays healthy", async () => {
    const fake = createFakeSupabase({
      rows: { traces: [sweepTrace(30)] },
    });

    const report = await checkHealth(fake.client);

    expect(report.status).toBe("healthy");
    expect(report.warnings).toEqual([
      {
        code: "weather_stale",
        message: expect.stringContaining("never been ingested"),
      },
    ]);
  });
});
