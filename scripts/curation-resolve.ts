import { createClient } from "@supabase/supabase-js";
import { normalizeName, prefilterToken } from "../src/shared/anchor-calibre";

/** How many rows the prefilter may return before its verdict is unsafe. */
const ROW_CAP = 1000;

/**
 * Resolve founder-curated names to POOL IDENTITIES (XXX-35, Session 13).
 *
 * `FOUNDER_ANCHOR_WORTHY` is keyed by CATEGORY, and `anchorCalibre` looks a
 * candidate up under the candidate's OWN category. So an entry filed under
 * the wrong key never matches anything and fails silently — the worst
 * possible failure for the highest-trust signal in the system, because it
 * looks exactly like a curated list that is simply not being consulted.
 *
 * Matching is EXACT-normalized (see `matchesCuratedName` for the four false
 * admits that killed the fuzzy version), so a curated entry must also carry
 * the pool's own spelling. A founder writing "Casa Lom" or "Royal Ontario
 * Museum" is curating a place, not transcribing a database.
 *
 * This closes both gaps: for each name it reports every pool identity that
 * plausibly matches, the categories that identity is actually MAPPED to, and
 * whether the exact-match rule would fire. Nothing is written — the founder's
 * list is edited in a reviewed commit, deliberately.
 *
 * FREE and read-only: pool reads only. No Google, no Anthropic, no writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/curation-resolve.ts "Casa Loma" "Royal Ontario Museum"
 */

const line = (s = "") => console.log(s);

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
  const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (names.length === 0) {
    console.error('Pass one or more names: curation-resolve.ts "High Park"');
    process.exit(1);
  }

  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  for (const wanted of names) {
    /**
     * Prefilter on the LONGEST ALPHANUMERIC RUN — the most selective token
     * that cannot disagree with the pool's own spelling.
     *
     * This line used to strip apostrophes from the QUERY and then `ilike`
     * against RAW pool names, so `"Hanlan's Point"` searched for `Hanlans`
     * and found nothing while `Hanlan's Point Beach` sat in the pool. The
     * script reported NOT IN POOL, and that verdict reached Session 13's
     * close-out as a recorded pool gap for two identities that are both
     * present. See `prefilterToken` for the full account.
     */
    const token = prefilterToken(wanted);
    const { data, error } = await client
      .from("places")
      .select("id, name, google_place_id, facts(fact_key, value)")
      .eq("city", "toronto")
      .ilike("name", `%${token}%`)
      .limit(ROW_CAP);
    if (error) throw new Error(`${wanted}: ${error.message}`);

    const rows = (data ?? []) as unknown as Row[];
    const mappedOf = (r: Row): string[] =>
      r.facts?.find((f) => f.fact_key === "categories")?.value?.mapped ?? [];

    line();
    line(`── "${wanted}"`);
    if (rows.length === 0) {
      line(`   NOT IN POOL — no identity contains "${token}"`);
      continue;
    }
    /**
     * A prefilter that hit its own cap cannot support an absence verdict.
     * The rows returned are an arbitrary slice, so "no exact match among
     * them" is not "no exact match in the pool" — and this script's whole
     * job is to be trusted about absence.
     */
    if (rows.length >= ROW_CAP) {
      line(
        `   ⚠ prefilter "${token}" hit the ${ROW_CAP}-row cap — an absence verdict below is NOT safe.`,
      );
      line(`     Re-run with a longer, more distinctive spelling of this name.`);
    }
    const exact = rows.filter(
      (r) => normalizeName(r.name) === normalizeName(wanted),
    );
    const near = rows
      .filter((r) => !exact.includes(r))
      .slice(0, 6);

    if (exact.length > 0) {
      for (const r of exact) {
        const cats = mappedOf(r);
        line(
          `   EXACT MATCH ✓  "${r.name}"  → categories: [${cats.join(", ") || "NONE"}]` +
            `${r.google_place_id !== null ? "  🔗linked" : "  (unlinked)"}`,
        );
        if (cats.length === 0) {
          line(
            `      WARNING: mapped to no category — it can never be retrieved, so curating it does nothing.`,
          );
        } else {
          line(
            `      → file it under: ${cats.map((c) => `\`${c}\``).join(" AND ")}  (one entry per category it must anchor)`,
          );
        }
      }
    } else {
      line(`   NO EXACT MATCH — the curated spelling would never fire.`);
    }
    if (near.length > 0) {
      line(`   near names in the pool, for the founder to pick the right one:`);
      for (const r of near) {
        line(
          `      "${r.name}"  [${mappedOf(r).join("/") || "unmapped"}]${r.google_place_id !== null ? " 🔗" : ""}`,
        );
      }
    }
  }
  line();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
