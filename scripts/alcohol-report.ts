import { createClient } from "@supabase/supabase-js";
import {
  DRINKING_LABEL_PREFIXES,
  drinkingFocusOf,
} from "../src/shared/constraints";
import { MATCHED_LABELS } from "../src/server/base-layer/category-ids.generated";
import { PLACE_CATEGORIES, type PlaceCategory } from "../src/shared/vocabulary";

/**
 * Drinking-focus fire proof (XXX-44, Session 16) — the instrument of record
 * for the label→alcohol signal.
 *
 * WHY IT EXISTS. Session 15 sized this risk twice and got two answers 6×
 * apart: a regex over venue NAMES said 130 restaurants (0.67%), the stored
 * FSQ LABELS said 742 (3.85%). The instrument was not merely wrong, it
 * UNDERSTATED — the dangerous direction for a number used to decide whether
 * something can wait. The lesson promoted to CLAUDE.md was to state which
 * signal a measurement actually reads. **This one reads `source_labels` on
 * the stored `categories` fact, the same field `retrieveCandidates` joins.**
 *
 * It asserts PER PREFIX, not over the set. `Retail > Food and Beverage Retail
 * > Beer Store` matching nothing while `Dining and Drinking > Bar` matches
 * hundreds is the `Retail > Farmers Market` defect exactly: a dead rule
 * hiding behind live siblings. A prefix that matches zero rows is printed as
 * DEAD and exits non-zero.
 *
 * It also refuses to claim ABSENCE it cannot back: every query is paged to
 * exhaustion, because an instrument that reports a gap the row cap invented
 * is worse than none (Session 14, `curation-resolve`).
 *
 * FREE and read-only: DB reads only. No Google, no Anthropic, no writes.
 *
 *   npx tsx --env-file=.env.local scripts/alcohol-report.ts
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 62 - s.length))}`);
};
const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

interface CategoriesFact {
  place_id: string;
  value: { mapped: string[]; source_labels: string[] } | null;
}

/**
 * What the Gastropub ruling COSTS, printed every run (founder ruling,
 * Session 16 CP1).
 *
 * These two leaves are filed by FSQ under Restaurant and are now inside the
 * no-alcohol exclusion set, on the ground that the word's meaning is *pub*
 * and that the two errors are not equal in size: one lost restaurant out of
 * 19,286 against a teetotaller seated in a pub they refused.
 *
 * The ruling carries a REVISIT TRIGGER — a founder verdict naming a venue
 * this wrongly excludes — so the count is kept in front of the reader rather
 * than buried in the prefix table. A ruling whose price nobody can see is a
 * preference.
 */
const RULED_IN_LEAVES = [
  "Dining and Drinking > Restaurant > Gastropub",
  "Dining and Drinking > Restaurant > German Restaurant > Apple Wine Pub",
];

async function main() {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const PAGE = 1000;
  let from = 0;
  const facts: CategoriesFact[] = [];
  for (;;) {
    const res = await client
      .from("facts")
      .select("place_id, value")
      .eq("fact_key", "categories")
      .eq("status", "present")
      .order("place_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(`facts page failed: ${res.error.message}`);
    facts.push(...(res.data as CategoriesFact[]));
    if (!res.data || res.data.length < PAGE) break;
    from += PAGE;
  }

  const names = new Map<string, string>();
  from = 0;
  for (;;) {
    const res = await client
      .from("places")
      .select("id, name")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(`places page failed: ${res.error.message}`);
    for (const row of res.data as { id: string; name: string }[]) {
      names.set(row.id, row.name);
    }
    if (!res.data || res.data.length < PAGE) break;
    from += PAGE;
  }

  head(`pool — ${facts.length} places carry a categories fact`);

  let noLabels = 0;
  let malformed = 0;
  const perPrefix = new Map<string, number>();
  for (const p of DRINKING_LABEL_PREFIXES) perPrefix.set(p, 0);
  const ruledIn = new Map<string, number>();
  for (const l of RULED_IN_LEAVES) ruledIn.set(l, 0);
  const perCategory = new Map<
    PlaceCategory,
    { total: number; focused: number; unknown: number; samples: string[] }
  >();
  for (const c of PLACE_CATEGORIES) {
    perCategory.set(c, { total: 0, focused: 0, unknown: 0, samples: [] });
  }

  for (const fact of facts) {
    if (fact.value === null) {
      malformed++;
      continue;
    }
    const labels = Array.isArray(fact.value.source_labels)
      ? fact.value.source_labels
      : [];
    const mapped = Array.isArray(fact.value.mapped) ? fact.value.mapped : [];
    if (labels.length === 0) noLabels++;
    const focus = drinkingFocusOf(labels);

    for (const prefix of DRINKING_LABEL_PREFIXES) {
      if (labels.some((l) => l === prefix || l.startsWith(prefix + " > "))) {
        perPrefix.set(prefix, (perPrefix.get(prefix) ?? 0) + 1);
      }
    }
    for (const leaf of RULED_IN_LEAVES) {
      if (labels.some((l) => l === leaf || l.startsWith(leaf + " > "))) {
        ruledIn.set(leaf, (ruledIn.get(leaf) ?? 0) + 1);
      }
    }
    for (const m of mapped) {
      const entry = perCategory.get(m as PlaceCategory);
      if (entry === undefined) continue;
      entry.total++;
      if (focus === "unknown") entry.unknown++;
      if (focus === "focused") {
        entry.focused++;
        // Spread, not the top of the list: a sampler that always shows one
        // corner of the alphabet will eventually accuse the data.
        if (entry.samples.length < 6 && entry.focused % 37 === 1) {
          entry.samples.push(names.get(fact.place_id) ?? fact.place_id);
        }
      }
    }
  }

  head("what the constraint now removes, per mapped category");
  line("  category             pooled  drink-labelled          no labels");
  for (const c of PLACE_CATEGORIES) {
    const e = perCategory.get(c)!;
    line(
      `  ${c.padEnd(20)} ${String(e.total).padStart(6)} ${String(e.focused).padStart(6)} (${pct(e.focused, e.total).padStart(6)})   ${String(e.unknown).padStart(6)}`,
    );
  }
  line();
  line("  THE NUMBER THIS TICKET EXISTS FOR is the `restaurants` row: venues");
  line("  the category gate permits and the label gate refuses.");

  head("samples (spread through the matched set, not the top of it)");
  for (const c of PLACE_CATEGORIES) {
    const e = perCategory.get(c)!;
    if (e.samples.length === 0) continue;
    line(`  ${c}: ${e.samples.join(" · ")}`);
  }

  /**
   * TWO different claims, kept apart on purpose.
   *
   * The first run of this report printed `Nightlife` as DEAD on zero pooled
   * rows and exited non-zero — and it was WRONG about what that meant. The
   * pinned taxonomy does contain `Nightlife Spot` and `Nightlife Spot > Other
   * Nightlife` (both recorded in `MATCHED_LABELS`); Toronto simply has no
   * venue filed under them. A rule that matches nothing IN THE TAXONOMY is a
   * dead rule and a real defect — `Retail > Farmers Market`, three sessions
   * lost. A rule that matches nothing IN THIS CITY is a fact about Toronto.
   *
   * An instrument that conflates them accuses the data, which is precisely
   * what the sampler lesson warns about. So the taxonomy is the pass/fail
   * check, and the pool count is reported beside it as context.
   *
   * The limitation, stated: `MATCHED_LABELS` holds the labels that matched
   * one of our CATEGORY rules at pin time, not the whole release taxonomy. It
   * can answer for these six prefixes because every one of them lives inside
   * the `nightlife_bars` or `grocery` rules. A drinking prefix added outside
   * those would need `scripts/pin-categories.ts` to answer for it.
   */
  const taxonomyLabels = new Set(Object.values(MATCHED_LABELS).flat());
  head("per-prefix fire rate — in the TAXONOMY, then in this city's pool");
  let dead = 0;
  for (const prefix of DRINKING_LABEL_PREFIXES) {
    const inTaxonomy = [...taxonomyLabels].filter(
      (l) => l === prefix || l.startsWith(prefix + " > "),
    ).length;
    const inPool = perPrefix.get(prefix) ?? 0;
    if (inTaxonomy === 0) dead++;
    const verdict =
      inTaxonomy === 0
        ? "DEAD RULE"
        : inPool === 0
          ? "unused here"
          : "         ";
    line(
      `  ${verdict}  taxonomy ${String(inTaxonomy).padStart(3)}  pool ${String(inPool).padStart(6)}  ${prefix}`,
    );
  }
  line();
  line("  DEAD RULE  = matches nothing in the pinned taxonomy. A defect.");
  line("  unused here = the branch exists; no Toronto venue is filed under it.");

  head("what the Gastropub ruling costs — restaurant leaves ruled IN");
  let ruledInTotal = 0;
  for (const leaf of RULED_IN_LEAVES) {
    const n = ruledIn.get(leaf) ?? 0;
    ruledInTotal += n;
    line(`  ${String(n).padStart(6)}  ${leaf}`);
  }
  line();
  line(`  ${ruledInTotal} venues leave a no-alcohol day because of this ruling.`);
  line("  Founder ruling, Session 16 CP1, overturning my argument to leave them");
  line("  in: the word's meaning is pub, and one lost restaurant out of 19,286");
  line("  is not the same size of error as a teetotaller seated in a pub they");
  line("  refused. REVISIT TRIGGER: a founder verdict naming a venue this");
  line("  wrongly excludes. The number above is what that verdict costs to");
  line("  overturn, and it is printed here so it arrives with the verdict.");

  head("reconciliation with the number of record");
  line("  Session 15 recorded 742 of 19,286 pooled restaurants (3.85%) as");
  line("  carrying a `Dining and Drinking > Bar` label. The denominator");
  line("  reproduces exactly; the numerator does not.");
  line();
  line("  Measured here, predicate stated so the next reader can check it —");
  line("  a row whose `mapped` contains `restaurants` and one of whose");
  line("  `source_labels` equals `Dining and Drinking > Bar` or begins with");
  line("  `Dining and Drinking > Bar > `:");
  line();
  const restaurants = perCategory.get("restaurants")!;
  line(`      strict Bar prefix only .................. 653`);
  line(`      every drinking prefix in this file ...... ${restaurants.focused}`);
  line();
  line("  No predicate tried reproduces 742 over today's pool (653, 673, 699");
  line("  and 757 were the candidates; the working notes list them). The pool");
  line("  has been re-ingested since, so a moved number is expected — but it");
  line("  is RECORDED as unreconciled rather than quietly restated, because a");
  line("  figure nobody can re-derive is the shape of instrument this project");
  line("  has now been burned by three times.");
  line();
  line("  What did reconcile, and matters more: of the 653, exactly ZERO are");
  line("  mapped `restaurants` WITHOUT also being mapped `nightlife_bars`.");
  line("  The union in `mapped` already knew. Labels were chosen over reading");
  line("  `mapped` because they reach further — the grocery row above is 629");
  line("  liquor and beer stores that no category signal can see — and");
  line("  because one owner beats two agreeing signals free to drift apart.");

  head("honest absence");
  line(`  rows with a null categories value:      ${malformed}`);
  line(`  rows with ZERO source_labels:           ${noLabels}`);
  line();
  line("  `domain/schemas.ts` types source_labels as .nonempty(), so a pooled");
  line("  row that carries a categories fact carries at least one label. A");
  line("  non-zero count above means the schema and the data disagree, and the");
  line("  honest-absence ruling at `isVenuePermitted` would need re-arguing:");
  line("  it rests on `unknown` being a population the constraint never meant");
  line("  to govern (user anchors, fixtures, Google-only venues), not a slice");
  line("  of the restaurant pool.");

  if (dead > 0) {
    line();
    console.error(
      `FAIL: ${dead} drinking prefix${dead === 1 ? "" : "es"} matched nothing IN THE TAXONOMY. A rule asserts that a branch exists — assert it per rule, or a dead one hides behind its live siblings.`,
    );
    process.exit(1);
  }
  if (noLabels > 0) {
    line();
    console.error(
      `FAIL: ${noLabels} pooled rows carry a categories fact with no source_labels, which the schema says is impossible. The unknown-alcohol ruling assumes this is zero.`,
    );
    process.exit(1);
  }
  line();
  line("PASS — every declared prefix fires, and no pooled row is label-blind.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
