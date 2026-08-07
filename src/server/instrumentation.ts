import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Instrumentation scaffolding (XXX-14).
 *
 * Every external call that costs money or time is logged as a trace_event
 * under a trace. Latency budgets (first cards < 3s, full day < 15s) are
 * measured against traces.first_card_ms / traces.full_day_ms.
 *
 * Failures here must never break the request being traced — callers wrap
 * trace recording and degrade gracefully (see recordHealthTrace in health.ts).
 */

export type TraceKind =
  | "health_check"
  | "places_discovery"
  | "base_layer_ingest"
  | "identity_matching"
  // "ttl_sweep" is written by sweep_expired_coords() in SQL (migration
  // 20260806200000), not through this module — listed in the union so
  // readers (health checks, reports) share one vocabulary of kinds.
  | "ttl_sweep"
  | "weather_ingest";

export interface TraceEvent {
  provider: string;
  endpoint: string;
  /** Estimated cost in USD. 0 means "known to be free"; omit when unknown. */
  estCostUsd?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TraceSummary {
  totalCostUsd?: number;
  firstCardMs?: number;
  fullDayMs?: number;
  metadata?: Record<string, unknown>;
}

export interface Instrumentation {
  startTrace(kind: TraceKind): Promise<string>;
  logEvent(traceId: string, event: TraceEvent): Promise<void>;
  endTrace(traceId: string, summary?: TraceSummary): Promise<void>;
}

export function createInstrumentation(client: SupabaseClient): Instrumentation {
  return {
    async startTrace(kind) {
      const { data, error } = await client
        .from("traces")
        .insert({ kind })
        .select("id")
        .single();
      if (error) throw new Error(`startTrace failed: ${error.message}`);
      return data.id;
    },

    async logEvent(traceId, event) {
      const { error } = await client.from("trace_events").insert({
        trace_id: traceId,
        provider: event.provider,
        endpoint: event.endpoint,
        est_cost_usd: event.estCostUsd ?? null,
        duration_ms: event.durationMs ?? null,
        metadata: event.metadata ?? {},
      });
      if (error) throw new Error(`logEvent failed: ${error.message}`);
    },

    async endTrace(traceId, summary = {}) {
      const { error } = await client
        .from("traces")
        .update({
          finished_at: new Date().toISOString(),
          total_cost_usd: summary.totalCostUsd ?? null,
          first_card_ms: summary.firstCardMs ?? null,
          full_day_ms: summary.fullDayMs ?? null,
          ...(summary.metadata !== undefined
            ? { metadata: summary.metadata }
            : {}),
        })
        .eq("id", traceId);
      if (error) throw new Error(`endTrace failed: ${error.message}`);
    },
  };
}
