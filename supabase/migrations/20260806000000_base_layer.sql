-- XXX-25 (amended): base layer — durable FSQ identities + discovery matching.
-- Decision docs: 001 (Google storage grants), 002 (FSQ Apache 2.0, OSM
-- deferred by Checkpoint 1 ruling — no OSM shapes exist here).
-- Forward-only.

-- 1. places grows the FSQ identity anchor and dataset-version provenance.
--    fsq_place_id nullable: founder/fixture rows have none. UNIQUE permits
--    multiple NULLs (same pattern as google_place_id).
--    source_version nullable: NULL = the row's source has no version concept
--    (founder_groundtruth, fixture_seed). FSQ rows carry 'dt=YYYY-MM-DD'.
alter table public.places
  add column fsq_place_id text,
  add column source_version text;

alter table public.places
  add constraint places_fsq_place_id_unique unique (fsq_place_id);

comment on column public.places.fsq_place_id is
  'Foursquare OS Places identity anchor (decision 002). Upsert target for base-layer re-ingestion.';
comment on column public.places.source_version is
  'Version of the source dataset the identity snapshot came from (e.g. dt=2026-07-09). NULL = source has no version concept.';

-- 2. identity_matches — one current matching outcome per discovered place.
--    The evidence trail for places.google_place_id links: which discovered
--    place matched which identity, how confidently, by which method+version
--    (Checkpoint 1 ruling 3: score provenance records method+version).
--    Nothing Google-sourced is stored here: candidates jsonb holds OUR fsq
--    place ids + OUR scores only. The compared Google name is discarded in
--    process memory (decision 002 §3).
create table public.identity_matches (
  id uuid primary key default gen_random_uuid(),
  discovered_place_id uuid not null
    references public.discovered_places (id) on delete cascade,
  -- matched_confirmed:   confirm ran, best >= T_high, margin ok -> link written
  -- matched_unconfirmed: reserved cost-shrink state (geometry singleton, no
  --                      confirm call -> no name comparison -> no score).
  --                      Expected zero rows this session (Checkpoint 2).
  -- ambiguous:           confirm ran, mid-band score or margin too small, or
  --                      link collision (duplicate Google listings) -> no link
  -- name_mismatch:       confirm ran, best < T_low -> proximity was
  --                      coincidence (the 77-within-10m lesson) -> no link
  -- no_candidates:       no base-layer row within radius -> no confirm spent
  status text not null,
  place_id uuid references public.places (id) on delete restrict,
  best_score numeric,
  method text,
  candidates jsonb,
  matched_at timestamptz not null,
  trace_id uuid references public.traces (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_matches_discovered_unique unique (discovered_place_id),
  constraint identity_matches_status_valid check (
    status in (
      'matched_confirmed',
      'matched_unconfirmed',
      'ambiguous',
      'name_mismatch',
      'no_candidates'
    )
  ),
  -- Discriminated union enforced: each status pins exactly which columns
  -- may hold values. method rides with best_score everywhere (ruling 3).
  constraint identity_matches_status_shape check (
    (status = 'matched_confirmed'
       and place_id is not null and best_score is not null
       and method is not null)
    or (status = 'matched_unconfirmed'
       and place_id is not null and best_score is null
       and method is null and candidates is null)
    or (status in ('ambiguous', 'name_mismatch')
       and place_id is null and best_score is not null
       and method is not null)
    or (status = 'no_candidates'
       and place_id is null and best_score is null
       and method is null and candidates is null)
  )
);

-- At most one matched identity row per base-layer place across the two
-- matched states (places.google_place_id UNIQUE enforces the same 1:1 from
-- the other side; this index keeps the evidence table honest on its own).
create unique index identity_matches_place_matched_unique
  on public.identity_matches (place_id)
  where status in ('matched_confirmed', 'matched_unconfirmed');

create index identity_matches_status_idx
  on public.identity_matches (status);

create trigger identity_matches_set_updated_at
  before update on public.identity_matches
  for each row execute function extensions.moddatetime (updated_at);

-- Server-only, same posture as traces/discovered_places: RLS enabled with
-- zero policies — only the service-role client (src/server/) can touch it.
alter table public.identity_matches enable row level security;
