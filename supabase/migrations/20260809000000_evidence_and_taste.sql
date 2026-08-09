-- XXX-33: evidence + taste capture, authority-aware from migration one.
--
-- Doctrine (comment 10289, ratified Session 10 CP1)
-- -------------------------------------------------
-- Feedback is EVIDENCE, never a fact-write. One tap surface, two
-- destinations that share no table:
--   * evidence      — fact-scoped claims about the world
--   * taste_signals — "wouldn't recommend / not for me" and day verdicts
-- World-facts and taste must not cross-contaminate. That is not enforced
-- by discipline here; it is UNREPRESENTABLE. taste_signals has no
-- fact_key, no shown_* columns and no flip_* columns, and the claim /
-- signal CHECK enums are disjoint: 'not_for_me' is not a spellable
-- evidence claim, 'hours_wrong' is not a spellable taste signal.
--
-- Authority ladder (comment 10297): founder | trusted | user.
--   * founder — unconditional tier 1, may flip facts through the
--     founder_groundtruth channel (record_founder_evidence below).
--   * trusted — founder-APPOINTED (no algorithm), stores at high weight
--     and is flagged for immediate verification. Writes no facts:
--     trust is not infallibility, friends misremember.
--   * user    — stores, flips nothing, queues nothing in v1.
-- Founder always overrides trusted on conflict.
--
-- What XXX-34 (trust engine) will need and why it is absent
-- --------------------------------------------------------
-- Every one of these is an additive column or a widened CHECK, never a
-- rewrite — that is the point of designing the shape now:
--   * reporter trust score  -> a column on reporters + a recompute job;
--     it is DERIVED from rows this table already stores.
--   * evidence weight       -> f(trust, stakes, plausibility), all three
--     XXX-34's; a v1 weight column would be a number nothing computes.
--   * sybil fingerprint     -> nullable column / side table; collecting
--     device+IP data for a population of one is surveillance with no
--     purpose.
--   * verification outcome  -> verification_state gains 'confirmed' /
--     'refuted' + a verified_at; the CHECK widens.
--   * decay clock           -> created_at IS the clock; decay is a
--     read-time pure function, not a column.
--
-- NULL semantics (every nullable column, exhaustively)
-- ----------------------------------------------------
--   reporters.user_id        NULL = no auth.users row yet (XXX-17 has not
--                            happened). The seam, honestly empty.
--   reporters.granted_by/_at NULL = not an appointed rung. CHECK-paired.
--   reporters.revoked_at     NULL = grant still standing.
--   evidence.fact_key        NULL only for not_as_described, which names
--                            no single fact. CHECK-enforced.
--   evidence.trace_id        NULL = claim not tied to a generation
--                            (trace deleted, or a future non-generated
--                            surface). Never fabricated.
--   evidence.shown_*         NULL = the displayed fact could not be
--                            reconstructed from the trace. Honest
--                            absence: we do not guess what was on screen.
--   evidence.flip_*          NULL = this row flipped nothing. The normal
--                            case, and the only legal case for a
--                            non-founder reporter (CHECK-enforced).
--   taste_signals.place_id   NULL = a day-level verdict. CHECK-paired
--                            with slot_id.
--
-- RLS: enabled with ZERO policies — server-only via the service role,
-- same posture as traces and the core domain. XXX-17 adds user policies
-- when there is a user to add them for.

-- ---------------------------------------------------------------------------
-- reporters — who may say something, and at what authority.
-- ---------------------------------------------------------------------------
create table reporters (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  authority text not null,
  user_id uuid references auth.users (id) on delete set null,
  granted_by uuid references reporters (id) on delete restrict,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporters_handle_unique unique (handle),
  constraint reporters_authority_valid
    check (authority in ('founder', 'trusted', 'user')),
  -- 10297: appointment is audited. 'trusted' is APPOINTED and must record
  -- by whom and when. 'founder' is the root of trust and has no granter —
  -- an operator who appointed themselves is the honest description, not a
  -- gap. 'user' is unappointed by definition.
  constraint reporters_grant_audited check (
    (authority = 'trusted'
       and granted_by is not null and granted_at is not null)
    or
    (authority <> 'trusted'
       and granted_by is null and granted_at is null)
  )
);

-- ---------------------------------------------------------------------------
-- evidence — fact-scoped claims. Never a fact-write in itself.
-- ---------------------------------------------------------------------------
create table evidence (
  id uuid primary key default gen_random_uuid(),

  -- what is claimed, about what
  place_id uuid not null references places (id) on delete cascade,
  claim text not null,
  fact_key text,

  -- who claimed it. reporter_authority is DENORMALIZED on purpose: it is
  -- the authority AT THE TIME OF THE REPORT. Evidence is a historical
  -- record; a later revoke must not silently restate old rows at a new
  -- weight, and a later promotion must not retroactively empower them.
  reporter_id uuid not null references reporters (id) on delete restrict,
  reporter_authority text not null,

  -- what was shown when the claim was made (adjudicability).
  -- No fact VALUE is stored. Request-time hours/status/price are Google
  -- content and may not be persisted (decision 001; addendum 2026-08-09).
  -- shown_digest is a sha256 of the displayed value's canonical JSON: a
  -- one-way integrity token, not content. It cannot be read back, and it
  -- still proves "what you saw then differs from what we fetch now",
  -- which is the entire adjudication need.
  trace_id uuid references traces (id) on delete set null,
  slot_id text,
  shown_status text,
  shown_source text,
  shown_tier smallint,
  shown_fetched_at timestamptz,
  shown_digest text,

  -- comment 10296: free text is FIRST-CLASS, and the corpus must be
  -- minable by place / persona / rule-adjacency / date. Those are exactly
  -- place_id, persona_key, adjacent_rule_ids and day_date — all indexed.
  free_text text,
  persona_key text,
  day_date date,
  adjacent_rule_ids text[] not null default '{}',

  -- 10297: trusted evidence is flagged for IMMEDIATE verification rather
  -- than corroboration-queueing. Nothing consumes the queue in v1 — it
  -- accumulates and a report lists it. XXX-34 owns the consumer.
  --   bypassed   = founder; the authority IS the verification
  --   queued     = trusted; flagged now, consumed later
  --   not_queued = user; below any threshold XXX-34 will set
  verification_state text not null,

  -- what it did. NULL = flipped nothing.
  flip_fact_key text,
  flip_value jsonb,
  flipped_at timestamptz,

  created_at timestamptz not null default now(),

  constraint evidence_claim_valid check (claim in (
    'hours_wrong', 'price_wrong', 'permanently_closed', 'not_as_described'
  )),
  constraint evidence_authority_valid
    check (reporter_authority in ('founder', 'trusted', 'user')),
  constraint evidence_verification_valid
    check (verification_state in ('bypassed', 'queued', 'not_queued')),
  -- not_as_described names no single fact; every other claim must.
  constraint evidence_fact_key_present check (
    (claim = 'not_as_described' and fact_key is null)
    or
    (claim <> 'not_as_described' and fact_key is not null)
  ),
  constraint evidence_flip_all_or_none check (
    (flip_fact_key is not null and flip_value is not null
       and flipped_at is not null)
    or
    (flip_fact_key is null and flip_value is null and flipped_at is null)
  ),
  -- XXX-34 never-poison invariant 1, enforced by the DATABASE rather than
  -- by discipline: user and trusted evidence physically cannot record a
  -- fact flip. The write path agrees; this is the layer that cannot be
  -- refactored away by accident.
  constraint evidence_only_founder_flips check (
    flip_fact_key is null or reporter_authority = 'founder'
  ),
  constraint evidence_shown_tier_valid
    check (shown_tier is null or shown_tier in (1, 2, 3)),
  constraint evidence_shown_status_valid
    check (shown_status is null or shown_status in ('present', 'absent'))
);

create index evidence_place_id_idx on evidence (place_id);
create index evidence_trace_id_idx on evidence (trace_id);
create index evidence_persona_date_idx on evidence (persona_key, day_date);
create index evidence_rules_idx on evidence using gin (adjacent_rule_ids);
-- Partial: the only reason to scan verification_state is to find work.
create index evidence_verification_queue_idx on evidence (created_at)
  where verification_state = 'queued';

-- ---------------------------------------------------------------------------
-- taste_signals — taste, and structurally nothing else.
-- ---------------------------------------------------------------------------
create table taste_signals (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references places (id) on delete cascade,
  signal text not null,
  reporter_id uuid not null references reporters (id) on delete restrict,
  reporter_authority text not null,
  trace_id uuid references traces (id) on delete set null,
  slot_id text,
  free_text text,
  persona_key text,
  day_date date,
  created_at timestamptz not null default now(),
  constraint taste_signal_valid check (signal in (
    'liked', 'wouldnt_recommend', 'not_for_me', 'day_verdict'
  )),
  constraint taste_authority_valid
    check (reporter_authority in ('founder', 'trusted', 'user')),
  -- A day verdict is about the day, not a card: no place, no slot.
  constraint taste_day_verdict_shape check (
    (signal = 'day_verdict' and place_id is null and slot_id is null)
    or
    (signal <> 'day_verdict' and place_id is not null)
  )
);

create index taste_signals_place_id_idx on taste_signals (place_id);
create index taste_signals_persona_date_idx
  on taste_signals (persona_key, day_date);

-- ---------------------------------------------------------------------------
-- facts — founder-only fact keys.
--
-- business_status and hours_corrections exist so the founder ground-truth
-- channel has somewhere to land. They are founder-only BY CONSTRUCTION:
-- request-time hours / status come from Google and may not be persisted
-- (decision 001), so a Google-sourced value must be unable to reach these
-- keys even through a future careless caller. The Zod write schema says
-- the same thing; this is the layer that cannot be refactored away.
--
-- hours_corrections is deliberately SPARSE (a partial weekday map, and an
-- empty interval array means "closed that day"). Founder knowledge is
-- sparse: standing at a door on a Tuesday tells you about Tuesday. A full
-- HoursByWeekday key would force inventing six weekdays to record one —
-- the silent fallback constraint 4 forbids.
-- ---------------------------------------------------------------------------
alter table facts add constraint facts_founder_only_keys check (
  fact_key not in ('business_status', 'hours_corrections')
  or (source = 'founder_groundtruth' and tier = 1)
);

-- ---------------------------------------------------------------------------
-- record_founder_evidence — the founder flip, atomic or not at all.
--
-- Three statements in one transaction: insert the evidence row, upsert the
-- founder fact, write the flip audit back onto the evidence row.
-- supabase-js has no cross-statement transaction, and a half-applied flip
-- (a fact with no evidence behind it, or evidence claiming a flip that did
-- not happen) is exactly the "it works but I'm not sure why" state this
-- codebase refuses. XXX-34's invariant 4 — every fact flip records its
-- full evidence + verification audit trail — is only TRUE if the two are
-- one event. Precedent: sweep_expired_coords() writes its delete and its
-- trace together for the same reason.
--
-- p_flip_fact_key NULL => record the evidence row and flip nothing. That
-- is the legal shape for a founder claim with no fact to correct
-- (not_as_described), and it keeps one entry point for founder writes.
-- ---------------------------------------------------------------------------
create or replace function public.record_founder_evidence(
  p_place_id uuid,
  p_claim text,
  p_fact_key text,
  p_reporter_id uuid,
  p_trace_id uuid,
  p_slot_id text,
  p_shown_status text,
  p_shown_source text,
  p_shown_tier smallint,
  p_shown_fetched_at timestamptz,
  p_shown_digest text,
  p_free_text text,
  p_persona_key text,
  p_day_date date,
  p_adjacent_rule_ids text[],
  p_flip_fact_key text,
  p_flip_value jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authority text;
  v_evidence_id uuid;
  v_now timestamptz := now();
begin
  -- Authority is read from the reporter row, never taken as an argument:
  -- a caller cannot claim founder authority it does not hold.
  select authority into v_authority
    from reporters
   where id = p_reporter_id and revoked_at is null;

  if v_authority is null then
    raise exception 'unknown or revoked reporter %', p_reporter_id;
  end if;
  if v_authority <> 'founder' then
    raise exception
      'record_founder_evidence is founder-only; reporter % is %',
      p_reporter_id, v_authority;
  end if;

  insert into evidence (
    place_id, claim, fact_key,
    reporter_id, reporter_authority,
    trace_id, slot_id,
    shown_status, shown_source, shown_tier, shown_fetched_at, shown_digest,
    free_text, persona_key, day_date, adjacent_rule_ids,
    verification_state
  ) values (
    p_place_id, p_claim, p_fact_key,
    p_reporter_id, v_authority,
    p_trace_id, p_slot_id,
    p_shown_status, p_shown_source, p_shown_tier, p_shown_fetched_at,
    p_shown_digest,
    p_free_text, p_persona_key, p_day_date,
    coalesce(p_adjacent_rule_ids, '{}'),
    'bypassed'
  )
  returning id into v_evidence_id;

  if p_flip_fact_key is not null then
    insert into facts (
      place_id, fact_key, status, value, source, tier, fetched_at
    ) values (
      p_place_id, p_flip_fact_key, 'present', p_flip_value,
      'founder_groundtruth', 1, v_now
    )
    on conflict on constraint facts_place_key_unique do update
      set status     = 'present',
          value      = excluded.value,
          source     = excluded.source,
          tier       = excluded.tier,
          fetched_at = excluded.fetched_at;

    update evidence
       set flip_fact_key = p_flip_fact_key,
           flip_value    = p_flip_value,
           flipped_at    = v_now
     where id = v_evidence_id;
  end if;

  return v_evidence_id;
end;
$$;

-- Functions in public are auto-exposed over PostgREST RPC and EXECUTE is
-- granted to PUBLIC on creation. This one writes tier-1 facts: service
-- role only, never anon, never authenticated.
revoke execute on function public.record_founder_evidence(
  uuid, text, text, uuid, uuid, text, text, text, smallint, timestamptz,
  text, text, text, date, text[], text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_founder_evidence(
  uuid, text, text, uuid, uuid, text, text, text, smallint, timestamptz,
  text, text, text, date, text[], text, jsonb
) to service_role;

create trigger reporters_set_updated_at before update on reporters
  for each row execute function extensions.moddatetime (updated_at);

alter table reporters enable row level security;
alter table evidence enable row level security;
alter table taste_signals enable row level security;
