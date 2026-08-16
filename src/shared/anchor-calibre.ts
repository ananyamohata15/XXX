/**
 * Anchor calibre — is this VENUE fit to be a day's centrepiece?
 * (XXX-35, Session 13 Step 2, from Session 12 mining finding 1.)
 *
 * The founder's words, on a day whose centre was a pocket park:
 *
 *   *"An anchor that lasts only 20 mins? The anchor should be a highlight,
 *   not just anything random. Examples of a good anchor could be: canadas
 *   wonderland, or toronto zoo, or the lion safari near hamilton… And then
 *   you can fill it up with nice restaurants/bars/cafes/shopping
 *   areas/parks/waterfront/etc around it"*
 *
 * `electAnchor` elects a CATEGORY. The venue is then whatever `scoreCandidate`
 * ranks first inside it, so a 0.4-hectare creek park and Toronto Islands are
 * indistinguishable to the elector. Session 13 sized the centre correctly
 * (`anchorDwellFor`), which fixes the clock and does nothing for this: a
 * pocket park and the Islands are now both 75 minutes.
 *
 * ## What this is, and what it is NOT
 *
 * This is an INTERIM signal. XXX-31 owns the real quality signal, and until
 * it lands the pool holds almost nothing about how good a place is. So the
 * honest thing is a small, explicitly-tiered heuristic that says what it
 * knows and admits what it does not:
 *
 *  - **Tier 1 — founder curation.** A named list, per category. Operator
 *    trust, the same doctrine as `founder-groundtruth` (comment 10289). It
 *    is the only signal here that is actually about CALIBRE.
 *  - **Tier 2 — rating count at request time.** Available only for
 *    SHORTLISTED candidates, because that is who gets a Details fetch. A
 *    genuine observation, and a proxy: it measures FAME, not calibre.
 *  - **Tier 3 — unknown.** No Details fetch, no curation. Advisory, never
 *    a rejection: honest absence beats a confident guess (constraint 4).
 *
 * **The limitation, stated rather than buried.** Fame is not calibre. The
 * bar cleanly removes the bottom of the distribution — Severn Creek Park, a
 * single-counter grocery — and it cannot separate Berczy Park (≈4,000
 * ratings, a plaza with a dog fountain) from High Park. The CP1 matrix
 * seated Berczy Park as a nature-first persona's centrepiece, and this
 * heuristic would seat it again. Only curation fixes that case, which is
 * exactly why tier 1 exists and why the list is worth ten minutes.
 *
 * Pure and dependency-free: no I/O, no clock. Usable from either side.
 */

import type { PlaceCategory } from "./vocabulary";

/**
 * Rating count at or above which a place is treated as anchor-worthy on
 * fame alone.
 *
 * TIER 3 JUDGMENT, and a load-bearing constant of exactly the kind
 * CLAUDE.md's standard warns about — so its reasoning is written down.
 *
 * Calibrated against the venues actually observed in this project's own
 * generated days rather than against intuition:
 *
 *   Severn Creek Park (the Session 12 failure)   — pocket park, long tail
 *   Desta Gebeya Market (CP1 matrix anchor)      — single grocery, long tail
 *   Berczy Park (CP1 matrix anchor)              — ≈4,000
 *   St. Lawrence Market                          — tens of thousands
 *   Toronto Islands                              — tens of thousands
 *
 * 1,000 sits in the empty band between the two clusters. It is deliberately
 * NOT tuned to exclude Berczy Park: no rating-count bar can, since Berczy
 * genuinely is well-reviewed, and a bar pushed high enough to catch it would
 * also exclude every quiet destination a corners persona should be offered.
 * That failure belongs to curation, not to arithmetic.
 */
export const ANCHOR_MIN_RATING_COUNT = 1000;

/**
 * The founder's anchor-worthy list — TIER 1, operator trust.
 *
 * Seeded ONLY with venues the founder named verbatim, plus the two the
 * golden set already treats as day-defining destinations. Nothing here is
 * invented on the founder's behalf: an assistant's opinion about what makes
 * a good Toronto anchor is a tier-3 guess wearing a tier-1 badge, and the
 * whole value of this list is that it is not that.
 *
 * `scripts/curation-list.ts` prints the ten-minute worksheet — the venues
 * the pool would actually elect per category, ranked — for the founder to
 * accept or reject. Additions land here, in a reviewed commit.
 *
 * Matching is by NAME, EXACTLY (see `matchesCuratedName` for the four
 * false admits that killed the fuzzy version). Entries must therefore be
 * the pool's own spelling — which is exactly what the worksheet prints, so
 * the founder ticks real identities rather than recalling names.
 */
export const FOUNDER_ANCHOR_WORTHY: Readonly<
  Partial<Record<PlaceCategory, readonly string[]>>
> = {
  // Founder, verbatim: "canadas wonderland, or toronto zoo, or the lion
  // safari near hamilton". None is inside Toronto's pool bbox today; they
  // are recorded because they are the founder's own definition of the bar,
  // and XXX-38's excursion engine is where they become reachable.
  parks: [
    "Canada's Wonderland",
    "Toronto Zoo",
    "African Lion Safari",
    // Golden Day 7's composite anchor, founder-verified 2026-08-15.
    "Toronto Islands",
    "Hanlan's Point",
    "High Park",
  ],
  // Golden Day 1's centre. Both spellings the pool actually carries — the
  // worksheet found them, and exact matching means each needs its own line.
  markets: [
    "St Lawrence Market",
    "St. Lawrence Market (North Building)",
    "Kensington Market",
  ],
  museums_galleries: [],
  historic_sites: [],
  nightlife_bars: [],
};

/** Lowercase, strip punctuation and collapse space — for name comparison. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether a pool place's name matches a curated entry — EXACT, normalized.
 *
 * This was containment in both directions for about an hour, on the
 * reasoning that "St. Lawrence Market" ought to match "St. Lawrence Market
 * (North Building)". Running the curation worksheet against the real pool
 * killed it in four lines:
 *
 *   curated "Toronto Islands"  matched pool "Toronto"
 *   curated "Toronto Zoo"      matched pool "Toronto"
 *   curated "High Park"        matched pool "Mackenzie's High Park"  (a bar)
 *   curated "Kensington Market" matched pool "Kensington Market Sourdough"
 *                                                          (a bakery)
 *
 * Every one of those would have been admitted as a TIER 1 founder-curated
 * centrepiece. A loose match on the highest-trust signal in the system is
 * far worse than no match: it launders a guess as operator trust, which is
 * the one thing this tier must never do.
 *
 * So: exact normalized equality, and the worksheet prints the pool's own
 * names for the founder to tick. Curating two spellings of one market is a
 * second line in a list; admitting a sourdough bakery as a day's centrepiece
 * is a trust failure on the page.
 */
export function matchesCuratedName(
  placeName: string,
  curated: string,
): boolean {
  const a = normalizeName(placeName);
  const b = normalizeName(curated);
  if (a.length === 0 || b.length === 0) return false;
  return a === b;
}

export type AnchorCalibreBasis =
  | "founder-curated"
  | "rating-count"
  | "below-bar"
  | "unknown";

export interface AnchorCalibre {
  /**
   * `true` — fit to be a centrepiece. `false` — measured and found short.
   * `null` — NOT MEASURED. Honest absence, never a rejection.
   */
  worthy: boolean | null;
  basis: AnchorCalibreBasis;
  /** Provenance tier of the judgment, so a reader knows what it is worth. */
  tier: 1 | 2 | 3;
  /** One clause, for the trace and for a reviewer. */
  reason: string;
}

/**
 * Judge one candidate venue's fitness to be the day's centre.
 *
 * Order matters and is the tier order: curation outranks fame, fame
 * outranks silence, and silence is not a verdict.
 */
export function anchorCalibre(input: {
  name: string;
  category: PlaceCategory;
  /** Request-time rating count; null when no Details fetch was made. */
  userRatingCount: number | null;
  curated?: Readonly<Partial<Record<PlaceCategory, readonly string[]>>>;
}): AnchorCalibre {
  const curated = input.curated ?? FOUNDER_ANCHOR_WORTHY;
  const list = curated[input.category] ?? [];
  const hit = list.find((entry) => matchesCuratedName(input.name, entry));
  if (hit !== undefined) {
    return {
      worthy: true,
      basis: "founder-curated",
      tier: 1,
      reason: `the founder named ${hit} anchor-worthy`,
    };
  }
  if (input.userRatingCount === null) {
    return {
      worthy: null,
      basis: "unknown",
      tier: 3,
      reason:
        "no request-time rating count — this venue was never shortlisted, so its calibre was never measured",
    };
  }
  if (input.userRatingCount >= ANCHOR_MIN_RATING_COUNT) {
    return {
      worthy: true,
      basis: "rating-count",
      tier: 2,
      reason: `${input.userRatingCount} ratings clears the ${ANCHOR_MIN_RATING_COUNT} anchor bar (fame, which is a proxy for calibre)`,
    };
  }
  return {
    worthy: false,
    basis: "below-bar",
    tier: 2,
    reason: `${input.userRatingCount} ratings is under the ${ANCHOR_MIN_RATING_COUNT} anchor bar — a stop, not a centrepiece`,
  };
}

/**
 * Partition anchor candidates into those fit to be a centre and the rest.
 *
 * `unknown` rides with the worthy: honest absence must not silently demote a
 * venue nobody measured (constraint 4). Only a MEASURED shortfall demotes.
 */
export function partitionByCalibre<T>(
  candidates: readonly T[],
  read: (c: T) => { name: string; category: PlaceCategory; userRatingCount: number | null },
): { worthy: T[]; unworthy: T[] } {
  const worthy: T[] = [];
  const unworthy: T[] = [];
  for (const candidate of candidates) {
    const verdict = anchorCalibre(read(candidate));
    if (verdict.worthy === false) unworthy.push(candidate);
    else worthy.push(candidate);
  }
  return { worthy, unworthy };
}
