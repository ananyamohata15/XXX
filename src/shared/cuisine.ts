/**
 * Cuisine tags (XXX-43, Session 15) — the positive-taste axis.
 *
 * The founder's verdict that opened this session named the gap: *"I have no
 * ability to tell things I like… I don't drink, I love Italian, Thai."* This
 * is the "love" half. The constraint half lives on the request.
 *
 * WHERE THE DATA COMES FROM, and why this cost nothing to build: the
 * `categories` fact has stored `source_labels` — the raw FSQ breadcrumbs —
 * since Session 5, on the recorded ground that they are kept "so future
 * re-mapping needs no dataset re-scan" (`domain/schemas.ts`). That foresight
 * is now load-bearing. `retrieve.ts` already joins this exact fact to build
 * candidates, so cuisine costs one pure function and no new I/O, no
 * re-ingest, and no Google call.
 *
 * WHY PREFIXES, not a hand-built ontology. Measured over the live pool, the
 * FSQ restaurant taxonomy is HIERARCHICAL and already encodes the families
 * we want:
 *
 *     Asian Restaurant > Thai Restaurant
 *     Asian Restaurant > Chinese Restaurant > Cantonese Restaurant
 *     Middle Eastern Restaurant > Shawarma Restaurant
 *     Indian Restaurant > South Indian Restaurant
 *
 * So a cuisine tag is a VIEW ON THE SOURCE TREE, expressed as breadcrumb
 * prefixes, exactly as `base-layer/categories.ts` already maps the top-level
 * taxonomy. We are reading the source's own grouping rather than inventing
 * one and then arguing with it.
 *
 * A consequence worth stating plainly, because it looks like a bug and is
 * not: **a Thai restaurant carries BOTH `thai` and `asian`**, because it
 * genuinely is both and the source tree says so. Scoring caps the cuisine
 * term per candidate (`cuisine-score.ts`), so matching twice cannot pay
 * twice.
 */

/**
 * The offered set (founder ruling, Session 15 CP1 revision).
 *
 * An earlier ruling was "offer more and say plainly when we can't" — all 80
 * cuisines with 20+ places. The founder then narrowed it: *"lets go with some
 * options now, not all cuisines… take top; thai/med/italian/indian/asian"*.
 * Five chips, each backed by a deep pool. The mechanism below is unchanged by
 * the count — a sixth cuisine is one entry, and the type system will demand
 * its labels before it compiles.
 */
export const CUISINE_TAGS = [
  "thai",
  "mediterranean",
  "italian",
  "indian",
  "asian",
] as const;
export type CuisineTag = (typeof CUISINE_TAGS)[number];

/** How a cuisine is written on a chip and in a reason. */
export const CUISINE_LABELS = {
  thai: "Thai",
  mediterranean: "Mediterranean",
  italian: "Italian",
  indian: "Indian",
  asian: "Asian",
} as const satisfies Record<CuisineTag, string>;

/**
 * Breadcrumb prefixes per cuisine, relative to the restaurant branch root
 * ("Dining and Drinking > Restaurant > "). Matching is `startsWith`, so a
 * parent prefix captures its whole subtree — the same deliberate choice, and
 * the same load-bearing punctuation care, as `CATEGORY_BREADCRUMB_RULES`.
 *
 * EXHAUSTIVE `Record<CuisineTag, …>` on purpose (the Session 13/14 lesson).
 * The admit-list direction is correct HERE — we map FROM an open external
 * vocabulary INTO our closed one — but the exhaustiveness that protects us
 * is on OUR side: adding a `CuisineTag` must not compile until someone says
 * which labels feed it. An optional map would default a new cuisine to "no"
 * in silence, which is precisely how `scenic_viewpoints` was deleted from
 * every evening close.
 *
 * Counts are from the live pool at the time of writing and are indicative,
 * not a contract — `scripts/cuisine-report.ts` is the instrument of record
 * and fails loudly if any single cuisine matches nothing.
 */
export const CUISINE_PREFIXES = {
  /** 398. */
  thai: ["Asian Restaurant > Thai Restaurant"],

  /**
   * ~1,490 across the group. The judgment call of the five, and it is
   * recorded rather than buried: "Mediterranean" as people say it in Toronto
   * covers Greek and the Levant, not a coastline. So the Middle Eastern
   * subtree is IN — including Persian, Iraqi and Yemeni, which are not
   * Mediterranean geographically.
   *
   * Splitting that subtree would mean inventing a geographic boundary the
   * source taxonomy does not encode, and then maintaining it. Following the
   * source's own grouping is the honest default; the founder can move the
   * line in one edit if a shawarma counter is not what he means by "med".
   *
   * Spanish and Italian are deliberately OUT: Italian has its own chip, and
   * folding Spanish (16 + 39 tapas) in would stretch the word past use.
   */
  mediterranean: [
    "Mediterranean Restaurant",
    "Greek Restaurant",
    "Middle Eastern Restaurant",
    "Turkish Restaurant",
    "Falafel Restaurant",
    "Kebab Restaurant",
  ],

  /**
   * 754.
   *
   * `Pizzeria` (1,347) is deliberately EXCLUDED, and the reason is the source
   * rather than taste: FSQ files Pizzeria as its own TOP-LEVEL node, not
   * under Italian. Folding it in would be us overriding the taxonomy with a
   * private opinion — and it would point "loves Italian" at slice counters,
   * which is not what the word does for a person planning a dinner.
   * One line to reverse if the founder disagrees.
   */
  italian: ["Italian Restaurant"],

  /**
   * ~946. The `Indian Restaurant` prefix carries South Indian, North Indian
   * and Chaat with it.
   *
   * `Indian Chinese Restaurant` (24) is a SEPARATE top-level node and would
   * not be caught by the prefix — it is listed explicitly because Hakka
   * Indian-Chinese is genuinely Indian food and a Toronto staple. Noting it
   * because a silent near-miss is exactly the class of bug this file's
   * comments exist to prevent.
   */
  indian: ["Indian Restaurant", "Indian Chinese Restaurant"],

  /**
   * ~4,300 — the whole `Asian Restaurant` subtree: Chinese, Japanese, sushi,
   * ramen, Korean, Vietnamese, Thai, noodle, Filipino, hotpot and the rest.
   *
   * This OVERLAPS `thai` by construction and that is correct, not a defect.
   * See the header note: a Thai restaurant is Asian, the source tree says so,
   * and the score cap stops a double match paying twice.
   */
  asian: ["Asian Restaurant"],
} as const satisfies Record<CuisineTag, readonly string[]>;

/** The taxonomy node every cuisine prefix hangs from. */
export const RESTAURANT_BRANCH = "Dining and Drinking > Restaurant";

/**
 * Raw FSQ breadcrumbs → the cuisines they denote. Pure, order-stable, and
 * total: a label the map does not know yields nothing rather than a guess.
 *
 * Honest absence is the whole point of the empty return. Measured, 15.1% of
 * pooled restaurants carry only the bare "Restaurant" node — no cuisine leaf
 * at all. Those places get NO tag, are NEVER penalised for our ignorance,
 * and no narrated reason may claim a cuisine for them.
 */
export function cuisinesFromLabels(
  labels: readonly string[],
): CuisineTag[] {
  const found = new Set<CuisineTag>();
  for (const label of labels) {
    if (!label.startsWith(RESTAURANT_BRANCH + " > ")) continue;
    const leaf = label.slice(RESTAURANT_BRANCH.length + 3);
    for (const tag of CUISINE_TAGS) {
      for (const prefix of CUISINE_PREFIXES[tag]) {
        if (leaf === prefix || leaf.startsWith(prefix + " > ")) {
          found.add(tag);
          break;
        }
      }
    }
  }
  // Stable order: declaration order, never Set insertion order.
  return CUISINE_TAGS.filter((t) => found.has(t));
}

/** Is this a cuisine we offer? Guards untrusted input at the boundary. */
export function isCuisineTag(value: string): value is CuisineTag {
  return (CUISINE_TAGS as readonly string[]).includes(value);
}
