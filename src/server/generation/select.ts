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
