import { createClient } from "@supabase/supabase-js";
import {
  CUISINE_LABELS,
  CUISINE_PREFIXES,
  CUISINE_TAGS,
  cuisinesFromLabels,
  RESTAURANT_BRANCH,
  type CuisineTag,
} from "../src/shared/cuisine";

/**
 * Cuisine fire proof (XXX-43, Session 15) — the instrument of record for the
 * label→cuisine map.
 *
 * WHY THIS EXISTS, and why it exits non-zero. Session 13 lost three sessions
 * to `"Retail > Farmers Market"`, a category rule that matched NOTHING while
 * two live sibling rules kept the category non-empty, so the zero-match guard
 * — which fired per CATEGORY — never tripped. Every farmers market in Toronto
 * was unreachable and nothing said so. The law that came out of it:
 *
 *   A rule asserts that a branch exists — assert it PER RULE, or a dead one
 *   hides behind its live siblings.
 *
 * So this checks each CUISINE independently, and each PREFIX within it. A
 * cuisine chip we offer the founder that can never be served is exactly the
 * same defect wearing a new hat.
 *
 * It also honours the sampler lesson (Session 13): the samples below are
 * drawn with a SPREAD across the matched set rather than off the top, because
 * an instrument that always looks at the same corner of its data will
 * eventually accuse the data. The top-of-list view is printed too, but it is
 * labelled as what it is.
 *
 * FREE and read-only: DB reads only, no Google, no Anthropic, no writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/cuisine-report.ts
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 62 - s.length))}`);
};

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

async function main() {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  // Page the whole fact table; the row cap is the enemy of an absence claim
  // (Session 14: an instrument that lies about ABSENCE is worse than none).
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

  // Names, for the samples. One query, same pagination discipline.
  const names = new Map<string, string>();
  from = 0;
  for (;;) {
    const res = await client
      .from("places")
      .select("id, name")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(`places page failed: ${res.error.message}`);
    for (const r of res.data as { id: string; name: string }[]) names.set(r.id, r.name);
    if (!res.data || res.data.length < PAGE) break;
    from += PAGE;
  }

  const matched = new Map<CuisineTag, string[]>();
  for (const t of CUISINE_TAGS) matched.set(t, []);
  const prefixHits = new Map<string, number>();
  for (const t of CUISINE_TAGS) {
    for (const p of CUISINE_PREFIXES[t]) prefixHits.set(`${t}::${p}`, 0);
  }

  let restaurants = 0;
  let tagged = 0;
  /** No cuisine leaf at all — the taxonomy itself said nothing. */
  let bare = 0;
  /** Has a cuisine leaf, but not one of the five we offer. */
  let unoffered = 0;

  for (const f of facts) {
    const labels = f.value?.source_labels ?? [];
    if (!f.value?.mapped?.includes("restaurants")) continue;
    restaurants++;

    const tags = cuisinesFromLabels(labels);
    const hasAnyLeaf = labels.some(
      (l) => l.startsWith(RESTAURANT_BRANCH + " > ") && l.length > RESTAURANT_BRANCH.length + 3,
    );
    if (tags.length > 0) tagged++;
    else if (hasAnyLeaf) unoffered++;
    else bare++;
    for (const t of tags) matched.get(t)!.push(f.place_id);

    // Per-PREFIX accounting, so a dead prefix inside a live cuisine shows.
    for (const label of labels) {
      if (!label.startsWith(RESTAURANT_BRANCH + " > ")) continue;
      const sub = label.slice(RESTAURANT_BRANCH.length + 3);
      for (const t of CUISINE_TAGS) {
        for (const p of CUISINE_PREFIXES[t]) {
          if (sub === p || sub.startsWith(p + " > ")) {
            prefixHits.set(`${t}::${p}`, (prefixHits.get(`${t}::${p}`) ?? 0) + 1);
          }
        }
      }
    }
  }

  head("POOL");
  line(`  places with a categories fact : ${facts.length}`);
  line(`  mapped restaurants            : ${restaurants}`);
  line(
    `  carrying one of our 5 cuisines: ${tagged} (${pct(tagged, restaurants)})`,
  );
  line(
    `  labelled, but not one we offer: ${unoffered} (${pct(unoffered, restaurants)})`,
  );
  line(
    `  no cuisine leaf at all        : ${bare} (${pct(bare, restaurants)})`,
  );
  line();
  line("  The middle row is NOT honest absence — those venues have a cuisine");
  line("  (Pizzeria, Diner, Mexican, Caribbean…); we simply do not offer it as");
  line("  a chip. Only the last row is a place the taxonomy could not name.");

  head("PER CUISINE — the fire proof");
  line("  Cuisine totals are PLACES. Prefix rows are LABEL hits, and a place");
  line("  carrying both a parent and a child label is counted by each — so");
  line("  prefix rows can exceed the cuisine total. Not a discrepancy.");
  line();
  const dead: string[] = [];
  for (const tag of CUISINE_TAGS) {
    const ids = matched.get(tag)!;
    const flag = ids.length === 0 ? "  ← DEAD" : "";
    line(
      `  ${CUISINE_LABELS[tag].padEnd(15)} ${String(ids.length).padStart(5)} places${flag}`,
    );
    if (ids.length === 0) dead.push(`cuisine "${tag}" matched nothing`);

    for (const p of CUISINE_PREFIXES[tag]) {
      const n = prefixHits.get(`${tag}::${p}`) ?? 0;
      const pflag = n === 0 ? "  ← DEAD PREFIX" : "";
      line(`      ${String(n).padStart(5)}  ${p}${pflag}`);
      if (n === 0) dead.push(`prefix "${p}" (${tag}) matched nothing`);
    }
  }

  head("SAMPLES — spread, not the top of the list");
  for (const tag of CUISINE_TAGS) {
    const ids = matched.get(tag)!;
    if (ids.length === 0) continue;
    // Even strides across the matched set: the middle and tail get seen.
    const picks: string[] = [];
    const stride = Math.max(1, Math.floor(ids.length / 5));
    for (let i = 0; i < ids.length && picks.length < 5; i += stride) {
      const n = names.get(ids[i]!);
      if (n) picks.push(n);
    }
    line(`  ${CUISINE_LABELS[tag]}:`);
    for (const p of picks) line(`      ${p}`);
  }

  if (dead.length > 0) {
    head("FAILED");
    for (const d of dead) line(`  ✗ ${d}`);
    line();
    line("  A cuisine we offer that cannot be served is the farmers-market");
    line("  defect wearing a new hat. Fix the prefix or drop the cuisine.");
    process.exit(1);
  }

  head("PASS");
  line("  Every cuisine and every prefix matched live pool rows.");
}

const pct = (n: number, of: number) =>
  of === 0 ? "0%" : `${((100 * n) / of).toFixed(1)}%`;

void main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
