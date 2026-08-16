/**
 * BOUNDED DIAGNOSIS of the discretionary max=1.00 worst pair (XXX-40,
 * Session 14 pre-Step-3 gate).
 *
 * The gate binds at Step 3 and we do not buy confirmations of known reds, so
 * this runs first and costs nothing: DB pool only, no Google, no Anthropic.
 *
 * The question it answers is narrow ON PURPOSE — what makes the worst PAIR
 * of days share every discretionary position, and is the cause inside ruled
 * machinery or outside it. Menu allocation was the strong suspect and was
 * measured NOT to move it (Session 14 Step 2), so this looks upstream at the
 * category DRAW itself.
 *
 *   npx tsx --env-file=.env.local scripts/discretionary-diagnosis.ts
 */

import { createClient } from "@supabase/supabase-js";
import { closeCategories, pickContrast, warmupCategories } from "@/server/generation/arc";
import { buildSkeleton, composeDay } from "@/server/generation/compose";
import { buildMenus } from "@/server/generation/engine";
import { hardFilter } from "@/server/generation/filters";
import { POOL_WINDOWS, retrieveCandidates, zonesFor } from "@/server/generation/retrieve";
import { collapseByPlace, scoreAll } from "@/server/generation/score";
import { DeterministicSelector } from "@/server/generation/select";
import type { GenerationRequest } from "@/server/generation/types";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { diceIndex, diceStream, personaIdentity } from "@/shared/dice";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { GOLDEN_PERSONAS, categoryAffinity } from "@/shared/persona";
import { timeToMinutes } from "@/shared/time";
import { CATEGORY_FAMILY, PLACE_CATEGORIES, type PlaceCategory } from "@/shared/vocabulary";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`Missing required env var: ${n}`);
  return v;
};

const STRUCTURAL = new Set(["meal", "rest", "provision"]);

async function main(): Promise<void> {
  const date = "2026-08-15";
  const seed = 42;
  const dusk = timeToMinutes("20:30");
  const client = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
  );
  console.log(
    `discretionary diagnosis — date=${date} seed=${seed} · DB pool only, $0\n`,
  );

  const rows = new Map<string, { roles: string[]; cats: string[]; tpl: string }>();
  for (const key of Object.keys(GOLDEN_PERSONAS)) {
    const persona = GOLDEN_PERSONAS[key];
    const request: GenerationRequest = {
      city: "toronto", date, persona,
      budgetBand: key === "day-4-budget" ? { min: 0, max: 70, currency: "CAD" } : null,
      transport: ["walk", "transit"], seed,
    };
    const skeleton = buildSkeleton(request, { seed });
    const identity = personaIdentity(persona);
    const zones = zonesFor(persona.lens, [], diceStream({ seed, identity, site: "zone", context: date }));
    const pool = await retrieveCandidates(client, "toronto", [...PLACE_CATEGORIES], zones,
      (c) => diceIndex({ seed, identity, site: "pool-window", context: c }, POOL_WINDOWS.length));
    const pre = scoreAll(pool, persona, request.budgetBand, seed);
    const { kept } = hardFilter(collapseByPlace(pre), date, skeleton.daySpan,
      (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min);
    const scored = scoreAll(kept, persona, request.budgetBand, seed);
    const byId = new Map(scored.map((c) => [c.place.id, c]));
    const menus = buildMenus(skeleton, scored, date, dusk, undefined);
    const selections = await new DeterministicSelector().select(menus, persona, seed);
    const composed = composeDay({
      request, skeleton, selections, candidatesById: byId,
      travel: new HaversineStubProvider(), outdoorLatestEnd: dusk,
      alternates: new Map(menus.map((m) => [m.intent.id, m.options.map((o) => o.place.id)])),
    });
    rows.set(key, {
      roles: composed.day.slots.map((s) => s.role ?? "?"),
      cats: composed.day.slots.map((s) => byId.get(s.placeId)?.category ?? "?"),
      tpl: skeleton.templateId,
    });
  }

  const discretionary = (key: string): { role: string; cat: string }[] => {
    const r = rows.get(key)!;
    return r.roles
      .map((role, i) => ({ role, cat: r.cats[i] }))
      .filter((x) => !STRUCTURAL.has(x.role));
  };

  // --- find the worst pair, then take it apart --------------------------
  const lcs = (a: string[], b: string[]): number => {
    const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
    return t[a.length][b.length];
  };
  const keys = [...rows.keys()];
  let worst = { a: "", b: "", score: -1 };
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const da = discretionary(keys[i]).map((x) => x.cat);
      const db = discretionary(keys[j]).map((x) => x.cat);
      if (Math.abs(da.length - db.length) > 1) continue;
      const score = lcs(da, db) / Math.min(da.length, db.length);
      if (score > worst.score) worst = { a: keys[i], b: keys[j], score };
    }

  // EVERY comparable pair, with its LENGTHS — the number that separates a
  // real collision from an artifact of the normalizer.
  console.log(`  all comparable pairs at or above the gate (0.67):`);
  let artifact = 0;
  let realCollision = 0;
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const da = discretionary(keys[i]).map((x) => x.cat);
      const db = discretionary(keys[j]).map((x) => x.cat);
      if (Math.abs(da.length - db.length) > 1) continue;
      const shared = lcs(da, db);
      const byShorter = shared / Math.min(da.length, db.length);
      if (byShorter < 0.67) continue;
      const byLonger = shared / Math.max(da.length, db.length);
      const subsequence = shared === Math.min(da.length, db.length);
      if (subsequence && da.length !== db.length) artifact++;
      else realCollision++;
      console.log(
        `    ${keys[i].padEnd(17)} vs ${keys[j].padEnd(17)} lens=${da.length}/${db.length} shared=${shared}` +
          ` byShorter=${byShorter.toFixed(2)} byLonger=${byLonger.toFixed(2)}` +
          (subsequence && da.length !== db.length ? "   <- SUBSEQUENCE of a longer day" : ""),
      );
    }
  console.log(
    `\n  ${artifact} pair(s) score high ONLY because the shorter sequence is a subsequence of the longer;` +
      ` ${realCollision} are equal-length collisions.\n`,
  );

  console.log(`WORST PAIR: ${worst.a} vs ${worst.b}  overlap=${worst.score.toFixed(2)}\n`);
  for (const key of [worst.a, worst.b]) {
    const persona = GOLDEN_PERSONAS[key];
    const d = discretionary(key);
    console.log(`  ${key}  (${persona.gravity.join(">")}, ${persona.pace}, ${persona.lens}, tpl=${rows.get(key)!.tpl})`);
    console.log(`    discretionary: ${d.map((x) => `${x.role}=${x.cat}`).join(" > ")}`);
  }

  // --- WHY: is it the DRAW, or something below it? ----------------------
  console.log(`\n  the draws each persona's arc actually makes:`);
  for (const key of [worst.a, worst.b]) {
    const persona = GOLDEN_PERSONAS[key];
    const identity = personaIdentity(persona);
    const roll = (site: string, ctx: string) =>
      diceStream({ seed, identity, site, context: `${date}|${ctx}` });
    console.log(`  ${key}:`);
    console.log(`    warmup draw : ${warmupCategories(persona, roll("warmup", "0")).join(" > ")}`);
    console.log(`    close  draw : ${closeCategories(persona, roll("close", "0")).join(" > ")}`);
    const anchorCat = discretionary(key).find((x) => x.role === "anchor")?.cat as PlaceCategory | undefined;
    if (anchorCat !== undefined) {
      console.log(`    contrast draw (vs ${anchorCat}): ${pickContrast(persona, anchorCat, new Set(), { dice: roll("contrast", "0") }).join(" > ")}`);
    }
  }

  // --- the affinity tables the draws are weighted by --------------------
  console.log(`\n  category AFFINITY, side by side — the weights every draw uses:`);
  console.log(`    ${"category".padEnd(20)} ${worst.a.padEnd(17)} ${worst.b}`);
  for (const c of PLACE_CATEGORIES) {
    const a = categoryAffinity(GOLDEN_PERSONAS[worst.a], c);
    const b = categoryAffinity(GOLDEN_PERSONAS[worst.b], c);
    const flag = a === b ? "   <- IDENTICAL" : "";
    console.log(`    ${c.padEnd(20)} ${a.toFixed(2).padEnd(17)} ${b.toFixed(2)}${flag}`);
  }
  const identical = PLACE_CATEGORIES.filter(
    (c) => categoryAffinity(GOLDEN_PERSONAS[worst.a], c) === categoryAffinity(GOLDEN_PERSONAS[worst.b], c),
  );
  console.log(
    `\n  ${identical.length}/${PLACE_CATEGORIES.length} categories carry IDENTICAL affinity for these two personas.`,
  );
  console.log(
    `  families in play: ${[...new Set(PLACE_CATEGORIES.map((c) => CATEGORY_FAMILY[c]))].join(", ")}`,
  );
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
