/**
 * The dice — one seeded-weighted-choice primitive for every selection point
 * in composition (XXX-35, Session 12 CP1, ratified).
 *
 * Sessions 9 and 11 found the same defect three times, each time by paying
 * for a matrix: a selection point whose outcome cannot move. Two shapes:
 *
 *   1. RANKED-HEAD-ALWAYS-WINS — a function returns a preference list and
 *      the caller takes `[0]`. Once the step reliably seats, every day gets
 *      the same answer (Session 11: six days, six bars).
 *   2. SEED-KEY COLLISION — the key mixes the seed with a PROXY for identity
 *      rather than identity itself. `pickTemplate` hashed
 *      `gravity.join(",").length`, so two personas with same-length interest
 *      lists drew the same template.
 *
 * The cure is one pattern applied everywhere: a seeded weighted draw keyed by
 * (seed × persona identity × selection site × day context).
 *
 * THE FUNNEL RULE (CP0 finding, ratified as a design constraint). Session 11
 * blamed `closeCategories` for the six-bar day and queued "make it a seeded
 * choice" as the fix. Measured, that would not have worked: `closeCategories`
 * heads `nightlife_bars` for ONE persona of six. The collapse happens in two
 * narrowings DOWNSTREAM of it — the evening filter drops `parks` (the head
 * for three of six), and the hours filter then kills `historic_sites` after
 * 19:00. A die rolled upstream of a funnel is still a funnel. So:
 *
 *   - roll at the POINT OF USE, over options that already survived every
 *     filter the caller knows about; and
 *   - return an ORDER, never a head, so filters the caller CANNOT know about
 *     (seatability) consume the diced preference instead of overriding it.
 *
 * THE NON-INVERSION GUARANTEE. Stated preference sets the weights and the
 * dice may never invert it — the Session 9 lens-floor principle, generalized.
 * `weightedOrder` enforces it structurally via an eligibility floor: only
 * options within `temperature` of the best weight can be drawn early. τ = 0
 * therefore reduces exactly to ranking, which is every refit's testable null
 * hypothesis.
 *
 * Pure and dependency-free (src/shared law): no I/O, no React, no secrets.
 */

import type { Persona } from "./persona";

/**
 * FNV-1a over a string — stable content-to-int.
 *
 * Extracted here on its third occurrence, per CLAUDE.md's rule. It lived
 * twice: `arc.ts:hashIdentity` and `score.ts:fnv1a`, bit-identical but
 * separately maintained.
 */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, seedable, good enough for choice. Deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The persona's identity, hashed from CONTENT — the `pickTemplate` lesson.
 *
 * All five interview dimensions, so two personas differing in any one of them
 * draw different streams. This replaces `arc.ts:hashIdentity` (structure,
 * pace, lens, gravity — no foodCourage) and `score.ts:personaFingerprint`
 * (pace, gravity, foodCourage, structure, lens — different order). They
 * hashed overlapping but unequal field sets, which meant "identity" meant two
 * things depending on which selector you were standing in.
 */
export function personaIdentity(persona: Persona): number {
  return fnv1a(
    [
      persona.pace,
      persona.structure,
      persona.lens,
      persona.foodCourage,
      persona.gravity.join(","),
    ].join("|"),
  );
}

/**
 * What varies a draw. Every field is required: an omitted `site` is how two
 * selectors at one seed end up drawing the same number, and an omitted
 * `context` is how one persona gets the same day on every date.
 */
export interface DiceKey {
  /** The generation seed — logged in the trace, so any draw is replayable. */
  seed: number;
  /** `personaIdentity(persona)`. */
  identity: number;
  /** Which selection point. A literal per site, e.g. "close", "anchor". */
  site: string;
  /** Day context — date, and the step's window where a day has several. */
  context: string;
}

/** A reproducible number stream for one (seed, persona, site, context). */
export function diceStream(key: DiceKey): () => number {
  return mulberry32(
    (key.seed ^ key.identity ^ fnv1a(`${key.site}|${key.context}`)) >>> 0,
  );
}

export interface Weighted<T> {
  value: T;
  /** Stated preference, in affinity points. Higher wins more often. */
  weight: number;
}

/**
 * The whole list, reordered by a seeded weighted draw without replacement.
 *
 * Returns an ORDER rather than a winner because downstream filters may reject
 * the head for reasons this function cannot see — a category with nothing
 * open at 19:30 is not a bad draw, it is an unseatable one, and the caller
 * should fall through to the SECOND thing the dice wanted rather than to
 * whatever the alphabet offers.
 *
 * `temperature` is in AFFINITY POINTS, which is what makes it arguable: it is
 * how much stated preference this site may trade for variety. 0.35 is one
 * `GRAVITY_WEIGHTS` step — one whole rank of stated interest.
 *
 *   eligible = { o : weight(o) >= maxWeight - temperature }
 *
 * Options outside that band are never drawn early; they keep their ranked
 * order behind the drawn ones. At temperature 0 the eligible set is the
 * exact-tie set, so the result is ranking with ties broken by dice instead of
 * by `localeCompare` — and a pure ranking when there are no ties at all.
 */
export function weightedOrder<T>(
  options: readonly Weighted<T>[],
  stream: () => number,
  temperature: number,
): T[] {
  if (options.length <= 1) return options.map((o) => o.value);

  // Ranked first, so everything below is a reordering of a stable base and
  // the no-ties/zero-temperature case is exactly the ranked answer.
  const pool = [...options].sort((a, b) => b.weight - a.weight);
  const out: T[] = [];

  while (pool.length > 0) {
    const best = pool[0].weight;
    const floor = best - Math.max(0, temperature);
    const eligibleCount = pool.filter((o) => o.weight >= floor).length;
    if (eligibleCount <= 1) {
      out.push(pool.shift()!.value);
      continue;
    }
    // Softmax over the eligible band. Weights are already comparable
    // magnitudes in [0, ~1]; temperature scales how flat the draw is. The
    // guard keeps τ→0 from dividing by zero — at which point the band holds
    // only exact ties anyway, and a flat draw among equals is correct.
    const tau = Math.max(temperature, 1e-6);
    const exps = pool
      .slice(0, eligibleCount)
      .map((o) => Math.exp((o.weight - best) / tau));
    const total = exps.reduce((a, b) => a + b, 0);
    let roll = stream() * total;
    let index = 0;
    for (; index < exps.length - 1; index += 1) {
      roll -= exps[index];
      if (roll <= 0) break;
    }
    out.push(pool.splice(index, 1)[0].value);
  }
  return out;
}

/**
 * `weightedOrder` for the common case where the caller holds a plain list and
 * a weight function. Keeps call sites from building `{value, weight}` pairs
 * by hand at seven different selection points.
 */
export function weightedOrderBy<T>(
  options: readonly T[],
  weightOf: (option: T) => number,
  stream: () => number,
  temperature: number,
): T[] {
  return weightedOrder(
    options.map((value) => ({ value, weight: weightOf(value) })),
    stream,
    temperature,
  );
}

/**
 * Pick one of `count` deterministic variants — for choices that are not
 * preference-weighted at all, like which stable ordering to page the
 * candidate pool by. Not a weighted draw: every variant is equally valid, so
 * dressing it as one would be false precision.
 */
export function diceIndex(key: DiceKey, count: number): number {
  if (count <= 1) return 0;
  return Math.floor(diceStream(key)() * count) % count;
}
