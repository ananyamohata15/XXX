/**
 * Session 12 CP0 — the degenerate-dice inventory, measured rather than argued.
 *
 * For every selection point that chooses a CATEGORY, print what each of the
 * six golden personas actually draws. A column whose six rows are identical
 * is a degenerate die; a column that varies with seed is a live one.
 *
 * $0 — pure functions only, no DB, no network.
 */

import {
  closeCategories,
  electAnchor,
  pickContrast,
  pickTemplate,
  warmupCategories,
} from "@/server/generation/arc";
import { rankedActivityCategories } from "@/server/generation/compose";
import { categoryAffinity, GOLDEN_PERSONAS } from "@/shared/persona";
import { CATEGORY_FAMILY } from "@/shared/vocabulary";

const SEEDS = [42, 7, 1234, 99, 2026];
const pad = (s: string, n: number) => s.padEnd(n);

console.log("\n=== per-persona category draws (head-take shown first) ===\n");
console.log(
  pad("persona", 18) +
    pad("anchor", 19) +
    pad("contrast", 19) +
    pad("warmup[0]", 11) +
    pad("close[0]", 17) +
    "close list",
);
console.log("-".repeat(120));

for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const anchor = electAnchor(persona);
  const used = new Set(anchor ? [CATEGORY_FAMILY[anchor.category]] : []);
  const contrast =
    anchor === null ? null : pickContrast(persona, anchor.category, used);
  const closes = closeCategories(persona);
  console.log(
    pad(key, 18) +
      pad(anchor?.category ?? "—", 19) +
      pad(contrast ?? "—", 19) +
      pad(warmupCategories(persona)[0], 11) +
      pad(closes[0], 17) +
      closes.join(" > "),
  );
}

console.log("\n=== the evening narrowing (what a 19:00+ close may draw) ===\n");
const EVENING_OK = ["nightlife_bars", "historic_sites", "restaurants"];
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const closes = closeCategories(persona);
  const evening = closes.filter((c) => EVENING_OK.includes(c));
  console.log(
    `${pad(key, 18)} close=${pad(closes.join(">"), 46)} evening-filtered=${evening.join(">") || "(empty)"} → head=${evening[0] ?? "—"}`,
  );
}

console.log("\n=== night affinity vs the 0.35 switch in closeCategories ===\n");
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const night = categoryAffinity(persona, "nightlife_bars");
  console.log(
    `${pad(key, 18)} nightlife_bars affinity=${night.toFixed(3)}  ${night >= 0.35 ? "≥0.35 → restaurants EXCLUDED" : "<0.35 → restaurants appended"}`,
  );
}

console.log("\n=== template spread across seeds (the fixed die, for contrast) ===\n");
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const drawn = SEEDS.map((s) => pickTemplate(persona, s).id);
  console.log(
    `${pad(key, 18)} ${drawn.map((d) => pad(d, 13)).join("")} distinct=${new Set(drawn).size}/${SEEDS.length}`,
  );
}

console.log("\n=== rankedActivityCategories (head is taken at compose.ts:569) ===\n");
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  console.log(`${pad(key, 18)} ${rankedActivityCategories(persona).join(" > ")}`);
}

console.log("\n=== seed sensitivity: does ANY category selector move with seed? ===\n");
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const anchors = new Set(SEEDS.map(() => electAnchor(persona)?.category ?? "—"));
  const closesHead = new Set(SEEDS.map(() => closeCategories(persona)[0]));
  console.log(
    `${pad(key, 18)} anchor distinct across ${SEEDS.length} seeds=${anchors.size}  close-head distinct=${closesHead.size}`,
  );
}
console.log(
  "\n(electAnchor and closeCategories take no seed parameter at all — the\n" +
    " distinct-count of 1 is structural, not a sampling artefact.)\n",
);
