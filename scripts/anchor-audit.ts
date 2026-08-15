import { COMPOSE_PARAMS } from "../src/server/generation/compose-params";
import { buildSkeleton } from "../src/server/generation/compose";
import { resolveSeed } from "../src/server/generation/engine";
import type { GenerationRequest } from "../src/server/generation/types";
import { GRAMMAR_PARAMS } from "../src/shared/day-grammar/params";
import { GOLDEN_PERSONAS } from "../src/shared/persona";
import type { PlaceCategory } from "../src/shared/vocabulary";

/**
 * Anchor calibre audit (XXX-35, Session 13 Step 2, mining finding 1).
 *
 * The founder's verdict was "An anchor that lasts only 20 mins? The anchor
 * should be a highlight, not just anything random." Session 12 found the
 * mechanism: `dwellMinutes[c].min` was both the GRAMMAR floor and the
 * composer's DROP floor, so a narrow slice degraded the day's centre to the
 * category minimum — 20 minutes for a park — and seated it in silence.
 *
 * This measures how often the split floor (`COMPOSE_PARAMS.anchor
 * .minDwellMinutes`) actually binds, across every golden persona and a
 * sweep of seeds. It is the evidence the 75 is calibrated against, and it
 * reports the DISTRIBUTION rather than a verdict — a floor nobody measured
 * is the load-bearing constant this session keeps finding.
 *
 * PURE and FREE: no DB, no Google, no Anthropic. Skeleton composition only.
 *
 * Usage:
 *   npx tsx scripts/anchor-audit.ts
 *   npx tsx scripts/anchor-audit.ts --seeds 500 --date 2026-08-15
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

const seedCount = Number(arg("--seeds") ?? 200);
const date = arg("--date") ?? "2026-08-15";
const FLOOR = COMPOSE_PARAMS.anchor.minDwellMinutes;

interface Row {
  persona: string;
  category: PlaceCategory;
  fitted: number;
  degraded: boolean;
}

const rows: Row[] = [];

for (const key of Object.keys(GOLDEN_PERSONAS)) {
  const persona = GOLDEN_PERSONAS[key];
  for (let seed = 0; seed < seedCount; seed += 1) {
    const request: GenerationRequest = {
      city: "toronto",
      date,
      persona,
      budgetBand: null,
      transport: ["walk", "transit"],
      seed,
    };
    const skeleton = buildSkeleton(request, { seed: resolveSeed(request) });
    const anchor = skeleton.intents.find((i) => i.role === "anchor");
    if (anchor === undefined) continue;
    rows.push({
      persona: key,
      category: anchor.categories[0],
      fitted: anchor.dwellMinutes,
      degraded: skeleton.anchorDegraded !== null,
    });
  }
}

head(`ANCHOR DWELL, AS COMPOSED — ${rows.length} skeletons`);
line(`  calibre floor (COMPOSE_PARAMS.anchor.minDwellMinutes): ${FLOOR} min`);
line();
line("  For contrast, the GRAMMAR floors this used to share:");
for (const [category, range] of Object.entries(GRAMMAR_PARAMS.dwellMinutes)) {
  line(
    `    ${category.padEnd(18)} min ${String(range.min).padStart(3)}  typical ${String(range.typical).padStart(3)}`,
  );
}

head("PER PERSONA");
for (const key of Object.keys(GOLDEN_PERSONAS)) {
  const mine = rows.filter((r) => r.persona === key);
  if (mine.length === 0) continue;
  const degraded = mine.filter((r) => r.degraded).length;
  const dwells = mine.map((r) => r.fitted).sort((a, b) => a - b);
  const min = dwells[0];
  const median = dwells[Math.floor(dwells.length / 2)];
  const max = dwells[dwells.length - 1];
  const cats = new Map<string, number>();
  for (const r of mine) cats.set(r.category, (cats.get(r.category) ?? 0) + 1);
  line(
    `  ${key.padEnd(18)} dwell min/median/max ${String(min).padStart(3)}/${String(median).padStart(3)}/${String(max).padStart(3)}` +
      `   below calibre: ${degraded}/${mine.length} (${((degraded / mine.length) * 100).toFixed(1)}%)`,
  );
  line(
    `    ${[...cats]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}×${n}`)
      .join(" · ")}`,
  );
}

head("DWELL HISTOGRAM (all personas)");
const buckets = new Map<string, number>();
for (const r of rows) {
  const b = `${Math.floor(r.fitted / 15) * 15}-${Math.floor(r.fitted / 15) * 15 + 14}`;
  buckets.set(b, (buckets.get(b) ?? 0) + 1);
}
for (const [bucket, n] of [...buckets].sort(
  (a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0]),
)) {
  const low = Number(bucket.split("-")[0]);
  const mark = low + 14 < FLOOR ? " ← below calibre" : "";
  line(
    `  ${bucket.padStart(7)} min  ${String(n).padStart(4)}  ${"▪".repeat(Math.min(50, Math.round(n / 4)))}${mark}`,
  );
}

const degraded = rows.filter((r) => r.degraded).length;
head("VERDICT");
line(
  `  ${degraded} of ${rows.length} skeletons (${((degraded / rows.length) * 100).toFixed(1)}%) seat a centre below ${FLOOR} min.`,
);
if (degraded === 0) {
  line();
  line(`  No day's centre is window-degraded at these seeds. Worth reading`);
  line(`  precisely: it means the SHAPE can hold a centrepiece, not that every`);
  line(`  centrepiece deserves the name. Which VENUE fills it is the calibre`);
  line(`  question, and dwell cannot answer it — a pocket park and the Islands`);
  line(`  are still the same 75 minutes here.`);
} else {
  line();
  line(`  Every one of those was seated SILENTLY before Session 13, with the`);
  line(`  trace reporting the elected dwell rather than the seated one.`);
}
line();
