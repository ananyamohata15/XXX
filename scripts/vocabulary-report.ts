import { createClient } from "@supabase/supabase-js";
import { GRAMMAR_PARAMS } from "../src/shared/day-grammar/params";
import {
  CATEGORY_FAMILY,
  NON_ANCHOR_CATEGORIES,
  PLACE_CATEGORIES,
  type PlaceCategory,
} from "../src/shared/vocabulary";

/**
 * Vocabulary coverage report (XXX-37, Session 13 Step 3).
 *
 * After the re-map and re-ingest: how many identities does each category
 * actually hold, and — the part that matters for a founder spot-check — WHAT
 * are they? A category with 400 rows that are all the wrong kind of place is
 * worse than an empty one, because it will confidently seat them.
 *
 * Prints per-category counts, the new categories' samples for eyeballing,
 * and the two things only a query can answer: how many places carry a Google
 * link (the pre-fetch quality signal), and which places gained a SECOND
 * category from the re-map — the multi-category collisions
 * `collapseByPlace` has to adjudicate.
 *
 * FREE and read-only: pool reads only. No Google, no Anthropic, no writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/vocabulary-report.ts
 *   npx tsx --env-file=.env.local scripts/vocabulary-report.ts --samples 20
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
  name: string;
  google_place_id: string | null;
  facts: { fact_key: string; value: { mapped?: string[] } }[];
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const sampleCount = Number(arg("--samples") ?? 12);

  const rows: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("places")
      .select("id, name, google_place_id, facts(fact_key, value)")
      .eq("city", "toronto")
      .eq("source", "fsq_os_places")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`pool read: ${error.message}`);
    if (data === null || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }

  const mappedOf = (r: Row): string[] =>
    r.facts?.find((f) => f.fact_key === "categories")?.value?.mapped ?? [];

  head(`POOL — ${rows.length} Toronto FSQ identities`);

  const counts = new Map<string, { total: number; linked: number }>();
  for (const r of rows) {
    for (const c of mappedOf(r)) {
      const held = counts.get(c) ?? { total: 0, linked: 0 };
      held.total += 1;
      if (r.google_place_id !== null) held.linked += 1;
      counts.set(c, held);
    }
  }

  line();
  line(
    `  ${"category".padEnd(19)}${"places".padStart(7)}${"linked".padStart(8)}  family     dwell min/typ/max  anchor?`,
  );
  for (const category of PLACE_CATEGORIES) {
    const held = counts.get(category) ?? { total: 0, linked: 0 };
    const d = GRAMMAR_PARAMS.dwellMinutes[category as PlaceCategory];
    const anchorable = NON_ANCHOR_CATEGORIES.includes(category as PlaceCategory)
      ? "NO"
      : "yes";
    line(
      `  ${category.padEnd(19)}${String(held.total).padStart(7)}${String(held.linked).padStart(8)}  ` +
        `${CATEGORY_FAMILY[category as PlaceCategory].padEnd(9)}  ` +
        `${String(d.min).padStart(3)}/${String(d.typical).padStart(3)}/${String(d.max).padStart(3)}        ${anchorable}`,
    );
  }

  const NEW: PlaceCategory[] = ["shopping", "scenic_viewpoints", "grocery"];
  for (const category of NEW) {
    const mine = rows.filter((r) => mappedOf(r).includes(category));
    head(`${category.toUpperCase()} — founder spot-check sample`);
    if (mine.length === 0) {
      line("  EMPTY. The mapping ran but no identity carries this category —");
      line("  either the re-ingest has not run or the rules match nothing.");
      continue;
    }
    /**
     * A SPREAD sample, not an alphabetical one.
     *
     * The first version sorted linked-first then by name, and the first
     * read of it looked like a catastrophe: `shopping` appeared to be full
     * of "1 Stop Electric", "100 The East Mall", "14 woodlot cres". Every
     * one of those is simply a name that sorts early — numerals before
     * letters — and the label histogram showed the rules were matching
     * exactly what they were written to match. A sampler that always shows
     * the same corner of the alphabet is not a spot-check, it is a
     * generator of false alarms about its own data.
     *
     * Evenly spaced through the set, so the sample is representative of the
     * whole rather than of its first page.
     */
    const stride = Math.max(1, Math.floor(mine.length / sampleCount));
    const spread = mine.filter((_, i) => i % stride === 0).slice(0, sampleCount);
    for (const r of spread) {
      const others = mappedOf(r).filter((c) => c !== category);
      line(
        `  ${r.google_place_id !== null ? "🔗" : "  "} ${r.name}` +
          (others.length > 0 ? `   [also ${others.join("/")}]` : ""),
      );
    }
    const linked = mine.filter((r) => r.google_place_id !== null);
    if (linked.length > 0) {
      line(`  — Google-linked in this category (${linked.length}):`);
      for (const r of linked.slice(0, sampleCount)) line(`    🔗 ${r.name}`);
    }
    line(`  … ${mine.length} total`);
  }

  head("MULTI-CATEGORY IDENTITIES — what collapseByPlace has to adjudicate");
  const multi = rows.filter((r) => mappedOf(r).length > 1);
  line(`  ${multi.length} of ${rows.length} places carry more than one category`);
  const pairs = new Map<string, number>();
  for (const r of multi) {
    const m = [...mappedOf(r)].sort();
    for (let i = 0; i < m.length; i += 1) {
      for (let j = i + 1; j < m.length; j += 1) {
        const k = `${m[i]} + ${m[j]}`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
    }
  }
  for (const [pair, n] of [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    line(`    ${String(n).padStart(5)}  ${pair}`);
  }
  line();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
