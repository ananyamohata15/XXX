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
    /**
     * RANKED, not sliced — fixed at XXX-41 (Session 16 CP4).
     *
     * This was `rows.filter(...).slice(0, 6)`: six arbitrary rows in whatever
     * order PostgREST happened to return them, offered to the founder under
     * the words *"pick the right one"*. When the right one is not in the
     * arbitrary six, the only available reading is that it does not exist.
     *
     * That is exactly what happened, and it reached the record. Session 15's
     * close-out lists **"Yorkdale — mall absent, only tenants"** and the same
     * for Sherway Gardens. Both malls are IN THE POOL. Querying "Yorkdale"
     * returns "Lucky Yorkdale", "Aburi TORA Yorkdale", "Mac's Sushi Yorkdale
     * Mall open again!"… and `Yorkdale Shopping Centre` sitting outside the
     * first six.
     *
     * This is the sampler lesson (Session 13's alphabetical `shopping`
     * spot-check) meeting the absence lesson (Session 14's apostrophe-stripped
     * `%Hanlans%`) in one line — and it is the SECOND time an instrument of
     * this script's own family has turned a bad sample into a recorded pool
     * gap. The apostrophe half was fixed; the sampling half was not, because
     * nobody had asked it about a name whose canonical form is longer than
     * the one a person says.
     *
     * Ranking is by how close the pool's spelling is to the asked-for name:
     * a row that CONTAINS the query as a whole phrase first (a mall's
     * official name extends what people call it), then fewest extra
     * characters, then alphabetical so the order is stable and a re-run is
     * reproducible. And the count of rows NOT shown is printed, so a short
     * list can never again read as a complete one.
     */
    const norm = normalizeName(wanted);
    const near = rows
      .filter((r) => !exact.includes(r))
      .map((r) => {
        const rowNorm = normalizeName(r.name);
        return {
          row: r,
          // 0 = the pool's name is the asked-for name plus more (the usual
          // shape of an official name); 1 = merely contains the token.
          rank: rowNorm.startsWith(norm) ? 0 : rowNorm.includes(norm) ? 1 : 2,
          extra: Math.abs(rowNorm.length - norm.length),
        };
      })
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.extra - b.extra ||
          a.row.name.localeCompare(b.row.name),
      );
    const NEAR_SHOWN = 8;
    const shown = near.slice(0, NEAR_SHOWN).map((n) => n.row);

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
    if (shown.length > 0) {
      line(
        `   near names, closest spelling first (${shown.length} of ${near.length}` +
          `${near.length > shown.length ? ` — ${near.length - shown.length} NOT SHOWN, so this list is not evidence of absence` : ""}):`,
      );
      for (const r of shown) {
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
