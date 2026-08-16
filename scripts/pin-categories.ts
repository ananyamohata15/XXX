import { writeFile } from "node:fs/promises";
import { CATEGORIES_PARQUET_GLOB, DATASET_VERSION } from "../src/server/base-layer/dataset";
import {
  CATEGORY_BREADCRUMB_RULES,
  matchBreadcrumb,
} from "../src/server/base-layer/categories";
import { PLACE_CATEGORIES, type PlaceCategory } from "../src/server/domain/schemas";

/**
 * Pin the category mapping: read the pinned release's OWN categories table,
 * apply the breadcrumb intent rules, and materialize the resulting
 * fsq_category_id → our-category map as generated code (decision 002 /
 * SESSION_NOTES 2.1). Free (open data), network-touching — runs via npx tsx
 * so every invocation prompts.
 *
 * Loud failures: a rule set that matches zero labels for some category is a
 * broken intent (taxonomy drift or a typo) and fails the pin.
 *
 * The full matched-label list is printed for reviewer eyeballing — plain
 * startsWith can over-capture; the report is the guard.
 */

const OUTPUT_PATH = "src/server/base-layer/category-ids.generated.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const { connectFsq } = await import("../src/server/base-layer/extract");
  const connection = await connectFsq(requireEnv("HF_TOKEN"));

  // Record the HF-side release identity: which dt= releases the repo holds
  // and that the pin exists there (ruling: verify and record).
  try {
    const releases = await connection.runAndReadAll(
      `select distinct regexp_extract(file, 'release/(dt=[0-9-]+)/', 1) as release
         from glob('hf://datasets/foursquare/fsq-os-places/release/*/places/parquet/*.parquet')
        order by release`,
    );
    console.log(
      `hf releases visible: ${JSON.stringify(releases.getRowObjectsJson())}`,
    );
  } catch {
    console.log(
      "hf release listing via glob unavailable — pinned-path read below is the existence proof",
    );
  }

  const reader = await connection.runAndReadAll(
    `select category_id, category_label
       from read_parquet('${CATEGORIES_PARQUET_GLOB}')
      order by category_label`,
  );
  const rows = reader.getRowObjectsJson() as {
    category_id: string;
    category_label: string;
  }[];
  console.log(`taxonomy rows read: ${rows.length}`);

  const idMap: Record<string, PlaceCategory> = {};
  const matchedLabels: Record<PlaceCategory, string[]> = Object.fromEntries(
    PLACE_CATEGORIES.map((c) => [c, [] as string[]]),
  ) as Record<PlaceCategory, string[]>;

  for (const row of rows) {
    const category = matchBreadcrumb(row.category_label);
    if (category) {
      idMap[row.category_id] = category;
      matchedLabels[category].push(row.category_label);
    }
  }

  /**
   * The zero-match guard, PER RULE (XXX-37, Session 13 close-out ruling 4).
   *
   * It used to fire per CATEGORY: a category whose rules matched no labels
   * failed the pin. That let a dead rule hide behind live siblings, and one
   * did — `"Retail > Farmers Market"` matched **nothing** from Session 5
   * until Session 13, because the release files farmers markets under the
   * food-retail branch. `markets` had two other rules that matched, so the
   * category was never empty and the guard never spoke. Three sessions of a
   * rule that did nothing, and the cost was every farmers market in Toronto
   * being unreachable.
   *
   * A rule is an assertion that a branch of the taxonomy exists. Asserting
   * it per category tests the SET; asserting it per rule tests the claim.
   */
  const deadRules: string[] = [];
  for (const category of PLACE_CATEGORIES) {
    for (const prefix of CATEGORY_BREADCRUMB_RULES[category]) {
      const hits = rows.filter((r) => r.category_label.startsWith(prefix));
      if (hits.length === 0) {
        deadRules.push(`${category}: "${prefix}"`);
        continue;
      }
      // A rule can also be shadowed: every label it matches is claimed by an
      // EARLIER category in declaration order, so the rule contributes
      // nothing even though the branch exists. Reported, not fatal — the
      // `markets`-before-`grocery` precedence is deliberate and correct.
      const owned = hits.filter(
        (r) => matchBreadcrumb(r.category_label) === category,
      );
      if (owned.length === 0) {
        console.warn(
          `  SHADOWED RULE — ${category}: "${prefix}" matches ${hits.length} label(s), all claimed by an earlier category`,
        );
      }
    }
  }
  if (deadRules.length > 0) {
    console.error(
      `PIN FAILED — ${deadRules.length} rule(s) match zero taxonomy labels:`,
    );
    for (const r of deadRules) console.error(`  ${r}`);
    console.error(
      `A rule asserts a branch of the taxonomy exists. If it matches nothing,`,
    );
    console.error(
      `either the release moved it or the rule is a typo — both need a human.`,
    );
    process.exit(1);
  }

  const empty = PLACE_CATEGORIES.filter((c) => matchedLabels[c].length === 0);
  if (empty.length > 0) {
    console.error(
      `PIN FAILED — rules matched zero taxonomy labels for: ${empty.join(", ")}`,
    );
    console.error(
      `Check CATEGORY_BREADCRUMB_RULES against the release taxonomy:`,
    );
    for (const c of empty) {
      console.error(`  ${c}: ${CATEGORY_BREADCRUMB_RULES[c].join(" | ")}`);
    }
    process.exit(1);
  }

  const file = `import type { PlaceCategory } from "../domain/schemas";

/**
 * GENERATED FILE — written by scripts/pin-categories.ts from the pinned FSQ
 * release's categories table. Do not edit by hand; re-run the pin script.
 */

export const GENERATED_FROM: string | null = ${JSON.stringify(DATASET_VERSION)};

export const CATEGORY_ID_MAP: Readonly<Record<string, PlaceCategory>> =
  ${JSON.stringify(idMap, null, 2)};

export const MATCHED_LABELS: Readonly<
  Partial<Record<PlaceCategory, readonly string[]>>
> = ${JSON.stringify(matchedLabels, null, 2)};
`;
  await writeFile(OUTPUT_PATH, file, "utf8");

  console.log(`\npinned from ${DATASET_VERSION} → ${OUTPUT_PATH}`);
  for (const c of PLACE_CATEGORIES) {
    console.log(`\n${c} (${matchedLabels[c].length} labels):`);
    for (const label of matchedLabels[c]) console.log(`  ${label}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
