/**
 * Hard constraints (XXX-43, Session 15) — the ONE owner of the question
 * "may this traveller be sent here?"
 *
 * The founder's *"I don't drink"* has to reach nine places: the close
 * palette, the skeleton's slot intents, the contrast picker, the theme
 * palettes, the family licence, retrieval, the selection menu, every repair
 * pass, and the validator. Nine call sites answering the same question
 * independently is precisely the shape this codebase has been bitten by four
 * times — `eveningOk` existed twice and disagreed with itself for a whole
 * session, and `PlaceTags.outdoor` disagreed with the family it was supposed
 * to mirror.
 *
 * So the question has exactly one implementation, here, and every seam calls
 * it. `src/shared/` because both the engine and the client need the same
 * answer — a UI that offers a bar to a traveller who excluded bars is the
 * same defect as an engine that seats one.
 *
 * PERMISSION IS NOT VIABILITY. `EVENING_VIABLE` answers "could a stop of this
 * kind plausibly be an evening at all" and stays untouched (CP0 ruling 6).
 * This answers "is this traveller willing to go". Two questions, two owners,
 * neither allowed to stand in for the other.
 */

import type { PlaceCategory } from "./vocabulary";

/**
 * May this traveller be sent to a stop of this category?
 *
 * The empty exclusion list is the overwhelmingly common case and returns
 * `true` for everything, which is what makes a constraint-free request
 * byte-identical to one from before this file existed.
 */
export function isCategoryPermitted(
  category: PlaceCategory,
  excluded: readonly PlaceCategory[],
): boolean {
  return !excluded.includes(category);
}

/**
 * The permitted subset, order preserved.
 *
 * Order matters at every call site: the close palette is a weighted draw
 * whose sequence is the die's, and menu allocation round-robins in list
 * order. Filtering must remove without reordering, or a constraint would
 * silently change the shape of a day beyond the removal itself.
 */
export function permittedCategories(
  categories: readonly PlaceCategory[],
  excluded: readonly PlaceCategory[],
): PlaceCategory[] {
  if (excluded.length === 0) return [...categories];
  return categories.filter((c) => isCategoryPermitted(c, excluded));
}

/**
 * Does this set of categories still offer anything?
 *
 * A step whose whole palette was excluded cannot be filled, and the honest
 * response is to say so rather than to seat something the traveller refused.
 * Callers use this to choose between "narrow the palette" and "this cannot be
 * built" — the distinction between a thinner day and a dishonest one.
 */
export function isFullyExcluded(
  categories: readonly PlaceCategory[],
  excluded: readonly PlaceCategory[],
): boolean {
  return (
    categories.length > 0 &&
    categories.every((c) => !isCategoryPermitted(c, excluded))
  );
}

/**
 * The limitation a hard constraint STILL owes the traveller (XXX-44).
 *
 * WHY THIS STRING EXISTS. Session 15 shipped it saying the filter was by
 * CATEGORY only, and that was true then: `excludedCategories` matched our
 * ten-category vocabulary, and Clandestino Wine Bar reached a no-alcohol day
 * mapped `restaurants`. Measured afterwards: 742 of 19,286 pooled restaurants
 * (3.85%) carry a `Dining and Drinking > Bar` label despite that mapping.
 *
 * WHY IT CHANGED. Those 742 are now excluded — `isVenuePermitted` reads the
 * venue's own directory labels, so a wine bar filed under Restaurant no
 * longer reaches a no-alcohol day. **The old sentence would now be a lie in
 * the traveller’s favour**, which is the more dangerous direction: it
 * would go on apologising for a hole that is closed while saying nothing
 * about the one that is open.
 *
 * WHAT IS ACTUALLY LEFT, which is what this sentence must say. Our evidence
 * is what a directory FILED, not what a bar licence says. A restaurant whose
 * FSQ record carries no drinking label but which pours all evening is
 * invisible to every seam we have — and so, deliberately, are `Gastropub`
 * and `Apple Wine Pub`, two leaves the source taxonomy files under
 * Restaurant and we declined to override (see `DRINKING_LABEL_PREFIXES`).
 *
 * The founder’s ruling stands and is why the sentence exists at all: say
 * so in-product rather than let him discover it. **Honest limits beat silent
 * ones** — and an honest limit that has stopped being true is a silent one.
 *
 * It is a CONSTANT in `shared/` so the sentence has one owner and one
 * wording, and so changing it is a deliberate act — as this was.
 */
export const CATEGORY_CONSTRAINT_LIMITATION =
  "I leave out bars, and any venue its own directory files as a drinking spot — including wine bars listed as restaurants. What I cannot see is a restaurant that simply pours: if its listing says nothing about drinking, I have nothing to go on.";

/**
 * Should the limitation be shown?
 *
 * NARROWED at XXX-44 (Session 16), and the narrowing is a defect fix rather
 * than a tidy-up. This returned `excluded.length > 0`, so a traveller who
 * excluded only `museums_galleries` was shown a paragraph about bars — a
 * caveat about a promise nobody made them, attached to a constraint it does
 * not describe. The sentence is about ALCOHOL, so the question it answers is
 * whether alcohol was refused.
 *
 * Nothing changes for the founder: his exclusion IS `nightlife_bars`.
 */
export function owesLimitationNotice(
  excluded: readonly PlaceCategory[],
): boolean {
  return excludesAlcohol(excluded);
}

/**
 * ── XXX-44: the attribute under the category ──────────────────────────────
 *
 * Everything above answers "may this traveller be sent to a CATEGORY?".
 * Session 15 shipped the limitation that question owes: `excludedCategories`
 * filters by our ten-category vocabulary, and category is a coarse proxy for
 * an ATTRIBUTE like "the point of this place is drinking". Clandestino Wine
 * Bar reached a no-alcohol day because it is mapped `restaurants` and every
 * category seam did its job.
 *
 * WHY THIS LIVES HERE rather than in a file of its own. It is the SAME
 * question — "may this traveller be sent here?" — asked one level finer, and
 * this file is the declared single owner of that question. A `drink.ts`
 * beside a `constraints.ts` is the `eveningOk` twin waiting to happen: two
 * modules that must agree about who may be sent where, with nothing forcing
 * them to. One owner, and the label evidence lives with the ruling it feeds.
 *
 * WHY THE SIGNAL IS LABELS, and what that costs. The `categories` fact has
 * carried the raw FSQ breadcrumbs as `source_labels` since Session 5, and
 * `retrieveCandidates` already joins that exact fact — so this is a pure
 * function over data we hold, not a new fetch, not a re-ingest, not a Google
 * call. Session 15 measured the gap two ways and the divergence is the
 * lesson: a regex over venue NAMES found 130 (0.67%); the stored LABELS found
 * 742 (3.85%). Same gap, 6× apart, because the instrument read the wrong
 * signal. This reads labels.
 *
 * WHAT IT IS NOT. It is not "does this venue serve alcohol" — nothing we hold
 * answers that, and a licensed Italian restaurant is invisible to it. It is
 * "does the venue's own directory record file it under a drinking branch".
 * Narrower, checkable, and stated as such in the limitation line below.
 */

/**
 * Breadcrumb prefixes that denote a DRINKING-FOCUSED venue, matched by
 * `startsWith` against the raw FSQ labels (the `CATEGORY_BREADCRUMB_RULES`
 * convention, and the same load-bearing punctuation care).
 *
 * Every entry is a branch of the pinned taxonomy, with its argument:
 *
 *  - `Dining and Drinking > Bar` — the whole subtree: Wine Bar, Cocktail Bar,
 *    Pub, Irish Pub, Sports Bar, Speakeasy, Lounge, Beer Garden, Whisky Bar.
 *    This is the 742. Note that `nightlife_bars` already claims this prefix
 *    in `CATEGORY_BREADCRUMB_RULES` — the venues that matter here are the
 *    ones that ALSO carry a Restaurant label and were mapped `restaurants`
 *    by declaration order, so the category constraint never saw them.
 *  - `Arts and Entertainment > Night Club` and `Nightlife` — the other two
 *    prefixes that already define `nightlife_bars`. Listed so this predicate
 *    and that category cannot disagree about what a bar is.
 *  - The three alcohol RETAIL leaves. These are not decoration: the FSQ
 *    food-retail branch maps to `grocery`, `grocery` is what an experience's
 *    `provisioning` stop draws from, and the first live islands day sent the
 *    traveller to buy picnic supplies at **an LCBO** (recorded in
 *    `movement.ts`'s causality clause). A no-alcohol traveller provisioned at
 *    a liquor store is the same defect as one seated in a wine bar.
 *
 * DELIBERATELY OUT, and this is the residual gap the limitation line names:
 * `Dining and Drinking > Restaurant > Gastropub` and `… > German Restaurant >
 * Apple Wine Pub`. Both are pubs by any honest reading and both are filed by
 * FSQ under Restaurant. They are excluded because including them means
 * overriding the source taxonomy with a private opinion about which
 * restaurant leaves are really bars — the judgment call `CUISINE_PREFIXES`
 * refused for `Pizzeria`, and the argument is the same. One line each to
 * reverse; `scripts/alcohol-report.ts` prints their live counts every run so
 * the decision is re-made against numbers rather than forgotten.
 */
export const DRINKING_LABEL_PREFIXES: readonly string[] = [
  "Dining and Drinking > Bar",
  "Arts and Entertainment > Night Club",
  /**
   * `Nightlife Spot`, and NOT the bare `Nightlife` that
   * `CATEGORY_BREADCRUMB_RULES` carries — the difference is a genuine
   * mismatch this ticket's own instrument caught on its first run.
   *
   * That rule matches with a bare `startsWith`, so `"Nightlife"` reaches
   * `"Nightlife Spot"`. This predicate matches on NODE BOUNDARIES
   * (`=== prefix` or `startsWith(prefix + " > ")`), because a bare prefix is
   * how `"Cafe"` once swallowed `"Cafeteria"`. Under that stricter matcher
   * `"Nightlife"` is a dead rule: the taxonomy's node is `Nightlife Spot`.
   *
   * Named for the label that exists — the `Retail > Farmers Market` →
   * `Retail > Food and Beverage Retail > Farmers Market` correction exactly.
   * No Toronto venue is currently filed under it, which the report prints as
   * "unused here" rather than as a defect; the branch is real and the Sep 1–3
   * re-discovery may populate it.
   */
  "Nightlife Spot",
  "Retail > Food and Beverage Retail > Liquor Store",
  "Retail > Food and Beverage Retail > Beer Store",
  "Retail > Food and Beverage Retail > Wine Store",
];

/**
 * What the directory says about a venue's relationship to drinking.
 *
 * THREE states, not two, because the two-state version would have to pick a
 * side for the venues we have no record of — and picking either side silently
 * is the failure this project banned twice over (constraint 4; the
 * `transport` and `excludedCategories` null precedents in `GrammarContext`).
 *
 * `unknown` is narrower than it looks, and the narrowness is measured rather
 * than hoped for: `domain/schemas.ts` types `source_labels` as
 * `.nonempty()`, so a pooled venue that carries a `categories` fact at all
 * carries at least one label. `unknown` is therefore not "a restaurant we
 * did not look at" — it is a place with no `categories` fact: a user's own
 * anchor, a fixture place, a venue known only through Google.
 *
 * `not-focused` is a POSITIVE observation, not an absence: a directory that
 * filed this venue and did not file it under a drinking branch. Tier 2, and
 * fallible — it says nothing about whether the kitchen pours wine.
 */
export type DrinkingFocus = "focused" | "not-focused" | "unknown";

/** The directory's verdict on a venue, from its raw breadcrumbs. */
export function drinkingFocusOf(
  sourceLabels: readonly string[],
): DrinkingFocus {
  if (sourceLabels.length === 0) return "unknown";
  const focused = sourceLabels.some((label) =>
    DRINKING_LABEL_PREFIXES.some(
      (prefix) => label === prefix || label.startsWith(prefix + " > "),
    ),
  );
  return focused ? "focused" : "not-focused";
}

/**
 * Does excluding this category mean the traveller is refusing ALCOHOL?
 *
 * `nightlife_bars` and nothing else, and the mapping is not an inference:
 * the interview's own chip for that category reads **"No alcohol"**
 * (`Interview.tsx`), and the parse prompt says *"I don't drink" excludes
 * nightlife_bars* in those words. So the attribute constraint is DERIVED from
 * the category exclusion rather than carried as a second field.
 *
 * That is a deliberate refusal to widen the request contract, on
 * single-owner-per-fact grounds. A `noAlcohol: boolean` beside
 * `excludedCategories: ["nightlife_bars"]` would be two ways to say one
 * thing, free to disagree, and every stored profile would need a migration to
 * gain the second. Derived, the fix reaches every no-alcohol profile already
 * in the database on the next generation and adds no field anywhere.
 *
 * The cost, stated: a traveller who excludes bars because they are LOUD, not
 * because they do not drink, also loses the wine bar filed as a restaurant.
 * That is a strictly smaller day, never a broken promise, and it is the
 * conservative direction.
 */
export function excludesAlcohol(
  excluded: readonly PlaceCategory[],
): boolean {
  return excluded.includes("nightlife_bars");
}

/**
 * May this traveller be sent to this VENUE? — category and attribute at once.
 *
 * THE HONEST-ABSENCE ASYMMETRY, ruled explicitly (XXX-44, Session 16 CP1).
 *
 * The question the ticket asks: on a hard-constraint day, does an
 * UNKNOWN-alcohol venue get excluded or risked? The answer here is **risked,
 * and said out loud** — but the argument is not the usual one, and it matters
 * that it is not.
 *
 * The usual argument is `filters.ts`'s: *unknown facts do not eliminate a
 * candidate; only a known-bad fact is a hard no.* That is a rule about
 * FACTS ABOUT THE WORLD, and it is the right rule there. It is not the
 * argument here, because for alcohol the harm is asymmetric: a traveller who
 * does not drink, seated in a bar, has been ignored; a traveller denied one
 * restaurant among thousands has lost nothing they can feel. Where harm is
 * that lopsided, "risk it" needs a stronger warrant than a general principle.
 *
 * The warrant is the measurement. `unknown` here does not mean "a restaurant
 * whose labels we did not check" — the schema makes that state impossible.
 * It means **no `categories` fact at all**, which in practice is a user's own
 * anchor, a fixture place, or a Google-only venue. Excluding those would
 * reject the traveller's OWN committed bookings, which
 * `checkConstraints` already refuses to do on the stated ground that *the
 * user owns their own commitments*. So the two principles do not actually
 * collide: the population that "exclude unknowns" would punish is almost
 * exactly the population the constraint was never meant to govern.
 *
 * What DOES remain risked is a genuinely different thing, and the limitation
 * line names it: a venue the directory filed as a Restaurant and nothing
 * else, which nonetheless pours. That venue reads `not-focused` — a positive
 * Tier-2 observation, not an absence — so it is not the honest-absence case
 * at all. It is the case where our best evidence is simply wrong, and no
 * treatment of `unknown` would catch it.
 */
export function isVenuePermitted(
  category: PlaceCategory,
  drinkingFocus: DrinkingFocus,
  excluded: readonly PlaceCategory[],
): boolean {
  if (!isCategoryPermitted(category, excluded)) return false;
  if (!excludesAlcohol(excluded)) return true;
  return drinkingFocus !== "focused";
}
