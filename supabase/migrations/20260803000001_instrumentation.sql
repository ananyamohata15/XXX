-- XXX-14: instrumentation scaffolding — traces and trace_events.
--
-- Cost model
-- ----------
-- Every user-facing generation (and every background job that spends money
-- or time) runs under exactly one trace. Each external call made during that
-- trace — Anthropic, Google Places, Google Routes, OpenRouteService,
-- Open-Meteo, Supabase itself — is one trace_event carrying:
--
--   * est_cost_usd: the caller's estimate of that single call's marginal
--     cost in USD, computed at call time from the provider's published
--     pricing (e.g. tokens x per-token rate for Anthropic, per-request SKU
--     rate for Places). 0 means "known to be free" (Open-Meteo, Supabase
--     queries). NULL means "cost unknown" — honest absence, never guessed.
--   * duration_ms: wall-clock time of the call, NULL if it could not be
--     measured.
--
-- traces.total_cost_usd is the caller-computed sum of its events' estimates
-- (denormalized at endTrace time so dashboards never need to aggregate).
-- traces.first_card_ms / full_day_ms record the two latency budgets from
-- CLAUDE.md (first cards < 3s, full day < 15s); NULL for trace kinds where
-- the budget does not apply (e.g. health_check).
--
-- These are estimates for budgeting and alerting, not billing records —
-- provider invoices remain the source of truth for actual spend.

create table traces (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_cost_usd numeric(10, 6),
  first_card_ms integer,
  full_day_ms integer,
  metadata jsonb not null default '{}'::jsonb
);

create table trace_events (
  id bigint generated always as identity primary key,
  trace_id uuid not null references traces (id) on delete cascade,
  provider text not null,
  endpoint text not null,
  est_cost_usd numeric(10, 6),
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index trace_events_trace_id_idx on trace_events (trace_id);
create index traces_kind_started_at_idx on traces (kind, started_at desc);

-- Server-only tables: written via the service-role key from src/server.
-- RLS enabled with no policies = no anon/authenticated access at all.
alter table traces enable row level security;
alter table trace_events enable row level security;
