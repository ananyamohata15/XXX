-- XXX-15: core domain schema — places, facts, trips, days, slots.
--
-- Purpose
-- -------
-- The five domain entities of the concierge, with provenance-at-creation
-- enforced by the database, not by convention. The LLM never owns facts or
-- structure: facts come from APIs (facts table), structure is produced by
-- the day-grammar validator in code and stored here already-validated. The
-- only AI-owned data in this schema is the slot reason_* group, pinned to
-- Tier 3 by CHECK.
--
-- Ownership boundaries
-- --------------------
--   * places / facts: shared catalog owned by APIs. Zero user columns.
--   * trips: circumstances only (dates, party, transport modes, budget
--     range). user_id is an RLS handle for XXX-17, not identity data.
--     Identity priors (tastes, dietary, mobility) belong to the future
--     profile tables (XXX-16) and must never appear here.
--   * days / slots: the generated plan. days.trace_id links a day to the
--     generation trace that produced it (XXX-14 instrumentation).
--   * slots.reason_*: AI judgment (Tier 3), the only AI-owned data.
--
-- Provenance rule
-- ---------------
-- Every fact-bearing row carries source + tier (1 Verified / 2 Observed /
-- 3 Judgment) + fetched_at, all NOT NULL — including seed and fixture data.
-- On facts, honest absence is three distinct states:
--   * never fetched            -> no row for (place_id, fact_key)
--   * looked, not published    -> status='absent', value NULL, provenance set
--   * known                    -> status='present', value set, provenance set
-- The facts_value_matches_status CHECK keeps the states from blurring.
--
-- NULL semantics (every nullable column, exhaustively)
-- ----------------------------------------------------
--   places.address            NULL = not published / not known (Delhi street
--                             vendor); honest absence at identity level.
--   places.google_place_id    NULL = no Google listing (founder ground-truth
--                             or sparse market). UNIQUE permits many NULLs.
--   facts.value               NULL only when status='absent' (CHECK-enforced).
--   trips.budget_min/_max/_currency
--                             all-NULL (CHECK-enforced trio) = user declined
--                             to state a budget. Unknown, never defaulted.
--   days.trace_id             NULL = not produced by a live generation
--                             (fixture / hand-seeded row).
--   slots.reason_text/_source/_tier/_created_at
--                             all-NULL (CHECK-enforced group) = no judgment
--                             recorded (legitimate for fixtures). When set,
--                             reason_tier is pinned to 3 and reason_source
--                             records the model id (e.g. anthropic:claude-x).
--
-- Deferred by design (recorded, not forgotten)
-- --------------------------------------------
--   * days.status — no current ticket reads one; XXX-18 decides.
--   * expression indexes on fact values (e.g. (value->>'min')::numeric) —
--     wait for the rank model's real query shapes.
--   * slot overlap prevention — day-grammar code owns it for now; the
--     DB-level option is a btree_gist exclusion constraint on
--     (day_id, timerange(start_time, end_time)) if code ever proves
--     insufficient.
--   * slots cannot cross midnight (end_time > start_time) — acceptable
--     until E4 meets late-night itineraries, then revisit.
--   * RLS policies — tables ship RLS-enabled with zero policies (server-only
--     via service role, same posture as traces). XXX-17 adds user policies
--     rooted at trips.user_id only (non-recursive; v1 RLS-recursion lesson).

-- updated_at maintenance. Schema-qualified deliberately (v1 lesson: pgcrypto
-- schema resolution); gen_random_uuid needs no extension on Postgres 17.
create extension if not exists moddatetime with schema extensions;

-- ---------------------------------------------------------------------------
-- places — identity anchor for a physical venue. Volatile attributes live in
-- facts; this row is the identity snapshot, and carries provenance for it.
-- ---------------------------------------------------------------------------
create table places (
  id uuid primary key default gen_random_uuid(),
  city text not null,                 -- slug: toronto / london / new_delhi
  name text not null,
  lat double precision not null,      -- a place we cannot route to cannot be
  lng double precision not null,      -- scheduled: deliberately NOT NULL
  address text,
  google_place_id text,
  source text not null,
  tier smallint not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_google_place_id_unique unique (google_place_id),
  constraint places_tier_valid check (tier in (1, 2, 3))
);

create index places_city_idx on places (city);

-- ---------------------------------------------------------------------------
-- facts — one *current* value per (place, fact_key), upserted by refresh.
-- fact_key is free text; the key registry is Zod-per-key in code (a DB CHECK
-- would force a migration every time the refresh pipeline learns a key).
-- Price payloads are always ranges: {"min":200,"max":600,"currency":"INR"};
-- a point price is min = max. Fetch history is the traces tables' job.
-- ---------------------------------------------------------------------------
create table facts (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places (id) on delete cascade,
  fact_key text not null,
  status text not null,
  value jsonb,
  source text not null,
  tier smallint not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- named so upserts write: on conflict on constraint facts_place_key_unique
  constraint facts_place_key_unique unique (place_id, fact_key),
  constraint facts_status_valid check (status in ('present', 'absent')),
  constraint facts_tier_valid check (tier in (1, 2, 3)),
  constraint facts_value_matches_status check (
    (status = 'present' and value is not null
       and jsonb_typeof(value) <> 'null') or
    (status = 'absent'  and value is null)
  )
);

create index facts_key_freshness_idx on facts (fact_key, fetched_at);

-- ---------------------------------------------------------------------------
-- trips — circumstances only. Nothing identity-shaped enters this table.
-- ---------------------------------------------------------------------------
create table trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  city text not null,
  start_date date not null,
  end_date date not null,
  party_size smallint not null,
  transport_modes text[] not null,    -- creation must state modes: no default
  budget_min numeric,
  budget_max numeric,
  budget_currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_dates_ordered check (end_date >= start_date),
  constraint trips_party_size_positive check (party_size >= 1),
  constraint trips_transport_modes_valid check (
    cardinality(transport_modes) > 0
    and transport_modes <@ array['walk', 'cycle', 'drive', 'transit']
  ),
  constraint trips_budget_all_or_none check (
    (budget_min is not null and budget_max is not null
       and budget_currency is not null)
    or
    (budget_min is null and budget_max is null and budget_currency is null)
  ),
  constraint trips_budget_range_ordered check (
    budget_min is null or budget_max >= budget_min
  ),
  constraint trips_budget_non_negative check (
    budget_min is null or budget_min >= 0
  )
);

create index trips_user_id_idx on trips (user_id);

-- ---------------------------------------------------------------------------
-- days — one calendar day of one trip.
-- ---------------------------------------------------------------------------
create table days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  date date not null,
  trace_id uuid references traces (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint days_trip_date_unique unique (trip_id, date)
);

create index days_trip_id_idx on days (trip_id);

-- ---------------------------------------------------------------------------
-- slots — one scheduled unit of a day. Times are local wall-clock in the
-- trip's city (time, not timestamptz — a 13:00 lunch is 13:00 wherever the
-- trip is). Ordering derives from start_time alone — a separate ordinal
-- would be a second owner for sequence and could disagree with the times.
-- origin records who put the slot there: 'concierge' (generated) or 'user'
-- (placed/kept by the user via the timeline) — PO decision, XXX-27.
-- Values are produced and validated by day-grammar code before they get
-- here; the DB enforces only the invariants it can own. place_id is
-- RESTRICT: deleting a place still referenced by an itinerary must fail
-- loudly, never cascade a hole into a user's day.
-- ---------------------------------------------------------------------------
create table slots (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references days (id) on delete cascade,
  origin text not null default 'concierge',
  kind text not null,
  start_time time not null,
  end_time time not null,
  place_id uuid not null references places (id) on delete restrict,
  reason_text text,
  reason_source text,
  reason_tier smallint,
  reason_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slots_day_start_time_unique unique (day_id, start_time),
  constraint slots_origin_valid check (origin in ('concierge', 'user')),
  constraint slots_kind_valid check (kind in ('meal', 'activity')),
  constraint slots_time_interval_valid check (end_time > start_time),
  -- judgment is definitionally Tier 3; NULL passes (no judgment recorded)
  constraint slots_reason_tier_is_judgment check (reason_tier = 3),
  constraint slots_reason_all_or_none check (
    (reason_text is not null and reason_source is not null
       and reason_tier is not null and reason_created_at is not null)
    or
    (reason_text is null and reason_source is null
       and reason_tier is null and reason_created_at is null)
  )
);

create index slots_day_id_idx on slots (day_id);
create index slots_place_id_idx on slots (place_id);

-- ---------------------------------------------------------------------------
-- slot_alternates — ranked runner-up places for a slot. Real FKs rather than
-- a uuid[] so integrity and deletes stay honest. No per-alternate reason
-- today; forward-only add if XXX-18 needs one.
-- ---------------------------------------------------------------------------
create table slot_alternates (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references slots (id) on delete cascade,
  place_id uuid not null references places (id) on delete restrict,
  rank smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slot_alternates_slot_rank_unique unique (slot_id, rank),
  constraint slot_alternates_slot_place_unique unique (slot_id, place_id),
  constraint slot_alternates_rank_positive check (rank >= 1)
);

create index slot_alternates_slot_id_idx on slot_alternates (slot_id);

-- updated_at triggers, one per table.
create trigger places_set_updated_at before update on places
  for each row execute function extensions.moddatetime (updated_at);
create trigger facts_set_updated_at before update on facts
  for each row execute function extensions.moddatetime (updated_at);
create trigger trips_set_updated_at before update on trips
  for each row execute function extensions.moddatetime (updated_at);
create trigger days_set_updated_at before update on days
  for each row execute function extensions.moddatetime (updated_at);
create trigger slots_set_updated_at before update on slots
  for each row execute function extensions.moddatetime (updated_at);
create trigger slot_alternates_set_updated_at before update on slot_alternates
  for each row execute function extensions.moddatetime (updated_at);

-- RLS enabled, zero policies: server-only via service role, same posture as
-- traces. XXX-17 adds real policies (rooted at trips.user_id, non-recursive).
alter table places enable row level security;
alter table facts enable row level security;
alter table trips enable row level security;
alter table days enable row level security;
alter table slots enable row level security;
alter table slot_alternates enable row level security;
