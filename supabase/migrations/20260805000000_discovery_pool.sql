-- XXX-22: Google Places discovery pool (design: docs/decisions/001, SESSION_NOTES Step 2).
--
-- ToS-constrained storage (decision doc 001, Checkpoint 1 rulings):
--   * google_place_id  — storable indefinitely (SST §3; refresh yearly, free).
--   * lat/lng          — storable for 30 consecutive calendar days (SST §14.3),
--                        then the VALUES must be deleted. The row survives;
--                        coords_status records the honest 'expired' state.
--   * everything else Google returns is never persisted. Durable identity
--     (name/address) arrives from the base layer (FSQ/OSM/founder) next
--     session; E1 `places` is untouched by this migration.
--
-- Both tables are SERVER-ONLY: RLS enabled with ZERO policies, same posture
-- as traces/trace_events. Only the service-role client may touch them; no
-- client-facing policy is planned (XXX-17 scope excludes the discovery pool).

-- discovered_places — one row per distinct Google place surfaced by discovery.
create table discovered_places (
  id                  uuid primary key default gen_random_uuid(),
  city                text not null,
  google_place_id     text not null,
  -- Google content under the 30-day grant. NULL when absent or expired.
  lat                 double precision,
  lng                 double precision,
  -- Discriminated coord state, not a boolean:
  --   'present'          coords held, clock running from coords_fetched_at
  --   'absent_at_source' we looked, Google returned no location (honest absence)
  --   'expired'          30-day window elapsed; values deleted, row retained
  coords_status       text not null,
  -- Starts the 30-day clock. Stays populated on 'expired' (when we last knew);
  -- NULL on 'absent_at_source' (never knew).
  coords_fetched_at   timestamptz,
  -- Provenance of the Google-sourced content in this row (constraint 2).
  source              text not null,
  tier                smallint not null,
  first_discovered_at timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Named so upserts are unambiguous (v1 ON CONFLICT lesson); supabase-js
  -- targets the same uniqueness via onConflict: 'google_place_id'.
  constraint discovered_places_google_place_id_unique unique (google_place_id),
  constraint discovered_places_coords_status_valid check (
    coords_status in ('present', 'absent_at_source', 'expired')
  ),
  -- Coordinates are a verified API observation.
  constraint discovered_places_tier_valid check (tier = 1),
  constraint discovered_places_coords_match_status check (
    (coords_status = 'present'
       and lat is not null and lng is not null and coords_fetched_at is not null)
    or (coords_status = 'absent_at_source'
       and lat is null and lng is null and coords_fetched_at is null)
    or (coords_status = 'expired'
       and lat is null and lng is null and coords_fetched_at is not null)
  )
);

-- The XXX-25 expiry sweep scans exactly this predicate.
create index discovered_places_coords_expiry_idx
  on discovered_places (coords_fetched_at)
  where coords_status = 'present';
create index discovered_places_city_idx on discovered_places (city);

comment on table discovered_places is
  'Google Places discovery pool (XXX-22). Stores ONLY ToS-permitted content: '
  'place_id (indefinite) and lat/lng (30-day TTL; XXX-25 sweep deletes values '
  'on expiry, flipping coords_status to ''expired''). Server-only: RLS '
  'enabled, zero policies, by design.';
comment on column discovered_places.coords_fetched_at is
  '30-day retention clock (SST §14.3). Readers must treat rows older than 30 '
  'days as expired even before the sweep runs.';

-- discovery_hits — append-only log of which of OUR queries surfaced which
-- place. This is our request metadata, not Google Maps Content; it is the
-- durable per-category/per-anchor signal (Checkpoint 4 statistics, later the
-- rank model's coverage input).
create table discovery_hits (
  id                  uuid primary key default gen_random_uuid(),
  discovered_place_id uuid not null
    references discovered_places (id) on delete cascade,
  category            text not null,
  anchor              text not null,
  result_rank         smallint not null,
  -- Joins pool statistics to the run's cost trace, forever (Checkpoint 2
  -- addition: per-category counts and spend must stay joinable).
  trace_id            uuid references traces (id) on delete set null,
  discovered_at       timestamptz not null,
  created_at          timestamptz not null default now(),

  constraint discovery_hits_place_query_unique
    unique (discovered_place_id, category, anchor),
  constraint discovery_hits_result_rank_valid check (result_rank >= 1)
);

create index discovery_hits_category_anchor_idx
  on discovery_hits (category, anchor);
create index discovery_hits_trace_idx on discovery_hits (trace_id);

comment on table discovery_hits is
  'Which (category x anchor) discovery query surfaced which place — our own '
  'request metadata, joinable to the run''s cost trace via trace_id. '
  'Server-only: RLS enabled, zero policies, by design.';

create trigger discovered_places_set_updated_at before update on discovered_places
  for each row execute function extensions.moddatetime (updated_at);

-- Server-only posture: RLS on, no policies now or planned for these tables.
alter table discovered_places enable row level security;
alter table discovery_hits enable row level security;
