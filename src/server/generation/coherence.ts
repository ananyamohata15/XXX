/**
 * Zone coherence — the post-selection swap pass (XXX-47, Session 16 CP2).
 *
 * THE DIAGNOSIS THIS ANSWERS, in the ticket's own words: *zone coherence is
 * absent from every stage that DECIDES and present only in the stage that
 * REPORTS.* Retrieval is zone-scoped but its zones are wide; `scoreCandidate`
 * has no distance term and structurally cannot (it scores ONE candidate
 * before any sequence exists); `allocateMenu` is per-intent and blind to the
 * rest of the day; the selector receives every menu at once. `composeDay`
 * computes real travel and `route.detour-avoidable` measures the damage —
 * after the day is committed. **No stage sees the whole sequence while it can
 * still change it.** That is a missing stage, not a tuning miss.
 *
 * This is the missing stage. It runs after selection, when the whole sequence
 * exists for the first time, and while it can still change.
 *
 * ── WHAT MAKES IT HONEST ──────────────────────────────────────────────────
 *
 * The danger in a pass like this is that it becomes a second selector with no
 * taste and a licence to overrule the first. Four properties stop it:
 *
 * 1. **It only ever proposes venues the MENU already held.** Every move is a
 *    venue the selector was offered and could have taken. Nothing enters a
 *    day that selection could not have chosen — the same guarantee
 *    `ComposeInput.alternates` already makes for the scheduler's fallback.
 * 2. **Every accepted move is re-validated through the grammar.** A move that
 *    saves twenty minutes and breaks an hours window is not an improvement,
 *    and this cannot ship one: the caller's `evaluate` recomposes and
 *    revalidates, and a trial that does not come back clean is discarded.
 * 3. **It must PROVE a saving.** Moves are accepted only on a strict
 *    reduction in total travel past a threshold. A pass that cannot measure
 *    an improvement makes none, and a day with coherent geography already is
 *    returned untouched, byte for byte.
 * 4. **The day's centre does not move.** The anchor intent is excluded from
 *    every move. It was elected for calibre and chosen for taste, and the
 *    geography should organise AROUND the centrepiece rather than trade it
 *    away for eleven minutes.
 *
 * That fourth property is worth naming for what it makes this: because the
 * anchor is pinned and everything else is drawn toward the shortest tour
 * through it, **the result is anchor-relative clustering — arrived at by
 * measurement rather than by biasing the menu.** The ticket's option 1 and
 * option 3 turn out to be the same intent, and only one of them has to guess.
 *
 * ── WHAT IT CANNOT FIX ────────────────────────────────────────────────────
 *
 * It works with what selection was OFFERED. If every option on every menu for
 * a slot sits in one far corner of the city, no move exists and the pass says
 * so by making none. That ceiling is retrieval's, and it is reported rather
 * than hidden: `moves.length === 0` with a large `route.detour-avoidable` on
 * the day is the signature of a menu problem, not a sequencing one.
 *
 * ── WHY NOT REORDER THE SLOTS THEMSELVES ──────────────────────────────────
 *
 * `route.detour-avoidable` proposes swapping two adjacent STOPS. That is the
 * right instinct and the wrong object here: `composeDay` seats by intent
 * window, so a "stop" is a venue in a slot with a time. Swapping the stops
 * would swap the times too — moving lunch into the evening window. Exchanging
 * the VENUES between two intents expresses the same idea correctly: each
 * venue is re-seated in its own slot's own window, and the legality of the
 * pairing is carried by the menus rather than asserted.
 */

import type { Menu, Selection } from "./types";

export type CoherenceMove =
  | {
      kind: "exchange";
      intentA: string;
      intentB: string;
      placeA: string;
      placeB: string;
      savedMinutes: number;
    }
  | {
      kind: "substitute";
      intentId: string;
      from: string;
      to: string;
      savedMinutes: number;
    };

/** What the caller learned by recomposing and revalidating one trial. */
export interface CoherenceTrial {
  /** Total travel across the composed day's legs. */
  totalTravelMinutes: number;
  /** Did the recomposed day validate with zero violations? */
  valid: boolean;
  /** Stops the trial failed to seat. A trial that loses one is not better. */
  unfilledCount: number;
}

export interface CoherenceOutcome {
  selections: Selection[];
  moves: CoherenceMove[];
  savedMinutes: number;
  /** Trials evaluated. The pass's whole cost, reported so it can be watched. */
  trials: number;
  /** Legal, travel-improving moves the GRAMMAR refused. */
  rejectedByGrammar: number;
  /** Legal, travel-improving moves that would have dropped a stop. */
  rejectedByUnfilled: number;
}

export interface CoherenceParams {
  /**
   * How much travel a move must save to be worth making.
   *
   * Not zero, and the reason is not caution about arithmetic. A one-minute
   * "improvement" is inside the noise of a Haversine estimate, and taking it
   * would mean overruling the selector's taste for a number we cannot stand
   * behind. The threshold is the point at which the saving is larger than our
   * confidence interval on it.
   */
  minSavingMinutes: number;
  /**
   * How many moves one pass may make. Bounds the work and, more importantly,
   * bounds how far the day can drift from what the selector chose: a pass
   * that rewrote every slot would be a selector, and this is not one.
   */
  maxMoves: number;
}

/**
 * Improve the day's geography without changing what it is.
 *
 * Deterministic by construction: moves are enumerated in a fixed order and
 * only a STRICTLY greater saving displaces the incumbent, so ties resolve to
 * the first move found and the same inputs always produce the same day. A
 * pass that shuffled a day differently on each run would be unreplayable from
 * its trace, which this project treats as a defect rather than a quirk.
 */
export function improveCoherence(input: {
  selections: readonly Selection[];
  menus: readonly Menu[];
  /**
   * Intents no move may touch — the anchor, and anything else the caller
   * considers the day's spine. Kept as a caller decision rather than a rule
   * here: this module knows about travel, not about what a day is for.
   */
  protectedIntentIds: ReadonlySet<string>;
  /**
   * Recompose and revalidate one candidate. `null` = this trial could not be
   * evaluated at all, which is treated as "not an improvement" rather than as
   * an error: a pass that throws on a bad trial would fail a generation over
   * an optimisation nobody asked for.
   */
  evaluate: (selections: Selection[]) => CoherenceTrial | null;
  params: CoherenceParams;
}): CoherenceOutcome {
  const { menus, protectedIntentIds, evaluate, params } = input;
  let current = [...input.selections];
  const moves: CoherenceMove[] = [];
  let trials = 0;
  let rejectedByGrammar = 0;
  let rejectedByUnfilled = 0;

  const baseline = evaluate(current);
  trials++;
  /**
   * A day that does not validate is the REPAIR LOOP's problem, not this
   * pass's. Improving the geography of a day that is about to be regenerated
   * would spend trials on a sequence nobody will see, and worse, could make
   * the violation harder to attribute.
   */
  if (baseline === null || !baseline.valid) {
    return {
      selections: current,
      moves,
      savedMinutes: 0,
      trials,
      rejectedByGrammar,
      rejectedByUnfilled,
    };
  }

  const menuFor = new Map(menus.map((m) => [m.intent.id, m]));
  const optionIds = new Map(
    menus.map((m) => [m.intent.id, m.options.map((o) => o.place.id)]),
  );
  /**
   * Roles that may not be EXCHANGED, only substituted.
   *
   * `provision` exists BECAUSE of the stop it serves — the picnic supplies
   * are bought before the picnic — and `movement.ts` already carries the
   * ruling that causality outranks distance. Slot ORDER is safe here by
   * construction (venues move between intents; intents keep their windows),
   * so this is belt and braces: it makes "never overrides a provisioning
   * causality" a property of the code rather than an argument about it.
   * Substituting a different grocery is still allowed — that is a different
   * shop, not a different order.
   */
  const noExchange = new Set(
    menus.filter((m) => m.intent.role === "provision").map((m) => m.intent.id),
  );

  let total = baseline.totalTravelMinutes;
  const startingTotal = total;

  while (moves.length < params.maxMoves) {
    let best: { move: CoherenceMove; trial: CoherenceTrial; next: Selection[] } | null =
      null;

    const consider = (move: CoherenceMove, next: Selection[]): void => {
      const trial = evaluate(next);
      trials++;
      if (trial === null) return;
      if (trial.unfilledCount > baseline.unfilledCount) {
        rejectedByUnfilled++;
        return;
      }
      const saved = total - trial.totalTravelMinutes;
      if (saved <= params.minSavingMinutes) return;
      // Measured AFTER the saving test, so the count means "a move worth
      // making that the grammar refused" rather than "a move we tried".
      if (!trial.valid) {
        rejectedByGrammar++;
        return;
      }
      if (best !== null && saved <= best.move.savedMinutes) return;
      best = { move: { ...move, savedMinutes: saved }, trial, next };
    };

    const used = new Set(current.map((s) => s.placeId));

    // --- substitutions: one slot re-picks from its OWN menu ---------------
    for (const selection of current) {
      if (protectedIntentIds.has(selection.intentId)) continue;
      const menu = menuFor.get(selection.intentId);
      if (menu === undefined) continue;
      for (const option of menu.options) {
        const to = option.place.id;
        if (to === selection.placeId) continue;
        // A venue already seated elsewhere is not available: one venue never
        // appears twice in a day, which `DeterministicSelector` enforces at
        // selection and this pass must not undo.
        if (used.has(to)) continue;
        consider(
          {
            kind: "substitute",
            intentId: selection.intentId,
            from: selection.placeId,
            to,
            savedMinutes: 0,
          },
          current.map((s) =>
            s.intentId === selection.intentId ? { ...s, placeId: to } : s,
          ),
        );
      }
    }

    // --- exchanges: two slots trade venues, if each menu holds the other's -
    for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        const a = current[i];
        const b = current[j];
        if (protectedIntentIds.has(a.intentId) || protectedIntentIds.has(b.intentId)) {
          continue;
        }
        if (noExchange.has(a.intentId) || noExchange.has(b.intentId)) continue;
        // LEGALITY IS THE MENUS', not a rule invented here. If b's venue is on
        // a's menu then a could have been given it by selection, with the same
        // window, the same hours check and the same category palette behind it.
        if (!optionIds.get(a.intentId)?.includes(b.placeId)) continue;
        if (!optionIds.get(b.intentId)?.includes(a.placeId)) continue;
        consider(
          {
            kind: "exchange",
            intentA: a.intentId,
            intentB: b.intentId,
            placeA: a.placeId,
            placeB: b.placeId,
            savedMinutes: 0,
          },
          current.map((s) =>
            s.intentId === a.intentId
              ? { ...s, placeId: b.placeId }
              : s.intentId === b.intentId
                ? { ...s, placeId: a.placeId }
                : s,
          ),
        );
      }
    }
    if (best === null) break;
    const winner: { move: CoherenceMove; trial: CoherenceTrial; next: Selection[] } =
      best;
    moves.push(winner.move);
    current = winner.next;
    total = winner.trial.totalTravelMinutes;
  }

  return {
    selections: current,
    moves,
    savedMinutes: startingTotal - total,
    trials,
    rejectedByGrammar,
    rejectedByUnfilled,
  };
}

/** One line per move, for the trace and the reviewer. */
export function describeMove(
  move: CoherenceMove,
  nameOf: (placeId: string) => string,
): string {
  return move.kind === "substitute"
    ? `${move.intentId}: ${nameOf(move.from)} → ${nameOf(move.to)} (−${move.savedMinutes} min)`
    : `${move.intentA} ↔ ${move.intentB}: ${nameOf(move.placeA)} / ${nameOf(move.placeB)} (−${move.savedMinutes} min)`;
}
