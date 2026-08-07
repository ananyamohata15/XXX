-- XXX-23: weather + AQI city-date facts (Session 6 Step 1 §1.4,
-- Checkpoint 1 ruling 4).
--
-- NOT rows in `facts`: that table is place-grain (place_id NOT NULL) by
-- design. weather_days is the single owner of city-date weather
-- observations, with the house provenance vocabulary (source/tier/
-- fetched_at) and per-payload honest-absence unions: the AQI horizon (~5d)
-- is shorter than the forecast horizon (14d), so most dates legitimately
-- carry forecast without air quality.
--
-- Data license: Open-Meteo serves data under CC BY 4.0 (verified live
-- 2026-08-06) — storage and derived works expressly permitted with
-- attribution (credits surface). No retention ceiling; no sweep. Past
-- dates freeze at last fetch and are last-forecast, NOT observed actuals.
--
-- Derived scheduling windows are computed at read time
-- (src/shared/scheduling-windows.ts) and never stored here.
--
-- Server-only: RLS enabled with zero policies, house posture.

create table weather_days (
  id                 uuid primary key default gen_random_uuid(),
  city               text not null,
  date               date not null,
  -- IANA timezone the payload's local times live in (America/Toronto).
  timezone           text not null,
  forecast_status    text not null,
  forecast           jsonb,
  air_quality_status text not null,
  air_quality        jsonb,
  source             text not null,
  tier               smallint not null,
  fetched_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Named so upserts write: on conflict (city, date). Full-row clobber is
  -- the correct semantics here — each fetch supersedes the forecast.
  constraint weather_days_city_date_unique unique (city, date),
  constraint weather_days_forecast_status_valid
    check (forecast_status in ('present', 'absent')),
  constraint weather_days_air_quality_status_valid
    check (air_quality_status in ('present', 'absent')),
  constraint weather_days_forecast_matches_status check (
    (forecast_status = 'present' and forecast is not null
       and jsonb_typeof(forecast) <> 'null') or
    (forecast_status = 'absent' and forecast is null)
  ),
  constraint weather_days_air_quality_matches_status check (
    (air_quality_status = 'present' and air_quality is not null
       and jsonb_typeof(air_quality) <> 'null') or
    (air_quality_status = 'absent' and air_quality is null)
  ),
  -- Live API answer fetched at a known time = tier 1 Verified (forecast
  -- uncertainty is a property of the value, not the provenance chain).
  constraint weather_days_tier_valid check (tier = 1)
);

create trigger weather_days_set_updated_at
  before update on weather_days
  for each row execute function extensions.moddatetime (updated_at);

alter table weather_days enable row level security;
