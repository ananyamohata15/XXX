import { createClient } from "@supabase/supabase-js";
import { ARC_TEMPLATES } from "@/server/generation/arc";
import { buildSkeleton, composeDay } from "@/server/generation/compose";
import { buildMenus } from "@/server/generation/engine";
import { hardFilter } from "@/server/generation/filters";
import {
  POOL_WINDOWS,
  retrieveCandidates,
  zonesFor,
} from "@/server/generation/retrieve";
import { collapseByPlace, scoreAll } from "@/server/generation/score";
import { DeterministicSelector } from "@/server/generation/select";
import type { Candidate, GenerationRequest, Selection } from "@/server/generation/types";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { diceIndex, diceStream, personaIdentity } from "@/shared/dice";
import { HaversineStubProvider } from "@/shared/day-grammar/travel";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { timeToMinutes } from "@/shared/time";
import { PLACE_CATEGORIES } from "@/shared/vocabulary";

/**
 * Offline recompose of the matrix — the $0 half of the CP2 proof.
 *
 * Reads the candidate pool the PAID runs already persisted (Supabase
 * `places` + `facts`; `retrieveCandidates` touches no Google endpoint),
 * then builds each golden persona's skeleton, selects deterministically and
 * composes. No Details call, no Anthropic call, no forecast — so the
 * anchor-seating question can be asked as many times as it takes for
 * nothing.
 *
 * What it cannot prove: live travel times (this uses the Haversine stub,
 * as the report's own fallback does) and LLM selection. Those are the live
 * confirm's job, and the honest division is stated rather than blurred.
 *
 *   npx tsx --env-file=.env.local scripts/offline-recompose.ts [--date YYYY-MM-DD] [--seed n]
 */

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const date = arg("--date") ?? "2026-08-15";
  const seed = Number(arg("--seed") ?? 42);
  const supabase = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
  );

  console.log(
    `offline recompose — date=${date} seed=${seed} · DB pool only, $0 (no Google, no Anthropic)\n`,
  );

  const keys = Object.keys(GOLDEN_PERSONAS);
  let seated = 0;
  const rows: string[] = [];
  const roleSeq = new Map<string, string[]>();
  const catSeq = new Map<string, string[]>();
  const venues = new Map<string, Set<string>>();
  const templateHasClose = new Map<string, boolean>();

  for (const key of keys) {
    const persona = GOLDEN_PERSONAS[key];
    const request: GenerationRequest = {
      city: "toronto",
      date,
      persona,
      budgetBand: key === "day-4-budget" ? { min: 0, max: 70, currency: "CAD" } : null,
      transport: ["walk", "transit"],
      seed,
    };

    const skeleton = buildSkeleton(request, { seed });
    const identity = personaIdentity(persona);
    const zones = zonesFor(
      persona.lens,
      [],
      diceStream({ seed, identity, site: "zone", context: date }),
    );
    const pool = await retrieveCandidates(
      supabase,
      "toronto",
      [...PLACE_CATEGORIES],
      zones,
      (category) =>
        diceIndex(
          { seed, identity, site: "pool-window", context: category },
          POOL_WINDOWS.length,
        ),
    );
    // FIDELITY (Session 12 CP1, ruled as doctrine): the harness CALLS the
    // engine's selection path and MIRRORS ITS SEQUENCE — it never
    // re-implements either.
    //
    // The sequence matters as much as the functions, and getting it wrong is
    // how the original defect happened. `retrieveCandidates` emits one
    // Candidate per (place, CATEGORY), so a place mapped to several
    // categories appears several times under one `place.id` — 79 of them in
    // the Toronto pool, 45 straddling the food boundary. The engine collapses
    // that collision ONCE, at `engine.ts:292`, BEFORE menus exist, so its
    // selection and its composition necessarily agree about what a place is.
    // The old harness collapsed it AFTER selecting from the still-duplicated
    // list, so it selected Brazen Head Irish Pub at its `restaurants` score
    // for a meal and then composed with the same place's `nightlife_bars`
    // variant. A bar seated as a meal — Session 11's symptom exactly.
    //
    // So the engine's order is mirrored step for step (engine.ts:287-397):
    // score, collapse, hard-filter, re-score, menus over the FULL re-scored
    // pool — which is what `engine.ts:431` passes, NOT the shortlist
    // (`pickShortlist` governs only which candidates earn paid Details calls,
    // and offline there are none).
    //
    // The SEQUENCE is as load-bearing as the functions. Collapse must follow
    // scoring, because `collapseByPlace` keeps the best-SCORING category and
    // scores do not exist before `scoreAll`. Collapsing first picks a
    // different survivor, and the offline day stops being the live day.
    const prescored = scoreAll(pool, persona, request.budgetBand, seed);
    const { kept } = hardFilter(
      collapseByPlace(prescored),
      date,
      skeleton.daySpan,
      (c) => GRAMMAR_PARAMS.dwellMinutes[c.category].min,
    );
    const scored = scoreAll(kept, persona, request.budgetBand, seed);
    const byId = new Map(scored.map((c: Candidate) => [c.place.id, c]));
    const menus = buildMenus(
      skeleton,
      scored,
      date,
      timeToMinutes("20:30"),
      undefined,
    );
    const selections: Selection[] = await new DeterministicSelector().select(
      menus,
      persona,
      seed,
    );

    const composed = composeDay({
      request,
      skeleton,
      selections,
      candidatesById: byId,
      travel: new HaversineStubProvider(),
      outdoorLatestEnd: timeToMinutes("20:30"),
    });

    roleSeq.set(
      key,
      composed.day.slots.map((sl) => sl.role ?? "?"),
    );
    // The category SELECTION used, not the place's stored fact. The two can
    // disagree in the DB pool (a stale fact against the row's own column),
    // and reporting the fact while selecting on the column produced
    // nonsense sequences — a bar seated as a meal. What the arc chose is
    // the thing this metric is about.
    catSeq.set(
      key,
      composed.day.slots.map(
        (sl) => byId.get(sl.placeId)?.category ?? "?",
      ),
    );
    venues.set(key, new Set(composed.day.slots.map((sl) => sl.placeId)));
    templateHasClose.set(
      key,
      (ARC_TEMPLATES.find((t) => t.id === skeleton.templateId)?.steps ?? []).includes(
        "close",
      ),
    );

    const anchorIntent = skeleton.intents.find((i) => i.role === "anchor");
    const anchorSlot = composed.day.slots.find((s) => s.role === "anchor");
    const ok = anchorSlot !== undefined;
    if (ok) seated++;
    const anchorPlace =
      anchorSlot === undefined
        ? null
        : composed.day.places[anchorSlot.placeId]?.name;

    rows.push(
      `${ok ? "  OK " : "  ** "}${key.padEnd(17)}pool=${String(pool.length).padStart(3)} ` +
        `tpl=${skeleton.templateId.padEnd(11)} elected=${(skeleton.electedAnchor?.category ?? "user-anchor").padEnd(18)}` +
        `stops=${composed.day.slots.length} anchor=${ok ? anchorPlace : "MISSING"}` +
        (anchorIntent !== undefined && composed.unfilled.includes(anchorIntent.id)
          ? " [reported unfilled]"
          : "") +
        (skeleton.droppedSteps.length > 0
          ? ` dropped=${skeleton.droppedSteps.map((d) => d.step).join(",")}`
          : "") +
        (composed.unfilled.length > 0
          ? ` unfilled=${composed.unfilled
              .map(
                (id) =>
                  skeleton.intents.find((i) => i.id === id)?.role ?? id,
              )
              .join(",")}`
          : ""),
    );
  }

  console.log(rows.join("\n"));

  // ---- structural matrix, computed here so it costs nothing -------------
  const lcs = (a: string[], b: string[]): number => {
    const t = Array.from({ length: a.length + 1 }, () =>
      new Array<number>(b.length + 1).fill(0),
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        t[i][j] =
          a[i - 1] === b[j - 1]
            ? t[i - 1][j - 1] + 1
            : Math.max(t[i - 1][j], t[i][j - 1]);
      }
    }
    return t[a.length][b.length];
  };
  const overlap = (a: string[], b: string[]): number =>
    a.length === 0 || b.length === 0
      ? 0
      : lcs(a, b) / Math.min(a.length, b.length);

  let cmpSum = 0, cmpMax = 0, cmpN = 0, roleSum = 0, roleN = 0;
  let vSum = 0, vMax = 0, vN = 0;
  let worst = "";
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ci = catSeq.get(keys[i])!, cj = catSeq.get(keys[j])!;
      const ro = overlap(roleSeq.get(keys[i])!, roleSeq.get(keys[j])!);
      roleSum += ro; roleN++;
      const vi = venues.get(keys[i])!, vj = venues.get(keys[j])!;
      const inter = [...vi].filter((v) => vj.has(v)).length;
      const vo = inter / Math.max(1, Math.min(vi.size, vj.size));
      vSum += vo; vMax = Math.max(vMax, vo); vN++;
      if (Math.abs(ci.length - cj.length) <= 1) {
        const so = overlap(ci, cj);
        cmpSum += so; cmpN++;
        if (so > cmpMax) { cmpMax = so; worst = `${keys[i]} vs ${keys[j]}`; }
      }
    }
  }
  const cmpMean = cmpN > 0 ? cmpSum / cmpN : 0;
  console.log(
    `\n  category-sequence [comparable, n=${cmpN}]: mean=${cmpMean.toFixed(3)} (GATE ≤0.55) max=${cmpMax.toFixed(2)} (GATE ≤0.80) → ${
      cmpMean <= 0.55 && cmpMax <= 0.8 ? "PASS" : "FAIL"
    }   worst=${worst}`,
  );
  console.log(`  role-sequence [n=${roleN}]: mean=${(roleSum / roleN).toFixed(3)} (non-gating)`);
  console.log(`  venue overlap [n=${vN}]: mean=${(vSum / vN).toFixed(3)} max=${vMax.toFixed(2)}`);
  // Closes, RESTATED (Session 12 CP2 ruling 1): seated closes over the
  // templates that HAVE a close step. Three templates — `moderate-d`,
  // `packed-c`, `relaxed-d` — end on a meal by design, which was Session 11
  // §7.3's own fix for the unrecorded `lastStep = "close"` invariant. Scoring
  // those as a missing close measured the template table, not the composer.
  const wanted = keys.filter((k) => templateHasClose.get(k) === true);
  const closes = wanted.filter((k) => roleSeq.get(k)!.includes("close")).length;
  const raw = keys.filter((k) => roleSeq.get(k)!.includes("close")).length;
  console.log(
    `  closes [restated: seated / templates WITH a close step]: ${closes}/${wanted.length}` +
      ` → ${closes === wanted.length ? "PASS" : "MISS"}   (raw, for the record: ${raw}/${keys.length})`,
  );
  console.log(`  role sequences:`);
  for (const k of keys) console.log(`    ${k.padEnd(17)}${roleSeq.get(k)!.join(">")}`);
  console.log(`  category sequences:`);
  for (const k of keys) console.log(`    ${k.padEnd(17)}${catSeq.get(k)!.join(">")}`);
  // How much of the overlap is the MEAL PATTERN alone? Every scheduler day
  // owes restaurants at lunch and at dinner to `classic`, before the arc
  // has any say. That is the metric's structural floor.
  const foodOnly = (a: string[]): string[] =>
    a.filter((c) => c === "restaurants" || c === "cafes");
  let floorSum = 0, floorN = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ci = catSeq.get(keys[i])!, cj = catSeq.get(keys[j])!;
      if (Math.abs(ci.length - cj.length) > 1) continue;
      floorSum += overlap(foodOnly(ci), foodOnly(cj)) * Math.min(foodOnly(ci).length, foodOnly(cj).length) / Math.min(ci.length, cj.length);
      floorN++;
    }
  }
  console.log(
    `  structural floor from the meal pattern alone: mean=${(floorSum / Math.max(1, floorN)).toFixed(3)} of the ${cmpMean.toFixed(3)} measured`,
  );
  console.log(
    `\nanchors seated: ${seated}/${keys.length}${seated === keys.length ? "  → PASS" : "  → FAIL"}`,
  );
  if (seated !== keys.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
