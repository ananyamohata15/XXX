/**
 * Session 12 — the degenerate-dice inventory, measured rather than argued.
 *
 * CP0 ran this against the un-diced selectors and it produced the evidence
 * that corrected Session 11's recorded six-bar mechanism. It now doubles as
 * the CP2 before/after demonstration: same six personas, same seeds, showing
 * the close categories drawn ACROSS days and two similar personas diverging.
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
import { diceStream, personaIdentity } from "@/shared/dice";
import { categoryAffinity, GOLDEN_PERSONAS, type Persona } from "@/shared/persona";
import { CATEGORY_FAMILY } from "@/shared/vocabulary";

const SEEDS = [42, 7, 1234, 99, 2026];
const DATE = "2026-08-15";
const pad = (s: string, n: number) => s.padEnd(n);

/** The same key the composer builds — so this measures the real draws. */
const roll = (persona: Persona, seed: number, site: string, context: string) =>
  diceStream({
    seed,
    identity: personaIdentity(persona),
    site,
    context: `${DATE}|${context}`,
  });

console.log("\n=== per-persona draws at seed 42 (lowest-roll head shown) ===\n");
console.log(
  pad("persona", 18) +
    pad("anchor", 19) +
    pad("contrast", 19) +
    pad("warmup[0]", 11) +
    "close order",
);
console.log("-".repeat(118));

for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const anchor = electAnchor(persona, { dice: roll(persona, 42, "anchor", "") });
  const used = new Set(anchor ? [CATEGORY_FAMILY[anchor.category]] : []);
  const contrast =
    anchor === null
      ? []
      : pickContrast(persona, anchor.category, used, {
          dice: roll(persona, 42, "contrast", "840"),
        });
  console.log(
    pad(key, 18) +
      pad(anchor?.category ?? "—", 19) +
      pad(contrast[0] ?? "—", 19) +
      pad(warmupCategories(persona, roll(persona, 42, "warmup", "540"))[0], 11) +
      closeCategories(persona, roll(persona, 42, "close", "1140")).join(" > "),
  );
}

console.log("\n=== THE HEADLINE: close head across seeds (was 1/1 for all) ===\n");
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const heads = SEEDS.map(
    (s) => closeCategories(persona, roll(persona, s, "close", "1140"))[0],
  );
  console.log(
    `${pad(key, 18)}${heads.map((h) => pad(h, 18)).join("")}distinct=${new Set(heads).size}/${SEEDS.length}`,
  );
}

console.log("\n=== evening close: what survives forEvening, across seeds ===\n");
const EVENING_OK = ["nightlife_bars", "historic_sites", "restaurants"];
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const heads = SEEDS.map((s) => {
    const drawn = closeCategories(persona, roll(persona, s, "close", "1140"));
    return drawn.filter((c) => EVENING_OK.includes(c))[0] ?? "—";
  });
  console.log(
    `${pad(key, 18)}${heads.map((h) => pad(h, 18)).join("")}distinct=${new Set(heads).size}/${SEEDS.length}`,
  );
}

console.log("\n=== anchor across seeds — must stay gravity-faithful (tau 0.05) ===\n");
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const drawn = SEEDS.map(
    (s) => electAnchor(persona, { dice: roll(persona, s, "anchor", "") })!.category,
  );
  const top = Math.max(
    ...drawn.map((c) => categoryAffinity(persona, c)),
  );
  const best = categoryAffinity(
    persona,
    rankedActivityCategories(persona, () => 0)[0],
  );
  console.log(
    `${pad(key, 18)}${drawn.map((d) => pad(d, 19)).join("")}distinct=${new Set(drawn).size} maxAffinityDrawn=${top.toFixed(2)} best=${best.toFixed(2)}`,
  );
}

console.log("\n=== warmup across seeds (markets headed 5/6 before) ===\n");
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const heads = SEEDS.map(
    (s) => warmupCategories(persona, roll(persona, s, "warmup", "540"))[0],
  );
  console.log(
    `${pad(key, 18)}${heads.map((h) => pad(h, 11)).join("")}distinct=${new Set(heads).size}/${SEEDS.length}`,
  );
}

console.log("\n=== template spread across seeds ===\n");
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  const drawn = SEEDS.map((s) => pickTemplate(persona, s).id);
  console.log(
    `${pad(key, 18)}${drawn.map((d) => pad(d, 13)).join("")}distinct=${new Set(drawn).size}/${SEEDS.length}`,
  );
}

console.log("\n=== TWO SIMILAR PERSONAS MUST DIVERGE (the pickTemplate lesson) ===\n");
// Identical but for ONE gravity entry — the case that collapsed in Session 9
// (jitter) and again in Session 11 (length-keyed template hash).
const twinA: Persona = {
  pace: "moderate",
  gravity: ["art", "food", "history"],
  foodCourage: "adventurous",
  structure: "scheduler",
  lens: "corners",
};
const twinB: Persona = { ...twinA, gravity: ["art", "food", "nature"] };
console.log(
  `identity hashes differ: ${personaIdentity(twinA) !== personaIdentity(twinB)}  (${personaIdentity(twinA)} vs ${personaIdentity(twinB)})`,
);
for (const seed of SEEDS) {
  const a = closeCategories(twinA, roll(twinA, seed, "close", "1140"));
  const b = closeCategories(twinB, roll(twinB, seed, "close", "1140"));
  console.log(
    `  seed ${pad(String(seed), 6)} A=${pad(a.join(">"), 46)} B=${pad(b.join(">"), 46)} ${a.join() === b.join() ? "SAME" : "differ"}`,
  );
}

console.log("\n=== REPRODUCIBILITY: same persona + seed → identical draw ===\n");
let reproduced = true;
for (const [key, persona] of Object.entries(GOLDEN_PERSONAS)) {
  for (const seed of SEEDS) {
    const a = closeCategories(persona, roll(persona, seed, "close", "1140"));
    const b = closeCategories(persona, roll(persona, seed, "close", "1140"));
    if (a.join() !== b.join()) {
      reproduced = false;
      console.log(`  ** ${key} seed ${seed}: ${a.join()} vs ${b.join()}`);
    }
  }
}
console.log(
  reproduced
    ? "  OK — every (persona, seed) reproduced its exact draw."
    : "  ** NOT REPRODUCIBLE — see above.",
);
console.log();
