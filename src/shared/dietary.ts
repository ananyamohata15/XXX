/**
 * Dietary tags (XXX-43, Session 15) — a leaning, never a promise.
 *
 * THE RULING THIS FILE IMPLEMENTS, and the measurement that changed it. The
 * CP1 recommendation was going to be "wait for real menu data", on the
 * assumption that only vegan/vegetarian had any fact basis. Measured over the
 * live pool, that was wrong:
 *
 *     Vegan and Vegetarian Restaurant   253
 *     Halal Restaurant                  116
 *     Gluten-Free Restaurant             31
 *     Kosher Restaurant                  18  (+3 Kosher Store)
 *     allergy-aware / Jain                0  — no label exists at all
 *
 * 116 halal venues is a real signal, and refusing to use it would have been
 * its own dishonesty. So dietary ships.
 *
 * BUT A DIRECTORY TAG IS NOT A CERTIFICATION, and for someone who keeps halal
 * that gap is the entire point. This is exactly what the tier system was
 * built for: these tags are **tier 2 / Observed**, sourced from
 * `fsq_os_places`, and the UI must present them as such. They WEIGH what gets
 * offered. They never certify a kitchen, and no generated text may claim they
 * do.
 *
 * Allergy-aware and Jain are deliberately ABSENT rather than empty-listed:
 * there is no label in the taxonomy, so we have nothing, and the honest
 * response to nothing is to offer nothing and say so — not to ship a chip
 * that silently matches every venue or none.
 *
 * Mechanism is identical to `cuisine.ts` — a prefix view on the source tree —
 * because it is the same question asked of the same labels. See that file's
 * header for why prefixes and why an exhaustive Record.
 */

import { RESTAURANT_BRANCH } from "./cuisine";

export const DIETARY_TAGS = [
  "vegetarian",
  "vegan",
  "halal",
  "kosher",
  "gluten_free",
] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

export const DIETARY_LABELS = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  halal: "Halal",
  kosher: "Kosher",
  gluten_free: "Gluten-free",
} as const satisfies Record<DietaryTag, string>;

/**
 * Breadcrumb prefixes per dietary tag, relative to the restaurant branch.
 *
 * `vegetarian` and `vegan` intentionally share one label. The taxonomy has a
 * single combined node — "Vegan and Vegetarian Restaurant" — and splitting it
 * would mean claiming a distinction the source does not make. A vegan asking
 * for vegan gets venues that may only be vegetarian, which is precisely why
 * this is a leaning and the UI says so.
 */
export const DIETARY_PREFIXES = {
  /** 253, shared with vegan — the taxonomy does not separate them. */
  vegetarian: ["Vegan and Vegetarian Restaurant"],
  /** 253, shared with vegetarian. See the note above. */
  vegan: ["Vegan and Vegetarian Restaurant"],
  /** 116. */
  halal: ["Halal Restaurant"],
  /** 18 restaurants. The Kosher STORE node is retail, not a meal. */
  kosher: ["Jewish Restaurant > Kosher Restaurant"],
  /** 31. */
  gluten_free: ["Gluten-Free Restaurant"],
} as const satisfies Record<DietaryTag, readonly string[]>;

/**
 * Raw FSQ breadcrumbs → the dietary accommodations they suggest. Pure, total,
 * and — the important word — *suggest*. A venue with no tag is not unsafe;
 * it is unknown, which is a different fact and must be shown as one.
 */
export function dietaryFromLabels(labels: readonly string[]): DietaryTag[] {
  const found = new Set<DietaryTag>();
  for (const label of labels) {
    if (!label.startsWith(RESTAURANT_BRANCH + " > ")) continue;
    const leaf = label.slice(RESTAURANT_BRANCH.length + 3);
    for (const tag of DIETARY_TAGS) {
      for (const prefix of DIETARY_PREFIXES[tag]) {
        if (leaf === prefix || leaf.startsWith(prefix + " > ")) {
          found.add(tag);
          break;
        }
      }
    }
  }
  return DIETARY_TAGS.filter((t) => found.has(t));
}

export function isDietaryTag(value: string): value is DietaryTag {
  return (DIETARY_TAGS as readonly string[]).includes(value);
}

/**
 * The sentence a day must carry when a dietary preference was stated.
 *
 * It exists as a constant, in `shared/`, so that the honest-absence promise
 * is one string with one owner rather than a phrasing each surface invents.
 * A day that weighs a dietary tag and does NOT say this is a day that has
 * quietly implied a guarantee.
 */
export const DIETARY_ABSENCE_NOTE =
  "These are leanings from the venue directory, not certifications — check with the kitchen.";
