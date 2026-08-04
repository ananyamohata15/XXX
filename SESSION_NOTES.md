# Session 1 — Infra (XXX-12, XXX-13, XXX-14)

Branch: `session-1-infra`. Status: local work complete; GitHub push / Supabase
link / Vercel deploy pending auth (see Open questions).

## What was done

- **XXX-12** Next.js 16.3.0 (App Router, TypeScript strict, Turbopack, no
  Tailwind) at repo root. API-first layout: `src/server/` (all logic),
  `src/app/api/` (thin handlers), `src/app/` + `src/components/` (rendering
  only). ESLint `no-restricted-imports` boundary rule. Health vertical slice:
  `GET /api/health` → `src/server/health.ts` → Supabase connectivity check.
  `supabase/` initialized (CLI pinned as devDependency), empty initial
  migration, `.env.example`, README.
- **XXX-13** `.github/workflows/ci.yml`: install → lint → typecheck → build →
  test on PRs to `main` and pushes to `main`. Vitest harness with a trivial
  smoke test plus real unit tests (7 tests, 3 files).
- **XXX-14** Migration `20260803000001_instrumentation.sql` (`traces`,
  `trace_events`, cost-model comment block, RLS enabled with no policies —
  server-only via service role). `src/server/instrumentation.ts` exposing
  `startTrace` / `logEvent` / `endTrace` behind an `Instrumentation` interface,
  Supabase-backed, unit-tested against an in-memory fake client
  (`tests/fixtures/fake-supabase.ts`). Health check records a `health_check`
  trace with one `supabase` event as proof-of-life.

## Decisions (boring and reversible unless noted)

1. **Scaffold mechanics**: `create-next-app` refuses non-empty dirs, so
   scaffolded in a temp dir and moved in. Deleted the scaffold's stub
   `CLAUDE.md` and `AGENTS.md`; renamed the real `CLAUDE.MD` → `CLAUDE.md`.
   Note: `next dev` re-creates `AGENTS.md` (it says so itself); when it
   reappears, commit it rather than fighting the tool.
2. **No Tailwind** — UI beyond the default page is out of scope this session;
   adding a styling system is Session-2+ scope.
3. **`typecheck` = `next typegen && tsc --noEmit`** — Next 16 generates global
   route/layout types (`LayoutProps`) only during dev/build/typegen; raw `tsc`
   fails on a clean checkout without it. CI uses the same npm script.
4. **Boundary enforcement via `no-restricted-imports`** rather than
   `eslint-plugin-boundaries`: zero extra dependencies, one rule, does the job.
   Blocked patterns: `@/server`, `@/server/**`, relative `server/**` up to
   three levels, `**/src/server/**`. Known limitation: a 4+-level relative
   import would slip through — the `@/` alias is the project norm, and the
   plugin upgrade is the known next step if this is ever dodged in review.
5. **Supabase env var names**: classic `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. New-style
   publishable/secret keys drop into the same slots.
6. **Instrumentation tables are server-only**: RLS enabled with no policies;
   only the service-role client (in `src/server/`) can touch them. Schema adds
   `id` + `created_at` to `trace_events` beyond the ticket's field list.
7. **Cost semantics (honest absence)**: `est_cost_usd` NULL = unknown, 0 =
   known-free. Documented in the migration comment block.
8. **A failed trace never fails the traced request**: `recordHealthTrace`
   catches and logs. Instrumentation errors themselves throw loudly
   (tested) — the swallow happens only at the health boundary, deliberately.
9. **Zod deferred**: `/api/health` takes no input, so there is no request
   boundary to parse yet. First endpoint with a body (Session 2) brings Zod
   with it.
10. **Empty initial migration contains `select 1;`** — a visibly harmless
    no-op rather than a 0-byte file some tools skip.
11. **`/api/health` is `force-dynamic`** — health must reflect request time,
    and must not execute at build time (no env vars in CI build).

## Evidence

- `npm run lint` — clean. `npm run typecheck` — clean. `npm test` — 7/7
  passed. `npm run build` — success; route table shows `ƒ /api/health`
  (dynamic) and `○ /` (static).
- **Boundary rule proof** (violations then removed, per ticket):
  ```
  src/app/page.tsx
    1:1  error  '@/server/health' import is restricted from being used by a pattern...
  src/components/BoundaryViolation.tsx
    2:1  error  '@/server/health' import is restricted from being used by a pattern...
  ✖ 2 problems (2 errors, 0 warnings)  (exit code 1)
  ```
  The legitimate import in `src/app/api/health/route.ts` passes the same lint.

## Branch protection — exact setting to click

GitHub repo → **Settings → Branches → Add branch protection rule** →
pattern `main` → enable **"Require status checks to pass before merging"** →
select the check **`build-and-test`** (appears after the first CI run) →
optionally **"Require branches to be up to date before merging"**.

## Open questions

- GitHub repo, Supabase project, and Vercel project all need interactive
  auth/creation — pending user login (gh / supabase / vercel CLIs).
- CI type-error-PR experiment and production deploy verification pending the
  above; evidence to be appended here.
