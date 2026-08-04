# Project XXX — AI Travel Concierge (v2)

An AI travel concierge that presents a finished, fact-checked day plan — not a
construction kit. Facts (hours, prices, travel times) come from APIs with
provenance attached; a day-grammar validator in code enforces structure; the
LLM selects and narrates only. Toronto first, then London, then New Delhi. See
`CLAUDE.md` for the full engineering constitution.

## The API-first rule

**All business logic lives in `src/server/`. Nothing else.**

- `src/server/` — services, validators, data access. The only place logic lives.
- `src/app/api/` — thin route handlers: call `src/server/`, translate to HTTP.
- `src/app/` + `src/components/` — rendering and interaction only. Client code
  talks to the API over HTTP, period.

This is enforced, not aspirational: an ESLint `no-restricted-imports` rule
fails linting if `src/components/**` or any page/layout file imports
`src/server/**`. Only `src/app/api/**` route handlers may import it. A future
native app must be buildable as a new client with zero logic rewrites.

## Setup

1. Prereqs: Node 22+, npm.
2. `npm install`
3. `cp .env.example .env.local` and fill in the Supabase values
   (Project Settings → API in the Supabase dashboard). Never commit real keys.
4. Apply migrations to your Supabase project:
   `npx supabase link --project-ref <ref>` then `npx supabase db push`
5. `npm run dev` and check `http://localhost:3000/api/health` — it should
   return `{ "status": "healthy", ... }` with a real db check.

## Scripts

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Dev server                      |
| `npm run build`     | Production build                |
| `npm run typecheck` | `tsc --noEmit`                  |
| `npm run lint`      | ESLint (includes boundary rule) |
| `npm test`          | Vitest unit tests               |

## CI and branch protection

`.github/workflows/ci.yml` runs install → lint → typecheck → build → test on
every PR targeting `main` and on every push to `main`.

**Branch protection (enable manually in GitHub):** Settings → Branches →
Add branch protection rule → branch name pattern `main` → check
**"Require status checks to pass before merging"** → search for and select the
check named **`build-and-test`** (it appears after the first CI run). Also
check **"Require branches to be up to date before merging"**.

## Deployment

Vercel (production). Set the three env vars from `.env.example` in the Vercel
project settings. `/api/health` on the deployed URL verifies Supabase
connectivity and writes a `health_check` trace row — the proof-of-life for
cost/latency instrumentation.
