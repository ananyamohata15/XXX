-- XXX-38 / XXX-40: city-scoped facts (Session 14 CHECKPOINT 0 ruling 3).
--
-- The third fact grain in the system, and it exists because the other two
-- cannot hold a ferry timetable:
--
--   facts        place-grain  (place_id NOT NULL) — a route is not a place
--   weather_days city-DATE    — a timetable is seasonal, not per-day
--   city_facts   city × kind × subject  <- this
--
-- Golden Day 7's schedule is a fact about a ROUTE ("ferry:hanlans"), valid
-- across a season, owned by the city rather than by any venue. Storing it on
-- a place would have meant inventing a place; storing it per-date would have
-- meant 125 identical rows for one summer.
--
-- PROVENANCE LAW APPLIES IN FULL (constraint 2, no exception for seed data):
-- source, tier and fetched_at are all NOT NULL. The first tenant enters
-- through the founder channel — the timetable was fetched from toronto.ca on
-- 2026-08-15 and red-penned by the founder, which is unconditional tier 1
-- operator trust (comment 10289).
--
-- SEASONAL VALIDITY IS THE POINT, not a convenience column. Golden Day 7's
-- own trap list says so: "WINTER = Ward's route ONLY — Hanlan's runs
-- mid-Apr–mid-Oct, so this day is SEASONALLY INVALID Nov–Mar on the ferry
-- itself, not just the beach". A theme whose route has no valid row for the
-- date is INFEASIBLE, and the engine must fail honestly rather than quietly
-- compose a day without the boat.
--
-- XXX-39's automated civic KB inherits this shape unchanged: it adds rows
-- with a different `source` and a lower `tier`, and nothing else moves. Its
-- licensing addendum is still pending, which is why nothing automated writes
-- here yet.
--
-- Server-only: RLS enabled with zero policies, house posture.

create table city_facts (
  id          uuid primary key default gen_random_uuid(),
  city        text not null,
  -- What KIND of fact this is: 'ferry_timetable'. Deliberately not an enum —
  -- a check constraint would need a migration per civic-KB fact class, and
  -- XXX-39 is expected to add several.
  fact_kind   text not null,
  -- WHICH subject within the kind: a route or mode key, e.g. 'ferry:hanlans'.
  subject_key text not null,
  value       jsonb not null,
  source      text not null,
  tier        smallint not null,
  fetched_at  timestamptz not null,
  -- Inclusive season bounds. NULL/NULL = valid always (a fact with no season,
  -- which an all-year route legitimately is). Honest absence, not a default.
  valid_from  date,
  valid_to    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Named so upserts write: on conflict (city, fact_kind, subject_key,
  -- valid_from). One subject may hold several seasons — Hanlan's summer
  -- schedule and Ward's winter schedule are different rows, not a merge.
  constraint city_facts_subject_season_unique
    unique (city, fact_kind, subject_key, valid_from),
  constraint city_facts_tier_valid check (tier in (1, 2, 3)),
  constraint city_facts_value_not_null_json
    check (jsonb_typeof(value) <> 'null'),
  -- A season is either fully open or a real interval. A half-stated season
  -- would read as "valid from May, forever", which is the silent-default
  -- failure constraint 4 forbids.
  constraint city_facts_season_well_formed check (
    (valid_from is null and valid_to is null) or
    (valid_from is not null and valid_to is not null and valid_to >= valid_from)
  )
);

create index city_facts_lookup
  on city_facts (city, fact_kind, subject_key);

create trigger city_facts_set_updated_at
  before update on city_facts
  for each row execute function extensions.moddatetime (updated_at);

alter table city_facts enable row level security;
