/**
 * The selection seam (CP1 §1.1 stage 6). Menus in, selections out —
 * nothing else crosses. Step 2's deterministic selector takes the
 * top-scored legal option; Step 3's LLM selector implements the same
 * contract with taste. The grammar loop re-offers menus with struck
 * candidates removed, so "repair" is a vocabulary the seam already
 * speaks.
 */

import type { Persona } from "@/shared/persona";
import type { Menu, Selection, Selector } from "./types";

export const MENU_SIZE = 4;

/**
 * Menu depth for a DISCRETIONARY intent — warmup, anchor, contrast, close
 * (XXX-40, Session 14 CP1 ruling 1).
 *
 * Meals are structural: their category list is short and the pattern owns
 * them, so four is plenty. The discretionary steps are where a concierge
 * actually chooses, and since Session 14 their menus are ALLOCATED across the
 * diced category order rather than sliced off its head. With four or five
 * categories in that order, a 4-deep menu gives the head exactly one option
 * and no within-category depth to survive an hours failure — the fallback
 * would always be "a different category" and never "a different bar".
 *
 * Six buys that depth. It buys no spend: `MENU_SIZE*` governs menu
 * COMPOSITION only, and the money is bounded by `SHORTLIST_NOMINAL` (24) and
 * `DETAILS_CAP` (30), neither of which moves.
 */
export const MENU_SIZE_DISCRETIONARY = 6;

/**
 * Top-scored legal candidate per slot, one venue never used twice.
 * Menus are pre-sorted by score, so this is argmax with a no-repeat
 * constraint — the stand-in CP2 requires and the fallback the LLM path
 * degrades to on contract-retry exhaustion.
 */
export class DeterministicSelector implements Selector {
  select(menus: Menu[], persona: Persona, seed: number): Promise<Selection[]> {
    void persona;
    void seed;
    const used = new Set<string>();
    const selections: Selection[] = [];
    for (const menu of menus) {
      const pick = menu.options.find((o) => !used.has(o.place.id));
      if (pick === undefined) continue; // menu exhausted: intent goes unfilled
      used.add(pick.place.id);
      selections.push({ intentId: menu.intent.id, placeId: pick.place.id });
    }
    return Promise.resolve(selections);
  }
}
