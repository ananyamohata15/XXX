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
  version: "v3",

  /**
   * Dice temperatures, in AFFINITY POINTS (XXX-35, Session 12 CP1).
   *
   * Folded in here rather than given their own object: they are the same
   * layer, the same lifecycle and the same tier as `seating` — composition
   * judgment that no grammar rule reads and no client needs. One versioned
   * object for the composer beats two.
   *
   * τ is how much STATED PREFERENCE a site may trade for variety. The unit is
   * meaningful: 0.35 is one `GRAVITY_WEIGHTS` step — one whole rank of
   * declared interest. τ = 0 is exactly ranking, which is every refit's
   * testable null hypothesis.
   *
   * All Tier 3 judgment, tunable post-CP3 per the CP1 ruling.
   */
  dice: {
    /**
     * The anchor mostly follows gravity — it IS the persona's first interest
     * made concrete, and inverting it breaks the product's promise. 0.05
     * breaks only near-exact ties, which are common (seven categories, three
     * interests) and today fall to `localeCompare`. That alphabet is why
     * `historic_sites` always beat `museums_galleries` at equal affinity.
     */
    anchor: 0.05,
    /**
     * Contrast is BY CONSTRUCTION not the top pick — it must differ in
     * texture family from the anchor. Ranking inside an already-constrained
     * set is close to arbitrary, so variety is cheapest here.
     */
    contrast: 0.3,
    /**
     * The close is the monotony surface Session 11 measured: six days, six
     * bars. Drawn post-`forEvening`, per the funnel rule.
     */
    close: 0.3,
    /**
     * A three-option list (cafes/markets/parks) where `markets` headed five
     * of six personas — and whose sort carried NO tie-break at all, so the
     * order rested on V8's sort stability.
     */
    warmup: 0.25,
    /** The contrast fallback's anchor proxy (`compose.ts` step `contrast`). */
    activity: 0.2,
    /**
     * Which zones a day draws from, within the lens's bucket. The lens still
     * sets WHICH bucket — an icons persona never draws a corners zone.
     */
    zone: 0.3,
  },

  /**
   * The centrepiece's own floors (XXX-35, Session 13 Step 2, from Session
   * 12's mining finding 1).
   *
   * `GRAMMAR_PARAMS.dwellMinutes[c].min` was doing two jobs at once: the
   * GRAMMAR floor (below which a stop of category c is not a legal stop) and
   * the COMPOSER'S drop floor (below which a step is not worth placing). For
   * an ordinary stop they can be the same number without anyone noticing.
   * For the anchor they must not be, and the founder found out why: a day
   * whose centrepiece was a pocket park seated for **20 minutes** —
   * `parks.min` exactly — with the trace still reporting a proudly elected
   * 60-minute anchor. Nothing was broken. `Math.min(dwell, window)` degraded
   * the day's centre to the category floor and seated it silently, because
   * the only floor it had to clear was the one that says "a 20-minute park
   * visit is a legal stop". It is. It is not a centrepiece.
   *
   * A grammar floor answers "is this a stop?". This answers "is this still
   * the day's centre?". Two questions, two numbers.
   */
  anchor: {
    /**
     * Below this, an elected anchor is no longer the day's centre and the
     * composer must say so instead of seating it.
     *
     * 75 rather than a per-category number, deliberately: the founder's own
     * examples — Canada's Wonderland, Toronto Zoo, African Lion Safari,
     * the Islands — say a centrepiece is a place you go TO for a good part
     * of a day, and that is a property of the ROLE, not of the category.
     * A per-category floor would re-import the exact conflation this splits.
     *
     * 75 sits above every category's grammar floor (max is
     * `restaurants`/`nightlife_bars` at 45) so it always binds, and below
     * every category's `typical` except `cafes` (45) and `parks` (60) —
     * which is the honest statement that a cafe is not a centrepiece and a
     * park has to earn it. Tier 3 judgment, calibrated against the six days
     * of the Session 13 CP1 matrix and due for the founder's eye at CP4.
     */
    minDwellMinutes: 75,
  },

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
