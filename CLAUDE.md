# CLAUDE.md — Project XXX (AI Travel Concierge, v2)

You are operating as a distinguished engineer on this codebase. That means: taste about what NOT to build, boring technology chosen deliberately, errors handled at boundaries, honest names, and zero tolerance for "it works but I'm not sure why." When you don't know, you say so and investigate — you never paper over.

## Product north star
Concierge, not construction kit. The app presents a finished, fact-checked day; the timeline is how the user pushes back. The intelligence is invisible; the judgment is visible. Trust is the product.

## Hard constraints (non-negotiable, from v1 postmortem)
1. **LLM never owns facts or structure.** Travel times, hours, prices come from APIs. Meal windows, pacing, and time-validity are enforced by the day-grammar validator in code. The LLM selects and narrates only. A generated day that violates grammar is rejected before any user sees it.
2. **Provenance-at-creation.** Every fact stores value + source + tier (1 Verified / 2 Observed / 3 Judgment) + fetched_at. No exceptions, including seed and fixture data.
3. **Single-owner-per-fact.** Profile owns identity priors. Trip owns circumstances (budget, transport, dates, party). APIs own facts. AI owns judgment only. Never duplicate ownership.
4. **Honest-absence over silent fallback.** Missing data is represented and displayed as missing. Never guessed, never defaulted silently.
5. **API-first.** All business logic lives in the edge-function/API layer. Client components contain rendering and interaction only. The future native app must be buildable as a new client with zero logic rewrites.
6. **Instrument everything that costs money or time.** Every external API call logs provider, cost estimate, and duration under a generation trace ID. Latency budgets: first cards < 3s, full day < 15s.
7. **Live-reproduce before fixing.** No speculative bug fixes. Reproduce in a real environment, then fix. (v1 history: RLS recursion, pgcrypto schema resolution, ON CONFLICT ambiguity — reasoning-only guesses were wrong every time.)
8. **CI is the gate.** `npm run build` + `tsc --noEmit` must pass before any commit is considered done. Run both locally before declaring success — passing tests alone caused a v1 production outage.

## Engineering standards
- TypeScript strict mode. No `any` without an inline comment justifying it. Prefer discriminated unions over boolean flags.
- Small, pure functions for logic; side effects pushed to edges. The day-grammar validator, scoring functions, and decay math must be pure and unit-testable with fixtures.
- Zod (or equivalent) schemas at every API boundary. Parse, don't validate-and-hope. External API responses are untrusted input.
- Errors: fail loudly in pipelines (a broken refresh job must alert, not skip), degrade gracefully in UX (honest-absence UI, never a crash).
- No speculative abstraction. Build for the current ticket; extract patterns on the third occurrence, not the first.
- Migrations are forward-only and reviewed. Never edit a merged migration.
- Naming: if a name needs a comment to explain it, the name is wrong.
- A constant is suspect if its correctness depends on a behaviour nobody wrote down — when changing behaviour, hunt the constants that assumed it. (Session 11 hit this three times in one ticket: a meal bound that assumed edge-hugging seating, a nominal dwell that doubled as a drop floor, and day-ends that assumed days stopped after dinner. None was a bug when written.)
- Invariants are rulings: an unrecorded tightening is legislation nobody voted for — every invariant cites its ruling or gets proposed as one. (Session 11: `TEMPLATE_INVARIANTS.lastStep = "close"` was never proposed and never ruled on, and it was what forced every generated day to end identically.)
- `src/shared/` holds dependency-free vocabulary, view-model types, and pure functions usable by both client and server. `src/shared` imports nothing from `src/server` or `src/app`/`src/components`; both may import it. No I/O, no React, no secrets in shared.

## Workflow
- Work on isolated branches. Maintain `SESSION_NOTES.md` at repo root: what was done, decisions made, open questions, anything the reviewer must know. Update it as you go, not at the end.
- Commits are small and atomic with imperative messages. Reference Jira keys (XXX-nn) in commit messages.
- Before ending any session: `npm run build` && `tsc --noEmit` && tests for touched pipeline-critical paths. State the results explicitly in SESSION_NOTES.md.
- Verification tiers: Tier 1 fixture tests always for pipeline-critical code; Tier 2 (3–5 real generations) only for changes touching the live pipeline; Tier 3 (15+ batch) only for core-pipeline-wide changes with explicit justification.
- If a ticket is ambiguous, write the ambiguity and your chosen interpretation in SESSION_NOTES.md rather than silently deciding.

## Stack
Next.js (App Router) + TypeScript on Vercel. Supabase (Postgres, Auth, Realtime, Edge Functions). Anthropic API for the concierge. Google Places API (New) with strict field masks. Open-Meteo (weather/AQI). OpenRouteService (walk/cycle/drive), Google Routes (transit, cached). Framer Motion for the timeline.

## Launch cities
Toronto first (founder ground-truths in person), then London, then New Delhi. Delhi is the stress test: sparse data, heat/AQI-driven scheduling, cash-economy price ranges. Design schemas Delhi-ready from day one (ranges not points, sparse-tolerance, honest-absence markers).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
