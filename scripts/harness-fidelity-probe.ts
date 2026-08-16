/**
 * Session 12 CP1 — live reproduction of the harness pool-fidelity defect
 * (Session 11 §8.3, OPEN). CLAUDE.md constraint 7: reproduce, then fix.
 *
 * Hypothesis under test: `retrieveCandidates` emits ONE Candidate per
 * (place, category) pair, so a place mapped to several categories appears
 * several times with the same `place.id`. The harness collapses that with
 * `new Map(scored.map(c => [c.place.id, c]))` — LAST wins, i.e. the
 * LOWEST-scored variant, because `scored` is score-descending. The live
 * engine's `pickShortlist` collapses the same collision FIRST-wins
 * (`if (picked.has(id)) { taken++; continue }`). Same pool, opposite rule.
 *
 * $0 — Supabase reads only. No Google, no Anthropic.
 *
 *   npx tsx --env-file=.env.local scripts/harness-fidelity-probe.ts
 */

import { createClient } from "@supabase/supabase-js";
import { retrieveCandidates, zonesFor } from "@/server/generation/retrieve";
import { scoreAll } from "@/server/generation/score";
import type { Candidate } from "@/server/generation/types";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { PLACE_CATEGORIES } from "@/shared/vocabulary";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const supabase = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
  );
  const persona = GOLDEN_PERSONAS["day-5-wanderer"];
  const zones = zonesFor(persona.lens, []);
  const pool = await retrieveCandidates(
    supabase,
    "toronto",
    [...PLACE_CATEGORIES],
    zones,
  );
  const scored = scoreAll(pool, persona, null, 42);

  const byPlace = new Map<string, Candidate[]>();
  for (const c of scored) {
    const list = byPlace.get(c.place.id) ?? [];
    list.push(c);
    byPlace.set(c.place.id, list);
  }
  const multi = [...byPlace.entries()].filter(([, v]) => v.length > 1);

  console.log(`pool rows (place×category)      : ${pool.length}`);
  console.log(`distinct place ids              : ${byPlace.size}`);
  console.log(`places carrying >1 category     : ${multi.length}`);
  console.log(
    `rows lost to a place-id Map     : ${pool.length - byPlace.size}\n`,
  );

  if (multi.length === 0) {
    console.log("NOT REPRODUCED — no place maps to more than one category.");
    return;
  }

  // The two collision rules, side by side.
  const harnessMap = new Map(scored.map((c: Candidate) => [c.place.id, c]));
  const liveMap = new Map<string, Candidate>();
  for (const c of scored) if (!liveMap.has(c.place.id)) liveMap.set(c.place.id, c);

  let disagree = 0;
  for (const id of liveMap.keys()) {
    if (harnessMap.get(id)?.category !== liveMap.get(id)?.category) disagree++;
  }
  console.log(
    `places where harness (last-wins) and live (first-wins) DISAGREE on category: ${disagree}\n`,
  );

  console.log("first 12 collisions — categories in score order:");
  for (const [id, variants] of multi.slice(0, 12)) {
    const cats = variants.map((v) => `${v.category}(${v.score.toFixed(3)})`);
    console.log(
      `  ${variants[0].place.name.slice(0, 34).padEnd(36)}` +
        `live=${liveMap.get(id)!.category.padEnd(18)}harness=${harnessMap.get(id)!.category.padEnd(18)}` +
        `[${cats.join(" ")}]`,
    );
  }

  const foodAsNonFood = multi.filter((m) => {
    const live = liveMap.get(m[0])!.category;
    const harness = harnessMap.get(m[0])!.category;
    const isFood = (c: string) => c === "restaurants" || c === "cafes";
    return isFood(live) !== isFood(harness);
  });
  console.log(
    `\nplaces where the two rules disagree ACROSS the food boundary: ${foodAsNonFood.length}`,
  );
  console.log(
    "(this is the class that seats a bar as a meal — the harness composes\n" +
      " the day with a category the selection was not made under.)",
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
