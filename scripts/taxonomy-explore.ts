import { CATEGORIES_PARQUET_GLOB } from "../src/server/base-layer/dataset";
import { connectFsq } from "../src/server/base-layer/extract";

/**
 * Read the pinned FSQ release's own taxonomy (XXX-37, Session 13 Step 3).
 *
 * Vocabulary v2 adds `shopping`, `scenic_viewpoints` and `grocery`, and each
 * needs breadcrumb rules. Writing those rules from memory of what Foursquare
 * "probably" calls things is how you get a rule that matches zero labels —
 * or worse, one that matches a branch you did not intend and only shows up
 * as noise in a founder's day three sessions later.
 *
 * So: list the actual labels first. This prints every label under a given
 * top-level branch, with its ID, so the mapping table in SESSION_NOTES is
 * transcribed from the taxonomy rather than recalled.
 *
 * FREE: the categories table is a small taxonomy file, not the places
 * parquet. Read-only, no writes, no Google, no Anthropic.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/taxonomy-explore.ts --branch Retail
 *   npx tsx --env-file=.env.local scripts/taxonomy-explore.ts --branch "Landmarks and Outdoors"
 *   npx tsx --env-file=.env.local scripts/taxonomy-explore.ts --top-levels
 */

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const has = (flag: string): boolean => process.argv.includes(flag);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const connection = await connectFsq(requireEnv("HF_TOKEN"));

  // The categories table's column names are read off the release itself
  // rather than assumed — a schema guess here would fail confusingly.
  const schema = await connection.runAndReadAll(
    `describe select * from read_parquet('${CATEGORIES_PARQUET_GLOB}') limit 1`,
  );
  const columns = schema.getRows().map((r) => String(r[0]));
  console.log(`columns: ${columns.join(", ")}`);

  const idCol = columns.find((c) => c.includes("id")) ?? columns[0];
  const labelCol =
    columns.find((c) => c.includes("label")) ??
    columns.find((c) => c.includes("name")) ??
    columns[1];
  console.log(`using id=${idCol} label=${labelCol}`);
  console.log();

  if (has("--top-levels")) {
    const reader = await connection.runAndReadAll(
      `select split_part(${labelCol}, ' > ', 1) as top, count(*)::bigint as n
         from read_parquet('${CATEGORIES_PARQUET_GLOB}')
        group by 1 order by 1`,
    );
    for (const row of reader.getRows()) {
      console.log(`  ${String(row[1]).padStart(5)}  ${String(row[0])}`);
    }
    return;
  }

  const branch = arg("--branch");
  if (branch === null) {
    console.error("pass --branch <top-level> or --top-levels");
    process.exit(1);
  }
  const reader = await connection.runAndReadAll(
    `select ${idCol} as id, ${labelCol} as label
       from read_parquet('${CATEGORIES_PARQUET_GLOB}')
      where label like '${branch.replace(/'/g, "''")}%'
      order by label`,
  );
  const rows = reader.getRows();
  console.log(`${rows.length} labels under "${branch}":`);
  for (const row of rows) {
    console.log(`  ${String(row[0])}  ${String(row[1])}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
