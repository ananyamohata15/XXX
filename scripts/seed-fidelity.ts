import { createClient } from "@supabase/supabase-js";
import { templateForDraw, type TemplateDraw } from "../src/server/generation/arc";
import { personaIdentity } from "../src/shared/dice";
import { GOLDEN_PERSONAS } from "../src/shared/persona";

/**
 * Seed fidelity on the LIVE surface (XXX-35, Session 13 Step 1).
 *
 * The unit test (`tests/generation/seed-plumbing.test.ts`) proves the
 * reproducibility law holds in the composer. This proves it holds in the
 * traces we actually wrote — which is where Session 12 found it broken, and
 * the only place that can tell us it is fixed for real callers.
 *
 *   **The law: the seed a trace records IS the seed that built its day.**
 *
 * For every day_generation trace it re-picks the arc template from the
 * recorded seed and compares it with the recorded `arc_template_id`. A
 * mismatch means the trace cannot reproduce its own day, which is a
 * provenance failure and not merely a bug: anyone mining shape variety from
 * the corpus gets a confident wrong answer.
 *
 * It also prints the SHAPE DISTRIBUTION per persona, because "the room
 * varies" is a claim about the spread of templates, not about any one day.
 *
 * FREE and read-only: DB reads only. No Google, no Anthropic, no writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/seed-fidelity.ts
 *   npx tsx --env-file=.env.local scripts/seed-fidelity.ts --since 2026-08-15
 *   npx tsx --env-file=.env.local scripts/seed-fidelity.ts --surface tasting_room
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 66 - s.length))}`);
};

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

interface Row {
  id: string;
  started_at: string;
  metadata: Record<string, unknown> | null;
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const since = arg("--since");
  const surface = arg("--surface");
  const assumedKey = arg("--assume-persona");
  const assumed = assumedKey === null ? null : GOLDEN_PERSONAS[assumedKey];
  if (assumedKey !== null && assumed === undefined) {
    console.error(
      `Unknown persona "${assumedKey}". Known: ${Object.keys(GOLDEN_PERSONAS).join(", ")}`,
    );
    process.exit(1);
  }

  let query = client
    .from("traces")
    .select("id, started_at, metadata")
    .eq("kind", "day_generation")
    .order("started_at", { ascending: true });
  if (since !== null) query = query.gte("started_at", since);
  if (surface !== null) query = query.eq("metadata->>surface", surface);

  const { data, error } = await query;
  if (error) throw new Error(`trace read failed: ${error.message}`);
  const rows = (data ?? []) as Row[];

  head("REPRODUCIBILITY LAW — the recorded seed rebuilds the recorded arc");
  line(`  traces read: ${rows.length}${since ? ` since ${since}` : ""}`);
  if (assumed !== undefined && assumed !== null) {
    line(
      `  ASSUMING persona "${assumedKey}" for traces that record no identity —` +
        ` operator-supplied, not read from the trace.`,
    );
  }
  line();

  let checked = 0;
  let held = 0;
  const violations: string[] = [];
  const unconfirmed: string[] = [];
  const skipped: string[] = [];
  /** personaKey → templateId → count, for the shape-spread read below. */
  const shapes = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const meta = row.metadata ?? {};
    const tasting =
      typeof meta.tasting === "object" && meta.tasting !== null
        ? (meta.tasting as Record<string, unknown>)
        : {};
    const seed = typeof meta.seed === "number" ? meta.seed : null;
    const templateId =
      typeof meta.arc_template_id === "string" ? meta.arc_template_id : null;
    const surfaceLabel =
      typeof meta.surface === "string" ? meta.surface : "(no surface)";
    // Only the room records a persona KEY; every trace since Session 13
    // records the draw itself, which is what the replay actually needs.
    const personaKey =
      typeof tasting.persona_key === "string" ? tasting.persona_key : null;
    const identity =
      typeof meta.persona_identity === "number" ? meta.persona_identity : null;
    const structure = meta.persona_structure;
    const pace = meta.persona_pace;

    if (seed === null || templateId === null) {
      skipped.push(
        `${row.id.slice(0, 8)} ${row.started_at.slice(0, 16)} — pre-arc trace (seed/template absent)`,
      );
      continue;
    }

    /** Prefer the recorded draw; fall back to a golden persona by key. */
    let draw: TemplateDraw | null = null;
    if (
      identity !== null &&
      (structure === "scheduler" || structure === "wanderer") &&
      (pace === "relaxed" || pace === "moderate" || pace === "packed")
    ) {
      draw = { identity, structure, pace };
    } else if (personaKey !== null && GOLDEN_PERSONAS[personaKey]) {
      const p = GOLDEN_PERSONAS[personaKey];
      draw = {
        identity: personaIdentity(p),
        structure: p.structure,
        pace: p.pace,
      };
    }
    let drawIsAssumed = false;
    if (draw === null && assumed !== null) {
      drawIsAssumed = true;
      // Traces written before `persona_identity` existed carry no way to
      // identify their draw. Where the operator KNOWS which persona a run
      // used — a harness run they launched themselves — they may say so and
      // get the check. Stated as an assumption in the output, never silently.
      draw = {
        identity: personaIdentity(assumed),
        structure: assumed.structure,
        pace: assumed.pace,
      };
    }
    if (draw === null) {
      skipped.push(
        `${row.id.slice(0, 8)} ${row.started_at.slice(0, 16)} — trace predates persona_identity and carries no persona key`,
      );
      continue;
    }

    checked += 1;
    const replayed = templateForDraw(draw, seed).id;
    const key = `${personaKey ?? `identity ${draw.identity}`} · ${surfaceLabel}`;
    const perPersona = shapes.get(key) ?? new Map<string, number>();
    perPersona.set(templateId, (perPersona.get(templateId) ?? 0) + 1);
    shapes.set(key, perPersona);

    if (replayed === templateId) {
      held += 1;
    } else if (drawIsAssumed) {
      // The trace did not say who it was for; the operator did. A mismatch
      // here is at least as likely to mean the assumption was wrong as that
      // the law broke, so it must never be reported as a violation.
      unconfirmed.push(
        `  ? ${row.id.slice(0, 8)} ${row.started_at.slice(0, 16)} (${surfaceLabel})\n` +
          `      under the ASSUMED persona, seed ${seed} picks "${replayed}" but the day was built as "${templateId}".\n` +
          `      Either the assumption is wrong for this trace, or the law broke. This trace cannot tell you which.`,
      );
    } else {
      violations.push(
        `  ✗ ${row.id.slice(0, 8)} ${row.started_at.slice(0, 16)} ${personaKey} (${surfaceLabel})\n` +
          `      recorded seed ${seed} picks "${replayed}", day was built as "${templateId}"` +
          (templateForDraw(draw, 0).id === templateId
            ? " — seed 0 reproduces it (the Session 12 defect)"
            : ""),
      );
    }
  }

  line(
    `  checked: ${checked}   HOLDS: ${held}   VIOLATIONS: ${violations.length}` +
      (unconfirmed.length > 0 ? `   UNCONFIRMED: ${unconfirmed.length}` : ""),
  );
  if (violations.length > 0) {
    line();
    for (const v of violations) line(v);
  }
  if (unconfirmed.length > 0) {
    line();
    line("  Could not be confirmed either way (persona was assumed, not recorded):");
    for (const u of unconfirmed) line(u);
  }
  if (skipped.length > 0) {
    line();
    line(`  skipped ${skipped.length} trace(s) that cannot be checked:`);
    for (const s of skipped.slice(0, 10)) line(`    ${s}`);
    if (skipped.length > 10) line(`    … and ${skipped.length - 10} more`);
  }

  head("SHAPE SPREAD — how many distinct arcs each persona actually drew");
  for (const [key, perPersona] of [...shapes].sort()) {
    const total = [...perPersona.values()].reduce((a, b) => a + b, 0);
    const spread = [...perPersona]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}×${n}`)
      .join(" · ");
    line(`  ${key.padEnd(38)} ${perPersona.size} shape(s) / ${total} day(s)`);
    line(`      ${spread}`);
  }
  line();

  if (violations.length > 0) {
    line("  VERDICT: the law is BROKEN on the live surface.");
    process.exit(1);
  }
  line("  VERDICT: every checked trace reproduces its own day.");
  line();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
