import { createClient } from "@supabase/supabase-js";
import {
  FOUNDER_ANCHOR_WORTHY,
  matchesCuratedName,
} from "../src/shared/anchor-calibre";
import { GRAMMAR_PARAMS } from "../src/shared/day-grammar/params";
import { PLACE_CATEGORIES } from "../src/shared/vocabulary";

/**
 * The founder's ten-minute anchor curation worksheet (XXX-35, Session 13
 * Step 2, CP2).
 *
 * Anchor calibre has a tier-1 signal — the founder's own list — and a tier-2
 * proxy, rating count, which measures FAME rather than calibre and cannot
 * tell Berczy Park from High Park. The list is what fixes that, and this is
 * the worksheet that makes filling it a ten-minute job instead of an
 * open-ended one.
 *
 * It prints, per electable category, the venues the pool would ACTUALLY
 * elect as a centrepiece — ranked the way retrieval ranks them — so the
 * founder is ticking real candidates rather than recalling Toronto from
 * memory. Already-curated names are marked so the list converges.
 *
 * It deliberately does NOT guess. An assistant's opinion about what makes a
 * good Toronto anchor is a tier-3 guess wearing a tier-1 badge, and the
 * entire value of the founder list is that it is not that.
 *
 * FREE and read-only: pool reads only. No Google, no Anthropic, no writes.
 * Note the pool carries no ratings — those arrive only with a request-time
 * Details fetch — so this ranks by the pool's own ordering and prints
 * whether each place carries a Google link (the one pre-fetch signal there
 * is).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/curation-list.ts
 *   npx tsx --env-file=.env.local scripts/curation-list.ts --top 15
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

interface PoolRow {
  id: string;
  name: string;
  google_place_id: string | null;
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const top = Number(arg("--top") ?? 12);

  const electable = PLACE_CATEGORIES.filter(
    (c) => !GRAMMAR_PARAMS.pacing.foodCategories.includes(c),
  );

  head("ANCHOR CURATION WORKSHEET");
  line("  For each category: which of these is a DAY'S CENTREPIECE — a place");
  line("  someone plans a day around — rather than a good stop?");
  line();
  line("  Tick the ones that qualify. They go into FOUNDER_ANCHOR_WORTHY in");
  line("  src/shared/anchor-calibre.ts (tier 1, operator trust) and from then");
  line("  on they outrank the rating-count proxy in both directions.");
  line();
  line("  Your own examples, already recorded from the Session 12 verdict:");
  line("    Canada's Wonderland · Toronto Zoo · African Lion Safari");

  for (const category of electable) {
    const { data, error } = await client
      .from("places")
      .select("id, name, google_place_id, facts!inner(fact_key, value)")
      .eq("city", "toronto")
      .eq("source", "fsq_os_places")
      .eq("facts.fact_key", "categories")
      .filter("facts.value->mapped", "cs", JSON.stringify([category]))
      // Linked places first: a Google link means Session 4's ranked
      // discovery surfaced it, which is the only pre-fetch quality signal
      // the pool carries at all.
      .order("google_place_id", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true })
      .limit(400);
    if (error) throw new Error(`${category}: ${error.message}`);

    const rows = (data ?? []) as unknown as PoolRow[];
    const linked = rows.filter((r) => r.google_place_id !== null);
    const curated = FOUNDER_ANCHOR_WORTHY[category] ?? [];

    head(`${category.toUpperCase()}  (${rows.length} in pool, ${linked.length} Google-linked)`);
    const shown = linked.slice(0, top);
    if (shown.length === 0) {
      line("  (no Google-linked places in this category — nothing to rank)");
    }
    for (const row of shown) {
      const already = curated.some((c) => matchesCuratedName(row.name, c));
      line(`  [${already ? "x" : " "} ] ${row.name}`);
    }

    /**
     * Curated entries the pool cannot serve are a POOL GAP, and a founder
     * ticking a name no identity matches would never find out.
     *
     * Checked with a query PER NAME across the whole city rather than
     * against `rows` above — `rows` is capped at 400, so testing membership
     * in it would report anything past the cap as missing. That would be a
     * confident wrong answer about the pool, which is worse than no answer.
     */
    const unmatched: string[] = [];
    const presentButUnlinked: string[] = [];
    for (const name of curated) {
      // Prefilter on the LONGEST token, not the first. "St Lawrence Market"
      // prefiltered on "St" matched hundreds of unrelated places and the
      // 200-row cap cut the real one off, so the check reported a curated
      // market as absent while the worksheet listed it three lines above.
      // The most selective token keeps the candidate set small enough that
      // the cap cannot decide the answer.
      const token = name
        .replace(/[’']/g, "")
        .split(/\s+/)
        .reduce((a, b) => (b.length > a.length ? b : a), "");
      const { data: hits, error: hitErr } = await client
        .from("places")
        .select("id, name, google_place_id")
        .eq("city", "toronto")
        .ilike("name", `%${token}%`)
        .limit(1000);
      if (hitErr) throw new Error(`${category}/${name}: ${hitErr.message}`);
      const matches = (hits ?? []).filter((h) =>
        matchesCuratedName((h as { name: string }).name, name),
      ) as { name: string; google_place_id: string | null }[];
      if (matches.length === 0) {
        unmatched.push(name);
      } else if (matches.every((m) => m.google_place_id === null)) {
        presentButUnlinked.push(`${name} → "${matches[0].name}"`);
      }
    }
    if (unmatched.length > 0) {
      line();
      line(`  ALREADY CURATED BUT ABSENT FROM THE POOL — ${unmatched.length}:`);
      for (const name of unmatched) line(`    · ${name}`);
      line(
        `    These cannot be elected today. Either the identity is missing from`,
      );
      line(
        `    the pool, or it is outside Toronto's bbox (the founder's three own`,
      );
      line(`    examples are all out-of-city — that is XXX-38's excursion work).`);
    }

    /**
     * In the pool, but carrying no Google link — so `freshness` scores them
     * 0.4, they are less likely to be shortlisted, and a candidate that is
     * never shortlisted never gets a Details fetch, never gets a rating
     * count, and so can never clear the rating-count bar. Curation is the
     * only route these have to the anchor menu, which is an argument FOR
     * the list rather than a problem with it — but it needs saying.
     */
    if (presentButUnlinked.length > 0) {
      line();
      line(`  IN THE POOL BUT UNLINKED — ${presentButUnlinked.length}:`);
      for (const entry of presentButUnlinked) line(`    · ${entry}`);
      line(`    No Google link, so no Details fetch, so no rating count. Only`);
      line(`    tier-1 curation can make these electable as a centrepiece.`);
    }
  }

  head("HOW TO RETURN THIS");
  line("  Reply with the ticked names per category, or edit");
  line("  FOUNDER_ANCHOR_WORTHY directly — it is a plain list in a reviewed");
  line("  commit, which is the whole reason it is a file and not a table.");
  line();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
