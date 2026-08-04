import { describe, expect, it } from "vitest";
import { createInstrumentation } from "@/server/instrumentation";
import { createFakeSupabase } from "./fixtures/fake-supabase";

describe("instrumentation (XXX-14)", () => {
  it("startTrace inserts a traces row and returns its id", async () => {
    const fake = createFakeSupabase();
    const instrumentation = createInstrumentation(fake.client);

    const traceId = await instrumentation.startTrace("health_check");

    expect(traceId).toBeTruthy();
    expect(fake.inserts).toEqual([
      { table: "traces", row: { kind: "health_check" } },
    ]);
  });

  it("logEvent inserts a trace_events row with snake_case columns and honest nulls", async () => {
    const fake = createFakeSupabase();
    const instrumentation = createInstrumentation(fake.client);

    await instrumentation.logEvent("trace-1", {
      provider: "google_places",
      endpoint: "places.searchText",
      estCostUsd: 0.017,
      durationMs: 240,
      metadata: { fieldMask: "places.id" },
    });
    await instrumentation.logEvent("trace-1", {
      provider: "open_meteo",
      endpoint: "forecast",
      // cost/duration intentionally omitted: unknown, stored as null
    });

    expect(fake.inserts).toEqual([
      {
        table: "trace_events",
        row: {
          trace_id: "trace-1",
          provider: "google_places",
          endpoint: "places.searchText",
          est_cost_usd: 0.017,
          duration_ms: 240,
          metadata: { fieldMask: "places.id" },
        },
      },
      {
        table: "trace_events",
        row: {
          trace_id: "trace-1",
          provider: "open_meteo",
          endpoint: "forecast",
          est_cost_usd: null,
          duration_ms: null,
          metadata: {},
        },
      },
    ]);
  });

  it("endTrace sets finished_at and summary fields on the trace row", async () => {
    const fake = createFakeSupabase();
    const instrumentation = createInstrumentation(fake.client);

    await instrumentation.endTrace("trace-1", {
      totalCostUsd: 0.02,
      firstCardMs: 1200,
      fullDayMs: 9000,
    });

    expect(fake.updates).toHaveLength(1);
    const update = fake.updates[0];
    expect(update.table).toBe("traces");
    expect(update.eq).toEqual(["id", "trace-1"]);
    expect(update.patch.total_cost_usd).toBe(0.02);
    expect(update.patch.first_card_ms).toBe(1200);
    expect(update.patch.full_day_ms).toBe(9000);
    expect(update.patch.finished_at).toEqual(expect.any(String));
  });

  it("surfaces Supabase errors loudly instead of swallowing them", async () => {
    const fake = createFakeSupabase({ failWith: "connection refused" });
    const instrumentation = createInstrumentation(fake.client);

    await expect(instrumentation.startTrace("health_check")).rejects.toThrow(
      "startTrace failed: connection refused",
    );
    await expect(
      instrumentation.logEvent("trace-1", { provider: "x", endpoint: "y" }),
    ).rejects.toThrow("logEvent failed: connection refused");
    await expect(instrumentation.endTrace("trace-1")).rejects.toThrow(
      "endTrace failed: connection refused",
    );
  });
});
