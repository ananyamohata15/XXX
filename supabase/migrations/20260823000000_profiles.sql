-- Profiles (XXX-43, Session 15) — the traveller's standing facts.
--
-- Single-owner-per-fact (constraint 3): Profile owns identity priors. `trips`
-- owns circumstances, `taste_signals` owns evidence, APIs own facts about the
-- world. Nothing here duplicates any of those.
--
-- Founder-singular for now: `owner` is the primary key and holds 'founder'.
-- XXX-17 (auth) turns it into a user id without a shape change.
--
-- WHY THE CATEGORY VOCABULARY IS NOT ENUMERATED IN A CHECK CONSTRAINT.
-- The obvious move is `check (excluded_categories <@ array['restaurants', …])`.
-- Refused deliberately, and the reason is this project's own scar tissue:
-- that CHECK would be a SECOND OWNER of a vocabulary that already has one in
-- src/shared/vocabulary.ts. Sessions 13 and 14 lost four separate days to
-- lists that enumerated a vocabulary and then silently disagreed with it when
-- it widened -- and a migration is forward-only, so the copy in SQL is
-- precisely the one that could never be corrected in place. Zod at the API
-- boundary is the gate (parse, don't validate-and-hope); the database stores
-- what the boundary already proved.
--
-- Provenance-at-creation (constraint 2) applies to user facts too. The whole
-- row shares one provenance -- the user said it, tier 1 -- so per-field
-- provenance rows would store the same four columns eleven times to answer a
-- question nobody asks. `stated_at` is when they last said it.

create table profiles (
  owner               text        primary key,

  -- The five interview dimensions. NULL means SKIPPED, which is a real
  -- answer and must stay distinguishable from a chosen value: a day built on
  -- a skipped dimension says "concierge's choice" rather than claiming the
  -- traveller picked something they never saw.
  pace                text,
  gravity             text[],
  food_courage        text,
  structure           text,
  lens                text,

  -- Hard constraints. "I don't drink" lands here as {nightlife_bars}.
  excluded_categories text[]      not null default '{}',
  -- Leanings, never guarantees: a directory tag is not a certification.
  dietary             text[]      not null default '{}',
  -- Positive taste.
  loved_cuisines      text[]      not null default '{}',

  -- Provenance. Tier 1 is not a default to be overridden -- a user's word
  -- about their own taste is absolute by definition, so the CHECK pins it.
  source              text        not null default 'user:interview',
  tier                smallint    not null default 1,
  stated_at           timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint profiles_tier_is_the_users_word check (tier = 1)
);

comment on table profiles is
  'Standing taste facts about a traveller (XXX-43). Tier 1: their word on '
  'their own taste is absolute. Written ONLY by the profile sheet and the '
  'first-run interview -- never by the chat parser, because a parse is an '
  'inference and an inference must not write a permanent fact about a person.';

comment on column profiles.excluded_categories is
  'Hard constraints. Enforced at the palette, close list, family licence and '
  'retrieval, and backstopped by the constraint.excluded-category grammar '
  'rule, which REJECTS a day that seats one before any user sees it.';

comment on column profiles.dietary is
  'Leanings only. Sourced from tier-2 directory labels, so the day must say '
  'it cannot vouch for a kitchen. Never presented as certification.';

comment on column profiles.gravity is
  'Interests in gravity order, most important first. NULL = not asked or '
  'skipped; empty array is not used, so absence has exactly one spelling.';

-- Row-level security: the profile is personal data. No policy is granted to
-- anon/authenticated here because XXX-17 has not defined the identity model
-- yet -- until then only the service role reaches it, which is the closed
-- default rather than an open one nobody remembered to shut.
alter table profiles enable row level security;

-- Same trigger every other table in this schema uses. Verified against the
-- existing migrations rather than assumed: the first draft of this file
-- invented a `touch_updated_at()` that does not exist, which would have
-- failed on apply -- and a migration is forward-only, so there is no editing
-- it afterwards.
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function extensions.moddatetime (updated_at);
