-- XXX-24: bounded travel-time matrix (decision doc 003, ratified at
-- Checkpoint 1, 2026-08-07).
--
-- The constraints in this table ARE the doc's rulings, translated so the
-- prohibited states are unrepresentable rather than merely documented:
--
--   * source whitelist — Google Routes durations have no caching grant
--     (SST §19.3 covers lat/lng only), so a 'google_routes' row is a
--     constraint violation, not a policy breach. Transit answers from
--     Google live and die inside one generation, in memory.
--   * ORS rows are walk/cycle/drive only (ORS offers no transit) and
--     must carry their CC-BY-SA-4.0 license mark — the stored matrix is
--     licensed content (HeiGIT ToS: "Results obtained from
--     openrouteservice in any context are licensed under CC-BY-SA 4.0")
--     and must stay identifiable and separable. This table is the
--     bounded container; ORS-derived rows never migrate into `places`
--     or `facts`.
--   * founder_measured rows are our own tier-1 observations (any mode,
--     including transit — the golden-set lived estimates).
--   * the pair ceiling — doc 003's ODbL analysis clears storage at
--     golden-set/cluster scale only. 1,000 distinct directed pairs per
--     city, enforced by trigger with RAISE EXCEPTION. There is no
--     override flag by explicit Checkpoint 1 ruling: breaching the
--     ceiling requires a new decision pass, not a config change.
--
-- No time-of-day buckets: ORS routing has no traffic dimension, and the
-- source that would need buckets (transit) is unstorable from Google.
-- Buckets return with a future GTFS-computed transit build (doc 003 §4).

create table travel_times (
  id               uuid primary key default gen_random_uuid(),
  city             text not null,
  origin_label     text not null,
  origin_lat       double precision not null,
  origin_lng       double precision not null,
  dest_label       text not null,
  dest_lat         double precision not null,
  dest_lng         double precision not null,
  mode             text not null,
  duration_minutes integer not null,
  distance_km      double precision,
  source           text not null,
  tier             smallint not null,
  -- License of the row's value as content. 'CC-BY-SA-4.0' for ORS rows
  -- (mandatory, checked); null for founder rows (our own observations).
  license          text,
  fetched_at       timestamptz not null,
  trace_id         uuid references traces (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint travel_times_mode_valid
    check (mode in ('walk', 'cycle', 'drive', 'transit')),
  constraint travel_times_source_whitelist
    check (source in ('ors_hosted', 'founder_measured')),
  constraint travel_times_ors_no_transit
    check (source <> 'ors_hosted' or mode in ('walk', 'cycle', 'drive')),
  constraint travel_times_ors_license_marked
    check (source <> 'ors_hosted' or license = 'CC-BY-SA-4.0'),
  constraint travel_times_tier_valid
    check (tier in (1, 2, 3)),
  constraint travel_times_duration_nonnegative
    check (duration_minutes >= 0),

  -- Source is part of the key: a founder row and an ORS row for the same
  -- directed pair + mode coexist, and reads prefer tier 1 (founder
  -- shadows engine — Checkpoint 2 ruling).
  constraint travel_times_pair_mode_source_unique
    unique (city, origin_lat, origin_lng, dest_lat, dest_lng, mode, source)
);

comment on table travel_times is
  'Bounded travel-time matrix (decision doc 003). ORS rows are CC-BY-SA-4.0 licensed content: attribution "© openrouteservice by HeiGIT | Data from OpenStreetMap" required on display; never merge into places/facts; no ML training on these rows. Hard ceiling 1,000 distinct directed pairs per city (trigger). Google Routes durations are unstorable here by constraint, deliberately.';

create index travel_times_city_idx on travel_times (city);

-- The doc-003 ceiling. Counts distinct directed coordinate pairs per
-- city; a row for an already-stored pair (new mode, new source, or a
-- refresh) always passes. No override parameter exists on purpose.
create or replace function travel_times_enforce_pair_ceiling()
returns trigger
language plpgsql
as $$
declare
  pair_count integer;
  pair_exists boolean;
begin
  select exists (
    select 1 from travel_times
    where city = new.city
      and origin_lat = new.origin_lat
      and origin_lng = new.origin_lng
      and dest_lat  = new.dest_lat
      and dest_lng  = new.dest_lng
  ) into pair_exists;

  if pair_exists then
    return new;
  end if;

  select count(distinct (origin_lat, origin_lng, dest_lat, dest_lng))
    into pair_count
    from travel_times
    where city = new.city;

  if pair_count >= 1000 then
    raise exception
      'travel_times: city % already holds % distinct directed pairs — decision doc 003 ceiling (1,000/city). A new decision pass is required; no override exists.',
      new.city, pair_count;
  end if;

  return new;
end;
$$;

create trigger travel_times_pair_ceiling
  before insert or update on travel_times
  for each row
  execute function travel_times_enforce_pair_ceiling();

-- Server-only table, house posture: RLS on, zero policies.
alter table travel_times enable row level security;
