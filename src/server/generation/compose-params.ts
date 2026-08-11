/**
 * COMPOSE_PARAMS v1 (XXX-35, Session 11 CP1) — the seat-choice objective's
 * tunables, in one versioned object.
 *
 * Deliberately NOT in GRAMMAR_PARAMS and not in `src/shared`: no rule
 * reads them and no client needs them. There is no
 * `seating.not-centered` violation and there must not be one — a day
 * seated legally at 11:30 is legal, and the grammar's job is to reject
 * days, not to have opinions about them. Centering is a PREFERENCE, so its
 * proof is the seated-time histogram, not a rule.
 *
 * Every number here is TIER 3 judgment under active tuning. `wIdle` is
 * explicitly provisional pending the founder's eye at CP3.
 */

export const COMPOSE_PARAMS = {
  version: "v1",

  seating: {
    /**
     * Pull toward the middle of the slot's window. The founder's "lunch at
     * 11:30/12" is this term's absence: the old composer took the earliest
     * legal minute BY DESIGN, so every day trended to its earliest legal
     * shape and an 11:30 lunch was that policy working correctly.
     */
    wCenter: 1.0,
    /**
     * Penalty for waiting around to hit a centre. THE most important term
     * here, and the one a naive centering fix omits: centering without it
     * manufactures exactly the dead time the founder complained about
     * ("2hr13 mins wasted in between"). The two complaints pull in
     * opposite directions and this is where the trade is explicit.
     *
     * 0.8 at CP1, corrected to **0.5** in Step 2 because a unit test
     * proved 0.8 did not do the ruled job: arriving at the lunch window's
     * open, waiting 75 minutes cost 0.8 × (75/45 → capped 1.0) = 0.80
     * against centering's 0.667, so the objective still chose **11:30** —
     * the founder's exact complaint, surviving the fix meant to end it.
     * With 0.5 over a 120-minute normalizer the optimum lands at
     * **12:30**, which is the nominal lunch the ticket itself named.
     *
     * Still PROVISIONAL per the CP1 ruling: the founder's eye at CP3 is
     * what settles it, and this arithmetic is only what makes it defensible
     * enough to put in front of them.
     */
    wIdle: 0.5,
    /**
     * Penalty for eating the tail of a window later stops still need. A
     * centred early stop that leaves no room for the day's close is a
     * different failure with the same cause.
     */
    wTail: 0.35,
    /**
     * Idle beyond this reads as fully wasted; normalizes the idle term.
     *
     * 45 at CP1, corrected to **120** in Step 2: at 45 any wait over
     * three-quarters of an hour was already "maximum waste", which made
     * ordinary breathing room indistinguishable from the founder's
     * 2h13 complaint — and that is the number their complaint actually
     * names. Half an hour between stops is a day breathing; two hours is
     * the day abandoning you.
     */
    idleNormalizerMinutes: 120,
    /** Window tail held in reserve before tailPressure starts to bite. */
    tailReserveMinutes: 30,
    /** Normalizes tail pressure once past the reserve. */
    tailNormalizerMinutes: 60,
    /**
     * Candidate start minutes are evaluated on this grid. 5 matches the
     * composer's existing cosmetic snap, so the objective and the clock
     * agree and no minute is scored that cannot be displayed.
     */
    gridMinutes: 5,
  },
} as const;

export type ComposeParams = typeof COMPOSE_PARAMS;
