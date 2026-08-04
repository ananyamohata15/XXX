import { describe, expect, it } from "vitest";
import { checkHealth } from "@/server/health";
import { createFakeSupabase } from "./fixtures/fake-supabase";

describe("health service (XXX-12 / XXX-14 proof-of-life)", () => {
  it("reports healthy and records a trace with one event when the db responds", async () => {
    const fake = createFakeSupabase();

    const report = await checkHealth(fake.client);

    expect(report.status).toBe("healthy");
    expect(report.checks.db.ok).toBe(true);
    expect(report.checks.db.error).toBeNull();
    expect(report.checks.db.latencyMs).toEqual(expect.any(Number));
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
