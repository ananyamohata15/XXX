-- XXX-25: TTL expiry sweep — the write-side compliance action for the 30-day
-- coordinate grant (SST §14.3; decision doc 001 §1/§2; Session 6 Step 1,
-- Checkpoint 1 rulings 1–2).
--
-- Doctrine (recorded in SESSION_NOTES §1.2, repeated here so nobody
-- "simplifies" one layer away):
--   * This sweep is the COMPLIANCE ACTION: it deletes expired lat/lng values
--     at rest, discharging the "must delete" obligation.
--   * The read-side guard (src/server/discovery/ttl.ts, applied by
--     withCoordsTtlApplied) is BELT-AND-SUSPENDERS: it prevents
--     over-retention reads when the cron is late, dead, or not yet
--     scheduled. Neither layer covers the other's hole.
--
-- coords_fetched_at deliberately PERSISTS on expiry: the deletion obligation
-- covers the coordinate values (Google content), not our fetch timestamp
-- (Customer Data). The timestamp is the compliance evidence — it proves,
-- with the sweep trace, that values were deleted on time — and the
-- discovered_places_coords_match_status CHECK already encodes this shape.
--
-- The sweep runs hourly (Checkpoint 1 ruling 2: worst-case retention
-- overshoot ~1h vs ~24h daily; free, so the conservative reading wins) and
-- is idempotent: expired rows leave the 'present' predicate set, so re-runs
-- and overlaps are no-ops.

create extension if not exists pg_cron;

-- Performs the guarded delete AND writes the run trace in one transaction:
-- a run that deletes but leaves no trace cannot happen (silence is not
-- evidence — zero-row runs get a trace too, one per scheduled slot).
create or replace function public.sweep_expired_coords()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started      timestamptz := clock_timestamp();
  v_examined     bigint;
  v_expired      bigint;
  v_expiring_7d  bigint;
begin
  select count(*) into v_examined
    from discovered_places
   where coords_status = 'present';

  with swept as (
    update discovered_places
       set lat = null,
           lng = null,
           coords_status = 'expired'
     where coords_status = 'present'
       and coords_fetched_at <= now() - interval '30 days'
     returning 1
  )
  select count(*) into v_expired from swept;

  -- Feeds the human-trigger warning for the (never-automated) paid
  -- re-discovery: rows whose 30-day deadline falls within the next 7 days.
  select count(*) into v_expiring_7d
    from discovered_places
   where coords_status = 'present'
     and coords_fetched_at <= now() - interval '23 days';

  insert into traces (kind, started_at, finished_at, total_cost_usd, metadata)
  values (
    'ttl_sweep',
    v_started,
    clock_timestamp(),
    0, -- honest zero: no external call is made
    jsonb_build_object(
      'rows_examined',      v_examined,
      'rows_expired',       v_expired,
      'expiring_within_7d', v_expiring_7d
    )
  );
end;
$$;

-- Functions in public are auto-exposed over PostgREST RPC and EXECUTE is
-- granted to PUBLIC on creation. This is an operational compliance job, not
-- an API: service-role (script invocations) and postgres (pg_cron) only.
revoke execute on function public.sweep_expired_coords()
  from public, anon, authenticated;
grant execute on function public.sweep_expired_coords() to service_role;

-- Hourly at :07 (off the top-of-hour crowd). cron.schedule upserts by job
-- name, so a re-push cannot double-schedule.
select cron.schedule('ttl-sweep', '7 * * * *',
                     $$select public.sweep_expired_coords()$$);
