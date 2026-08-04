-- XXX-12: intentionally empty initial migration.
-- Proves the migration pipeline end-to-end (supabase db push) before any
-- schema exists. Domain schema lands in Session 2 (XXX-15).
select 1;
