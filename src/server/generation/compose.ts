/**
 * Composition (CP1 §1.1 stage 7): the code-owned structure layer. The
 * skeleton decides what SHAPE the day wants; the scheduler turns
 * selections into a timed `GrammarDay` against meal-pattern windows,
 * pinned anchors (XXX-27: fill the negative space), hours predicates, and
 * the travel chain. The LLM owns none of this.
 *
 * Session 11 (XXX-35) changed two things here, both of them defects the
 * founder felt before anyone found them:
 *
 *  1. The skeleton has an ARC (see arc.ts). It used to deal meal intents
 *     off the pattern's windows and fill the leftovers with activities in
 *     persona-gravity order, which made 3 of 5 intents meals and let both
 *     activity slots draw the same top category. "Meal, gallery, meal,
 *     gallery, meal" was the only shape it could produce. Now every day
 *     elects a centrepiece and the rest of the day is placed relative to
 *     it — including its free time.
 *  2. Seating is an OBJECTIVE, not `earliest legal minute`. The old
 *     comment said the quiet part out loud: every slot was placed "at the
 *     earliest legal minute after travel", so every day trended to its
 *     earliest legal shape and an 11:30 lunch was that policy working
 *     correctly.
 *
 * The composer is still deliberately conservative, not clever: it avoids
 * the violations it can see coming (hours, pattern windows, anchor
 * buffers, daylight for outdoor slots, and now leg exposure) and lets
 * `validateDay` catch the rest — the grammar loop, not the composer, is
 * the guarantee.
 */

import {
  earliestVisitStart,
  openIntervalsOn,
  type Span,
} from "@/shared/day-grammar/predicates";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
import { diceStream, personaIdentity, weightedOrderBy } from "@/shared/dice";
import {
  SHELTERED_MODES,
  exposureAt,
  walkCapMinutes,
} from "@/shared/day-grammar/rules/exposure";
import { haversineKm } from "@/shared/day-grammar/travel";
import type {
  AnchorBaseline,
  GrammarDay,
  GrammarPlace,
  GrammarSlot,
  LatLng,
  MealPatternId,
  TravelTimeProvider,
} from "@/shared/day-grammar/types";
import type { HourlyExposure } from "@/shared/scheduling-windows";
import {
  categoryAffinity,
  gravityDominance,
  type Persona,
} from "@/shared/persona";
import {
  VENUE_THEME,
  experienceSpec,
  threadSpec,
  type DayTheme,
} from "@/shared/theme";
import { minutesToTime, timeToMinutes } from "@/shared/time";
import {
  CATEGORY_FAMILY,
  PLACE_CATEGORIES,
  weekdayOf,
  type CategoryFamily,
  type PlaceCategory,
  type TransportMode,
} from "@/shared/vocabulary";
import {
  ANCHOR_ELECTOR_SOURCE,
  closeCategories,
  electAnchor,
  holdsAThread,
  holdsAnExperience,
  isEveningViable,
  pickContrast,
  pickTemplate,
  warmupCategories,
  type ArcStep,
  type ElectedAnchor,
} from "./arc";
import { COMPOSE_PARAMS } from "./compose-params";
import type {
  AnchorInput,
  Candidate,
  ComposedLeg,
  ElectedAnchorRecord,
  GenerationRequest,
  OpenIntervalPlan,
  OpenPeriod,
  Selection,
  SlotIntent,
} from "./types";
export type { ComposedLeg } from "./types";

/**
 * Variety within a day is code-enforced (10294 point 4). Since Session 11
 * the arc's family logic does most of this work — a contrast step cannot
 * share the anchor's texture family — and this stays as the backstop that
 * catches any template/persona combination the family rules do not.
 */
export const MAX_SLOTS_PER_CATEGORY = 2;

/** Nominal length of a placed free-time period. */
export const OPEN_PERIOD_MINUTES = 60;

/**
 * A gap worth naming. Below this a gap is a stop's own overrun or a walk's
 * rounding, and labelling it would be noise; at or above it the traveller
 * has time they will notice, and time they notice must have a place.
 */
const OPEN_PERIOD_NOTICEABLE_MINUTES = 45;

/**
 * How far an anchor's window may run past its template slice when the
 * slice is too short to hold the centrepiece. Enough to seat it plus room
 * for the objective to centre it, not enough to swallow the next meal.
 */
const ANCHOR_WINDOW_SLACK_MINUTES = 60;

/**
 * The default day, with a tail that can actually hold an ending
 * (XXX-35 CP2 fix round).
 *
 * `close` was reaching the composer and failing to seat, and the
 * arithmetic says why. Classic dinner closes at 21:30, the objective
 * centres a 90-minute dinner at roughly 18:45–20:15, and an ending needs
 * travel (~20 min) plus its category minimum (45 min for a bar) on top —
 * about 21:20. A `moderate` day ended at 21:30 and a `relaxed` one at
 * 21:00, so the close was either impossible or decided by twenty minutes
 * of travel luck. Live day-1-jays seated its close with dinner at 18:45
 * and lost it with dinner at 19:05, on the same code.
 *
 * The old ends were never wrong for a day that STOPPED after dinner —
 * which is what every day did before the arc gave days an ending. A third
 * accidental load-bearer, and the same shape as the other two: a bound
 * that was only true because of behaviour that has since changed.
 */
const DEFAULT_DAY: Record<Persona["pace"], { start: string; end: string }> = {
  relaxed: { start: "09:30", end: "21:45" },
  moderate: { start: "09:00", end: "22:00" },
  packed: { start: "08:30", end: "22:30" },
};

/** Meal dwell judgments (minutes) — inside the category min/max bands. */
const MEAL_DWELL: Record<string, number> = {
  breakfast: 45,
  coffee: 45,
  brunch: 75,
  lunch: 60,
  dinner: 90,
};

const MEAL_CATEGORIES: Record<string, PlaceCategory[]> = {
  breakfast: ["cafes", "restaurants"],
  coffee: ["cafes"],
  brunch: ["restaurants", "cafes"],
  lunch: ["restaurants"],
  dinner: ["restaurants"],
};

export function defaultMealPattern(persona: Persona): MealPatternId {
  return persona.structure === "wanderer" ? "coffee_then_brunch" : "classic";
}

/**
 * Activity categories in persona-gravity order, food categories excluded.
 *
 * Diced (Session 12): its head is taken at the `contrast` step as the anchor
 * proxy, and as the fallback list when contrast finds nothing — so an
 * un-diced ranking here reintroduced the very determinism the contrast draw
 * had just removed.
 */
export function rankedActivityCategories(
  persona: Persona,
  dice: () => number,
): PlaceCategory[] {
  return weightedOrderBy(
    PLACE_CATEGORIES.filter(
      (c) => !GRAMMAR_PARAMS.pacing.foodCategories.includes(c),
    ),
    (c) => categoryAffinity(persona, c),
    dice,
    COMPOSE_PARAMS.dice.activity,
  );
}

export interface Skeleton {
  intents: SlotIntent[];
  /** Free time the arc PLACED, not residue the arithmetic left over. */
  opens: OpenIntervalPlan[];
  daySpan: Span;
  mealPattern: MealPatternId;
  /** Which arc shape built this day — recorded so a shape is auditable. */
  templateId: string;
  /** null when a user anchor pre-empted election (the day has a centre). */
  electedAnchor: ElectedAnchorRecord | null;
  /**
   * Arc steps the day had no room for. Never silent: a thinner day than
   * the arc asked for is something a reviewer must be able to see, and the
   * engine's `unfilled` cannot report a step that never became an intent.
   */
  droppedSteps: { step: ArcStep; reason: string }[];
  /**
   * Set when the anchor could only be seated BELOW anchor calibre
   * (`COMPOSE_PARAMS.anchor.minDwellMinutes`) — the day has a centre, but a
   * diminished one.
   *
   * It is not a drop: dropping the anchor would ship the un-anchored day the
   * founder rejected in those exact words. It is not silence either, which is
   * what shipped before — a 20-minute pocket park seated as a centrepiece
   * while the trace reported a 60-minute elected anchor. The engine re-elects
   * around it (CP2 ruling 1's path, extended from *unseatable* to *seated but
   * degenerate*), and if no category can do better the day says so out loud.
   */
  anchorDegraded: {
    category: PlaceCategory;
    /** What the window actually allowed. */
    fittedMinutes: number;
    /** What a centrepiece needed. */
    floorMinutes: number;
  } | null;
}

const spanMinutes = (s: Span): number => Math.max(0, s.end - s.start);
const spanClip = (s: Span, outer: Span): Span => ({
  start: Math.max(s.start, outer.start),
  end: Math.min(s.end, outer.end),
});

/**
 * Contiguous sub-windows of `span`, proportional to each step's need.
 *
 * Each step gets its own centre, which is what makes the seat objective
 * spread a day rather than pile every stop into the middle of one big
 * window. A sub-window is never narrower than the step's own need: on a
 * tight segment the slices overlap and the cursor serializes them, which
 * is honest, where a too-narrow window would just fail to seat.
 */
function sliceSegment(span: Span, needs: number[]): Span[] {
  const total = needs.reduce((a, b) => a + b, 0);
  const room = spanMinutes(span);
  if (needs.length === 0) return [];
  if (total <= 0) return needs.map(() => ({ ...span }));
  const out: Span[] = [];
  let cursor = span.start;
  needs.forEach((need, i) => {
    const start = Math.round(cursor);
    const share = room * (need / total);
    const isLast = i === needs.length - 1;
    const end = isLast
      ? span.end
      : Math.min(span.end, Math.max(start + need, Math.round(cursor + share)));
    out.push({ start, end: Math.max(end, start + need) });
    cursor += share;
  });
  return out;
}

/**
 * Which of the pattern's windows a template's meal steps use.
 *
 * Templates carry two meal steps where `classic` offers three windows, so
 * one is dropped — and it is dropped from the FRONT. Travelling, breakfast
 * is the meal that actually goes: a warmup cafe often replaces it, and the
 * templates that open with `warmup` literally do. Taking the last k also
 * keeps the day's main meals (lunch, dinner) where a traveller expects
 * them, which taking the first k would not.
 */
function mealWindowsFor(
  pattern: { windows: { label: string; open: string; close: string }[] },
  mealStepCount: number,
): { label: string; open: string; close: string }[] {
  if (mealStepCount >= pattern.windows.length) return [...pattern.windows];
  // A single-meal template takes the MIDDLE window, not the last. Taking
  // the last gave wanderers a day whose only meal was dinner, and since
  // every non-meal step is laid out relative to the meal windows, the
  // whole arc collapsed into the evening after it. The middle window is
  // also the right answer on its own terms: one meal on a drifting day is
  // brunch or lunch, not a 19:00 sit-down.
  if (mealStepCount === 1) {
    return [pattern.windows[Math.floor((pattern.windows.length - 1) / 2)]];
  }
  return pattern.windows.slice(pattern.windows.length - mealStepCount);
}

/**
 * What the day wants, before any venue exists — as an ARC.
 *
 * A user anchor PRE-EMPTS election: the day already has a centre, and
 * electing a second one is the duplicate ownership XXX-27 exists to
 * prevent. Wanderers get an arc too (three stops and their negative
 * space); rule 27's unstructured floor stays the binding constraint.
 */
export function buildSkeleton(
  request: GenerationRequest,
  options: {
    /**
     * The day's RESOLVED seed — the one the engine minted and records in
     * the trace. Required, and deliberately not defaulted.
     *
     * This parameter exists because of the Session 12 defect: composition
     * used to re-read `request.seed`, which is the CALLER'S REQUEST for a
     * seed (null from the tasting room) and not the seed the day was built
     * with. It fell to 0, so every room day diced its entire arc at 0 while
     * the trace recorded the minted seed beside it — six selection points
     * inert and a trace that could not reproduce its own day.
     *
     * Two different things had one name. They now have two: `request.seed`
     * is an input preference the engine reads once, `options.seed` is the
     * resolved value everything downstream is built from. A required
     * parameter means the compiler asks every caller which one it means.
     */
    seed: number;
    /**
     * Anchor categories this day has already proven it cannot seat. The
     * engine re-elects around them rather than shipping an anchorless day
     * (XXX-35 CP2 ruling 1).
     */
    excludeAnchorCategories?: readonly PlaceCategory[];
    /**
     * The day's THEME — the organizing mode above the arc (XXX-40).
     *
     * Ratified at Session 14 CP0 as belonging HERE: `buildSkeleton` is the
     * single owner of the three things a theme must be able to change —
     * template family, palette, and anchor mode — and nothing downstream can
     * widen any of them. `buildMenus` filters within `intent.categories`, the
     * selector picks within the menu, and `composeDay` seats what it is
     * given.
     *
     * Defaults to `venue`, which is today's arc unchanged. That default is an
     * ACCEPTANCE CRITERION, not a convenience: a venue day must be
     * byte-identical to the pre-theme output for the same (persona, date,
     * seed), so the theme layer cannot have broken themeless days.
     */
    theme?: DayTheme;
  },
): Skeleton {
  const persona = request.persona;
  const theme = options.theme ?? VENUE_THEME;
  const experience =
    theme.mode === "experience" ? experienceSpec(theme.experienceId) : null;
  const thread = theme.mode === "thread" ? threadSpec(theme.threadId) : null;
  const defaults = DEFAULT_DAY[persona.pace];
  const daySpan: Span = {
    start: timeToMinutes(request.dayStart ?? defaults.start),
    end: timeToMinutes(request.dayEnd ?? defaults.end),
  };
  if (persona.structure === "wanderer" && request.dayEnd === undefined) {
    // Wanderers run into the night (golden Day 5: "the strip is the
    // plan") — the default day is longer so the evening anchor fits, and
    // rule 35's late-night advisory still narrates anything past 23:30.
    daySpan.end = Math.max(daySpan.end, timeToMinutes("22:30"));
  }
  const mealPattern = request.mealPattern ?? defaultMealPattern(persona);
  const pattern = GRAMMAR_PARAMS.mealPatterns[mealPattern];
  const seed = options.seed;
  /**
   * THE TEMPLATE FAMILY IS A THEME'S FIRST LEVER (XXX-40, CP1 §1.1). A
   * thread needs two discretionary positions for its spine; an experience
   * needs a template that does not fight a multi-hour block.
   */
  const template = pickTemplate(
    persona,
    seed,
    thread !== null
      ? holdsAThread
      : experience !== null
        ? holdsAnExperience
        : undefined,
  );

  /**
   * One dice key per (site, context) — the funnel rule's machinery.
   *
   * `identity` is the persona's content hash, so two similar personas draw
   * different streams; `site` keeps two selectors at one seed from drawing
   * the same number; `context` carries the date and, where a day has several
   * of a step, that step's window — so two closes in one day, or one persona
   * on two dates, draw independently.
   */
  const identity = personaIdentity(persona);
  const rollFor = (site: string, context: string): (() => number) =>
    diceStream({ seed, identity, site, context: `${request.date}|${context}` });

  const hasUserAnchor = (request.anchors ?? []).length > 0;
  /**
   * A THEME pre-empts election exactly as a user anchor does, and for the
   * same reason (XXX-40).
   *
   * `electAnchor` answers "which category is this traveller's day centred
   * on". A thread has already answered it — the narrative IS the anchor — and
   * an experience has answered it with a composite block. Electing a second
   * centre would be the duplicate ownership XXX-27 exists to prevent, and the
   * founder's own ruling is the reason the question is malformed for these
   * days: *"A DAY CANNOT BE SOLELY ANCHORED ON ANY ONE MUSEUM ... BUT A
   * HISTORY TOUR OF TORONTO WOULD BE AN ANCHOR"*.
   */
  const themeOwnsAnchor = experience !== null || thread !== null;
  const elected: ElectedAnchor | null = hasUserAnchor || themeOwnsAnchor
    ? null
    : electAnchor(persona, {
        exclude: options.excludeAnchorCategories ?? [],
        // Re-election must not redraw the same order it just drew, or the
        // engine retries its way through an identical list. The exclusions
        // are part of the context, so each re-election is a fresh draw.
        dice: rollFor(
          "anchor",
          (options.excludeAnchorCategories ?? []).join(","),
        ),
      });
  const electedRecord: ElectedAnchorRecord | null =
    elected === null
      ? null
      : {
          category: elected.category,
          dwellMinutes: elected.dwellMinutes,
          reason: elected.reason,
          source: ANCHOR_ELECTOR_SOURCE,
          tier: 3,
        };

  // --- 1. what each step needs, before any window or category exists -------
  //
  // Layout runs on NOMINAL needs and category choice happens afterwards,
  // in time order. The other way round is what produced three bugs in the
  // first draft: a step's evening-viability depends on the window it ends
  // up in, so choosing categories first meant an evening fallback could
  // override the family logic AND overwrite the elected anchor's own
  // category with a bar.
  const mealStepCount = template.steps.filter((s) => s === "meal").length;
  const windows = mealWindowsFor(pattern, mealStepCount);

  interface Step {
    step: ArcStep;
    /** Nominal minutes for layout; the real dwell follows the category. */
    need: number;
    /** Pattern window index, for meal steps only. */
    windowIndex: number | null;
  }

  /** Nominal needs. Deliberately coarse: layout only needs a shape. */
  const NOMINAL: Record<Exclude<ArcStep, "meal">, number> = {
    /**
     * A composite block asks for its curated minimum, not a category's
     * typical (XXX-38). Asking for the MIN rather than the max is deliberate:
     * layout has to fit inside a real day, and golden Day 7's own eight hours
     * come from the seating below widening to the block's max where the
     * window allows. Asking for 480 up front would drop the anchor from every
     * template whose slice is shorter.
     */
    anchor: experience?.anchor.dwell.min ?? elected?.dwellMinutes ?? 120,
    warmup: 45,
    contrast: 90,
    close: 90,
    /**
     * A provisioning stop is an errand with a purpose (XXX-38): long enough
     * to pick up a picnic and a bottle, short enough that it never reads as
     * an activity. `grocery.typical` is 25 and that is the right number —
     * this step is the one place the category table and the role agree.
     */
    provision: 25,
    /** A hotel reset that is worth going back for (XXX-42). */
    rest: 60,
    open: OPEN_PERIOD_MINUTES,
  };

  /**
   * The floor below which a step is not worth placing — as opposed to
   * NOMINAL, which is what it would LIKE.
   *
   * The two were the same number until sequential slicing landed, and that
   * conflation was hidden by the same edge-hugging bound: segments used to
   * be optimistically long, so nothing ever tested the difference. Slicing
   * the day around where meals actually sit shortened the tail honestly —
   * and a 90-minute nominal then dropped the `close` from every moderate-b
   * day, even though composition fits dwell down to the category minimum
   * (a 45-minute bar) a few lines later and would have seated it happily.
   *
   * Dropping a day's ending because it could not have the dwell it
   * preferred is not honesty, it is arithmetic. These are the minimums the
   * grammar itself already enforces.
   */
  const NOMINAL_MIN: Record<Exclude<ArcStep, "meal">, number> = {
    anchor: experience
      ? experience.anchor.dwell.min
      : Math.min(elected?.dwellMinutes ?? 120, 60),
    warmup: 20,
    contrast: 30,
    close: 45,
    provision: 10,
    /**
     * Below three quarters of an hour a "reset" is a detour to drop bags.
     * That may be worth doing, but it is not the rest the load trigger is
     * answering, and calling it one would make the reason a lie.
     */
    rest: 45,
    open: OPEN_PERIOD_MINUTES,
  };

  let mealCursor = 0;
  const steps: Step[] = [];
  /**
   * PROVISIONING is inserted ahead of the anchor, never appended (XXX-38).
   *
   * Golden Day 7's trap list names the failure directly: *"Skipping
   * provisioning (the grocery stop exists BECAUSE of the picnic —
   * causality)"*. Causality has a direction, and a supplies stop placed after
   * the picnic is not a late stop — it is a different, incoherent day. So the
   * step is dealt into the template stream immediately before `anchor` rather
   * than left to the layout to place.
   */
  const withProvisioning: ArcStep[] = [];
  for (const step of template.steps) {
    if (step === "anchor" && experience?.provisioning !== undefined) {
      withProvisioning.push("provision");
    }
    withProvisioning.push(step);
  }
  for (const step of withProvisioning) {
    if (step === "meal") {
      const window = windows[mealCursor];
      if (window === undefined) continue; // fewer windows than steps: honest drop
      steps.push({
        step,
        need: MEAL_DWELL[window.label] ?? 60,
        windowIndex: mealCursor,
      });
      mealCursor++;
      continue;
    }
    steps.push({ step, need: NOMINAL[step], windowIndex: null });
  }

  // --- 2. lay the steps out in time ---------------------------------------
  // Meal steps own their pattern window; every other step is sliced into
  // the segment between the meal windows that bracket it.
  const dropped: { step: ArcStep; reason: string }[] = [];
  let anchorDegraded: Skeleton["anchorDegraded"] = null;

  const segments: Step[][] = [[]];
  const mealAt: Step[] = [];
  for (const step of steps) {
    if (step.step === "meal") {
      mealAt.push(step);
      segments.push([]);
    } else {
      segments[segments.length - 1].push(step);
    }
  }

  const mealSpans = mealAt.map((meal) =>
    spanClip(
      {
        start: timeToMinutes(windows[meal.windowIndex!].open),
        end: timeToMinutes(windows[meal.windowIndex!].close),
      },
      daySpan,
    ),
  );

  /**
   * Where a meal is EXPECTED to sit — the sequential-slicing fix
   * (XXX-35 CP2 ruling b).
   *
   * **The seating fix exposed the edge-hugger as accidentally
   * load-bearing.** The old composer took the earliest legal minute, so
   * `mealWindow.start + need` really was when lunch released the day, and
   * every non-meal step was laid out from that bound. The seat objective
   * centres meals instead — and the bound silently became a lie. day-1-jays
   * got an anchor slice of 12:30–14:20 while its own lunch, now centred,
   * sat in 12:30–13:30. Three categories were tried and none could be
   * seated, because none of them was ever the problem.
   *
   * So the layout asks the objective's own question — where will this meal
   * actually sit? — and slices the day sequentially around the answer.
   */
  const expectedMealSeat = (span: Span, need: number): Span => {
    const centre = (span.start + span.end) / 2;
    const start = Math.max(span.start, Math.round(centre - need / 2));
    return { start, end: Math.min(span.end, start + need) };
  };

  /** The open span available to segment i (before meal i, or after the last). */
  const segmentSpan = (index: number): Span => {
    const previousMeal = index === 0 ? null : mealAt[index - 1];
    const start =
      previousMeal === null
        ? daySpan.start
        : Math.min(
            daySpan.end,
            expectedMealSeat(mealSpans[index - 1], previousMeal.need).end,
          );
    const end =
      index < mealAt.length
        ? Math.min(
            daySpan.end,
            expectedMealSeat(mealSpans[index], mealAt[index].need).start,
          )
        : daySpan.end;
    return { start, end: Math.max(end, start) };
  };

  /** A step placed in time, before it knows what it is looking for. */
  interface Placed {
    step: ArcStep;
    window: Span;
    need: number;
    /** Meal label ("lunch"), for meal steps. */
    label: string | null;
  }
  const placed: Placed[] = [];

  segments.forEach((segment, index) => {
    const span = segmentSpan(index);
    const slices = sliceSegment(
      span,
      segment.map((s) => s.need),
    );
    segment.forEach((step, i) => {
      let window = spanClip(slices[i], daySpan);
      // THE ANCHOR IS NEVER DROPPED. A template may place the centrepiece
      // in a segment too short to hold it, and silently losing it would
      // deliver exactly the un-anchored day the founder rejected — while
      // the trace still claimed an anchor was elected. So the anchor's
      // window is widened past its slice instead; the cursor and the
      // meal's own (wide) window sort out the ordering from there.
      if (step.step === "anchor" && spanMinutes(window) < step.need) {
        window = spanClip(
          {
            start: window.start,
            end: window.start + step.need + ANCHOR_WINDOW_SLACK_MINUTES,
          },
          daySpan,
        );
      }
      const floor = NOMINAL_MIN[step.step as Exclude<ArcStep, "meal">];
      if (spanMinutes(window) < floor) {
        // A step the day has no room for is dropped — but never silently:
        // a thinner day than the arc asked for is something a reviewer
        // must be able to see, and the engine's `unfilled` cannot report a
        // step that never became an intent.
        dropped.push({
          step: step.step,
          reason: `window ${spanMinutes(window)}min is shorter than the ${floor}min floor it needs`,
        });
        return;
      }
      placed.push({ step: step.step, window, need: step.need, label: null });
    });

    const meal = mealAt[index];
    if (meal !== undefined) {
      const window = mealSpans[index];
      const label = windows[meal.windowIndex!].label;
      if (spanMinutes(window) < meal.need) {
        dropped.push({
          step: "meal",
          reason: `${label} window ${spanMinutes(window)}min is shorter than its ${meal.need}min dwell`,
        });
      } else {
        placed.push({ step: "meal", window, need: meal.need, label });
      }
    }
  });

  placed.sort((a, b) => a.window.start - b.window.start);

  // --- 3. choose categories, in time order --------------------------------
  const usedFamilies = new Set<CategoryFamily>();
  if (elected !== null) usedFamilies.add(CATEGORY_FAMILY[elected.category]);
  /**
   * Evening viability now lives in ONE place — `arc.ts:EVENING_VIABLE`
   * (XXX-40, Session 14 CP0 census).
   *
   * This was a local list of three, which Session 13 found silently deleting
   * `scenic_viewpoints` from every close seated at or after 19:00 (it was
   * ranked ahead of `nightlife_bars` and never survived to be chosen), fixed
   * to four, and recorded in CLAUDE.md as the fourth load-bearing constant.
   *
   * The census this session ran found the rest of that defect: `pickContrast`
   * held a SECOND copy, still at the original three, which Session 13's fix
   * never reached. One owner now, and — the durable half — an exhaustive
   * `Record<PlaceCategory, boolean>` there, so the next category added to the
   * vocabulary cannot default to "not evening" in silence.
   *
   * Session 13's own pairing note still holds and is why the clamp is not
   * this list's job: a viewpoint IS an evening category — golden hour is the
   * entire point, and golden Day 7 is built on it — but it must never be an
   * outdoor stop after dark. `buildMenus` clamps outdoor windows to dusk, so
   * a scenic close can only seat while there is still something to see.
   */
  const isEvening = (window: Span) => window.start >= timeToMinutes("19:00");
  /**
   * Evening stops draw only from categories plausibly open at night —
   * museums and markets at 19:30 are the unverified-junk trap the first
   * live run walked into (Session 9 CP2). Applied as a FILTER on the
   * step's own preferences, never as a substitution: a fallback that
   * replaces the list is how the elected anchor became a bar in the first
   * draft of this function.
   */
  const forEvening = (
    categories: PlaceCategory[],
    window: Span,
  ): PlaceCategory[] =>
    isEvening(window) ? categories.filter(isEveningViable) : categories;

  /**
   * Family-freshness is a PREFERENCE, so it reorders — it must never
   * truncate.
   *
   * Filtering it as a hard cut cost two closes on the first Session-12
   * matrix (6/6 → 3/6). By the time a `close` is reached, the anchor's
   * family, the contrast's family and `table` (the meals) are all spent, so
   * `!usedFamilies` can leave exactly ONE survivor — and if that one cannot
   * seat, the step dies with nothing in reserve. The old either/or fallback
   * did not help: it only fired when the filter emptied the list completely,
   * never when it left a single unseatable entry.
   *
   * Demoting instead keeps the whole diced order available, fresh families
   * first, so the funnel's last filter (seatability) picks up the next thing
   * the dice wanted rather than dropping the step.
   */
  const demoteRatherThanDrop = (
    ordered: PlaceCategory[],
    fresh: (c: PlaceCategory) => boolean,
  ): PlaceCategory[] => [...ordered.filter(fresh), ...ordered.filter((c) => !fresh(c))];

  /**
   * THE FAMILY LICENCE (XXX-40, Session 14 CP1).
   *
   * Family-freshness above is right for almost every day, and wrong for one
   * traveller: the one whose single interest dominates. It demotes any
   * category whose family the anchor already spent — so a persona's STRONGEST
   * interest is structurally barred from the day's ENDING.
   *
   * Measured at CP0: `persona-shopper`'s die put `shopping` FIRST for the
   * close (affinity 1.0, exactly as the palette philosophy intends) and
   * freshness pushed it to third, because the anchor was also `shopping` and
   * `shopping` shares the MARKET family with `markets`. The founder's own
   * example of a shopper's day is Yorkville by day and the Eaton Centre class
   * in the evening — a shape the rule forbade.
   *
   * The licence is narrow on purpose, and the texture rules still bind:
   *
   *   - it applies to the CLOSE only — the bookend, not the middle;
   *   - it needs measurable dominance (`gravityDominance`), so it fires for
   *     the die-hard and not for a traveller with three balanced interests;
   *   - `rhythm.alternating-texture` still forbids A-B-A-B and
   *     `pacing.minTextureFamilies` (3) still applies, so a licensed day is
   *     `anchor(F) … close(F)` with at least three families in between.
   *     **A bookend, not an alternation.**
   *
   * Chiefly for DERIVED days: a requested theme carries an explicit palette
   * and the caller has already said what the day is for.
   */
  const licence = gravityDominance(
    persona,
    PLACE_CATEGORIES,
    (c) => CATEGORY_FAMILY[c],
    COMPOSE_PARAMS.persona.dominantFamilyPositions,
  );
  /**
   * The licensed family, or null — and the texture floor is checked HERE
   * rather than left to the validator.
   *
   * The first build delegated it: the comment claimed "the texture rules
   * still bind" because `pacing.minTextureFamilies` exists. The skeleton
   * invariant caught that as a lie within one run — `persona-scenic` came
   * back with **two** families, because licensing an outdoor close on an
   * outdoor-anchored day removed the day's third texture rather than
   * bookending an existing one.
   *
   * A rule that only fails at validation is a day the composer knowingly
   * built wrong. So the licence applies only when the day ALREADY holds its
   * three textures without the close — which is precisely the difference
   * between a bookend and an alternation, stated in code instead of prose.
   */
  const licensedFamilyFor = (used: Set<CategoryFamily>): CategoryFamily | null => {
    if (!licence.dominant || licence.category === null) return null;
    if (used.size < GRAMMAR_PARAMS.pacing.minTextureFamilies) return null;
    return CATEGORY_FAMILY[licence.category];
  };

  const intents: SlotIntent[] = [];
  const opens: OpenIntervalPlan[] = [];
  let nextId = 1;
  let lastIntentId: string | null = null;

  for (const item of placed) {
    if (item.step === "open") {
      opens.push({
        id: `o${opens.length + 1}`,
        afterIntentId: lastIntentId,
        minutes: Math.min(item.need, spanMinutes(item.window)),
      });
      continue;
    }

    let categories: PlaceCategory[];
    let label: string;
    let kind: SlotIntent["kind"] = "activity";
    /** Set by the close branch only; read when the intent is pushed. */
    let licensedFamily: CategoryFamily | null = null;

    if (item.step === "meal") {
      label = item.label ?? "meal";
      kind = "meal";
      categories = MEAL_CATEGORIES[label] ?? ["restaurants"];
      // A meal's window comes from the pattern, so it is already legal at
      // its hour; the evening filter would only ever narrow dinner to
      // restaurants, which it already is.
    } else if (item.step === "provision") {
      /**
       * The stop that exists BECAUSE of the anchor (XXX-38). Its category is
       * the spec's, not a draw: a picnic needs a grocer, and offering the die
       * a choice here would be pretending there is one.
       */
      categories = [experience!.provisioning!.category];
      label = "provisioning";
    } else if (item.step === "anchor") {
      /**
       * A THEME owns the anchor when it has one (XXX-40).
       *
       * An experience's composite block draws from its curated categories; a
       * thread's spine takes the anchor position and the contrast beside it.
       * Neither consults `electAnchor`, because both have already answered
       * the question it asks.
       */
      // The elected category is not negotiable — it is the day's centre.
      // If it cannot be open at this hour the hard filters will say so and
      // the intent goes unfilled honestly, which is a visible thin day
      // rather than a silently different one.
      categories =
        experience !== null
          ? [...experience.anchor.categories]
          : thread !== null
            ? [...thread.spine.categories]
            : elected !== null
              ? [elected.category]
              : rankedActivityCategories(persona, rollFor("activity", "anchor"));
      label =
        experience !== null
          ? experience.label
          : thread !== null
            ? thread.label
            : "the day's anchor";
    } else if (item.step === "warmup") {
      // THE FUNNEL RULE. The die is rolled here, at the point of use, over
      // the options that have already survived both narrowings — never
      // inside `warmupCategories`, which sits above them. Session 11 blamed
      // `closeCategories` for the six-bar day and queued "make it a seeded
      // choice"; measured, that would not have worked, because the collapse
      // happens in the filters BELOW the ranking. A die rolled upstream of a
      // funnel is still a funnel.
      const at = String(item.window.start);
      categories = demoteRatherThanDrop(
        forEvening(warmupCategories(persona, rollFor("warmup", at)), item.window),
        (c) => !usedFamilies.has(CATEGORY_FAMILY[c]),
      );
      label = "warm-up";
    } else if (item.step === "contrast" && thread !== null) {
      /**
       * A THREAD's spine occupies the contrast position too — roles adapt.
       *
       * This is the one place a theme deliberately BREAKS the arc's own
       * anti-alternation rule, and it is the reason threads need machinery
       * rather than a cleverer `pickContrast`: a spine is same-family by
       * construction, and `pickContrast` structurally forbids a second stop
       * in the anchor's family. The founder ruled that a history TOUR is an
       * anchor where a single historic site is not, and a tour is exactly
       * two or three culture stops in a row.
       *
       * The texture floor is not abandoned — the meals and the close still
       * bring their own families, and `pacing.minTextureFamilies` still
       * governs the finished day.
       */
      categories = [...thread.spine.categories];
      label = thread.label;
    } else if (item.step === "contrast") {
      const at = String(item.window.start);
      const anchorCategory =
        elected?.category ??
        rankedActivityCategories(persona, rollFor("activity", at))[0];
      const picks = pickContrast(persona, anchorCategory, usedFamilies, {
        eveningOnly: isEvening(item.window),
        dice: rollFor("contrast", at),
      });
      // The whole diced ORDER is carried, not its head: `buildMenus` filters
      // across every category in this list, so when the drawn first choice
      // has nothing open at this hour the DICED second choice is used —
      // rather than falling back to whatever the alphabet offered.
      categories =
        picks.length === 0
          ? forEvening(
              rankedActivityCategories(persona, rollFor("activity", at)),
              item.window,
            )
          : picks;
      label = "contrast";
    } else {
      const at = String(item.window.start);
      /**
       * Captured HERE, before `usedFamilies` gains this step's own primary a
       * few lines below. Reading it afterwards would ask the licence question
       * against a set that already contains the answer — the close's own
       * family would make `size >= 3` true for a two-texture day, which is
       * exactly the precondition the licence must not be able to fake.
       */
      licensedFamily = licensedFamilyFor(usedFamilies);
      categories = demoteRatherThanDrop(
        forEvening(closeCategories(persona, rollFor("close", at)), item.window),
        // The family licence: a dominant traveller's own texture counts as
        // fresh for the CLOSE, so the day may bookend on it — but only once
        // the day already holds its three textures. Everything else is
        // demoted exactly as before.
        (c) =>
          !usedFamilies.has(CATEGORY_FAMILY[c]) ||
          CATEGORY_FAMILY[c] === licensedFamily,
      );
      label = "the day's close";
    }

    if (categories.length === 0) {
      dropped.push({
        step: item.step,
        reason: `no category is both wanted and plausibly open at ${minutesToTime(item.window.start)}`,
      });
      continue;
    }

    const primary = categories[0];
    usedFamilies.add(CATEGORY_FAMILY[primary]);
    /**
     * A COMPOSITE BLOCK is sized by its own curated range (XXX-38, the ruled
     * owner-swap) and takes as much of its window as the day allows, up to
     * that range's max. An ordinary anchor takes its elected dwell.
     */
    const composite = item.step === "anchor" ? experience?.anchor.dwell : undefined;
    const dwell =
      composite !== undefined
        ? Math.min(composite.max, spanMinutes(item.window))
        : item.step === "anchor" && elected !== null
          ? elected.dwellMinutes
          : item.step === "meal"
            ? item.need
            : GRAMMAR_PARAMS.dwellMinutes[primary].typical;
    const fitted = Math.min(dwell, spanMinutes(item.window));
    /**
     * The floor a composite block must clear is ITS OWN, not the category's.
     * `parks.min` is 20 minutes, which an eight-hour island block would clear
     * trivially — and clearing it would let a 30-minute "composite" ship as
     * one. The spec's min is the number that says whether this is still the
     * experience it claims to be.
     */
    const floorMinutes =
      composite !== undefined
        ? composite.min
        : GRAMMAR_PARAMS.dwellMinutes[primary].min;
    if (fitted < floorMinutes) {
      dropped.push({
        step: item.step,
        reason:
          composite !== undefined
            ? `the composite block needs ${floorMinutes}min and the window holds ${spanMinutes(item.window)}min`
            : `${primary} needs ${floorMinutes}min and the window holds ${spanMinutes(item.window)}min`,
      });
      continue;
    }
    // The grammar floor above says whether this is a STOP. This says whether
    // it is still the day's CENTRE — the two were one number until Session 13,
    // and that is how a 20-minute park became an anchor in silence.
    if (
      item.step === "anchor" &&
      composite === undefined &&
      fitted < COMPOSE_PARAMS.anchor.minDwellMinutes
    ) {
      anchorDegraded = {
        category: primary,
        fittedMinutes: fitted,
        floorMinutes: COMPOSE_PARAMS.anchor.minDwellMinutes,
      };
    }

    const id = `i${nextId++}`;
    /**
     * The licensed category rides on the CLOSE intent so `buildMenus` can
     * give it menu depth. Promoting it to the head of `categories` was
     * measurably not enough — see `SlotIntent.licensedCategory`.
     */
    const licensed =
      licensedFamily !== null &&
      licence.category !== null &&
      categories.includes(licence.category)
        ? licence.category
        : undefined;
    intents.push({
      id,
      kind,
      label,
      window: item.window,
      categories,
      dwellMinutes: fitted,
      role: item.step,
      ...(licensed === undefined ? {} : { licensedCategory: licensed }),
      ...(composite === undefined ? {} : { composite }),
    });
    lastIntentId = id;
  }

  // Backstop: no category more than twice across the day (10294 point 4).
  // The anchor is exempt from being the one cut — it is the day's centre,
  // and a backstop that can delete the centrepiece is not a backstop.
  const categoryUse = new Map<PlaceCategory, number>();
  const byAnchorFirst = [...intents].sort(
    (a, b) => (a.role === "anchor" ? 0 : 1) - (b.role === "anchor" ? 0 : 1),
  );
  const cut = new Set<string>();
  for (const intent of byAnchorFirst) {
    const primary = intent.categories[0];
    const used = categoryUse.get(primary) ?? 0;
    if (used >= MAX_SLOTS_PER_CATEGORY) {
      cut.add(intent.id);
      dropped.push({
        step: intent.role ?? "meal",
        reason: `${primary} already has ${MAX_SLOTS_PER_CATEGORY} slots (variety backstop)`,
      });
      continue;
    }
    categoryUse.set(primary, used + 1);
  }

  const kept = intents.filter((intent) => !cut.has(intent.id));

  const ordered = kept.sort(
    (a, b) => a.window.start - b.window.start || a.id.localeCompare(b.id),
  );
  const keptIds = new Set(ordered.map((i) => i.id));
  return {
    intents: ordered,
    opens: opens.filter(
      (o) => o.afterIntentId === null || keptIds.has(o.afterIntentId),
    ),
    daySpan,
    mealPattern,
    templateId: template.id,
    electedAnchor: electedRecord,
    droppedSteps: dropped,
    anchorDegraded,
  };
}

/** Distance-driven mode choice among the modes the request allows. */
export function modeFor(
  distanceKm: number,
  allowed: TransportMode[],
): TransportMode {
  if (distanceKm <= 2.2 && allowed.includes("walk")) return "walk";
  for (const preferred of ["transit", "drive", "cycle", "walk"] as const) {
    if (allowed.includes(preferred)) return preferred;
  }
  return "walk";
}

export interface ComposeInput {
  request: GenerationRequest;
  skeleton: Skeleton;
  selections: Selection[];
  candidatesById: Map<string, Candidate>;
  travel: TravelTimeProvider;
  /** Civil-dusk minute for outdoor slots; null = no daylight known. */
  outdoorLatestEnd: number | null;
  /** Extra per-leg slack from the repair loop. 0 on the first pass. */
  slackMinutes?: number;
  /**
   * Hourly exposure readings for the date; null past the forecast horizon.
   * Drives the mode swap that keeps a traveller off a 35-minute winter
   * walk. null = the composer cannot know, so it does not pretend to —
   * `exposure.unknown` then reports the leg as unchecked.
   */
  exposure?: readonly HourlyExposure[] | null;
  /**
   * Menu order per intent (placeIds). When the SELECTED venue cannot be
   * seated — the cursor ate its window, its verified hours refuse — the
   * scheduler tries these in order rather than dropping the intent. The
   * selector's choice is honored whenever it seats; alternates are the
   * same legal menu, so no venue enters the day that selection could not
   * have offered. Venues chosen for other intents are never stolen.
   */
  alternates?: Map<string, string[]>;
  /**
   * Seat at the earliest legal minute instead of scoring the objective.
   * The Session-11 A/B seam ONLY: it reproduces the pre-XXX-35 composer
   * on identical inputs so the seated-time histograms cost no generations.
   * Production never sets it.
   */
  seatingLegacyEarliest?: boolean;
}

export interface ComposedDay {
  day: GrammarDay;
  anchorBaseline: Record<string, AnchorBaseline> | null;
  unfilled: string[];
  /**
   * The travel the scheduler actually priced between consecutive stops,
   * with the provider's own provenance. The composer used to compute
   * these and throw them away; the timeline needs real numbers with real
   * sources rather than a hand-wave, and doc 003 permits displaying
   * durations (mapless use) with attribution.
   */
  legs: ComposedLeg[];
  /**
   * Free time the arc placed, with a location and a reason. Not slots:
   * `slots.place_id` is NOT NULL and free time is not a stop, so making
   * it one would mean a migration to represent something that isn't.
   */
  openPeriods: OpenPeriod[];
  /**
   * Why the day returns to lodging mid-afternoon, or null (XXX-42).
   *
   * A rest stop without its reason is the unexplained gap the founder
   * complained about, wearing a label. The trigger travels with the day so
   * the narration can say "you will have walked two and a half hours by
   * then" rather than inventing a motive.
   */
  restReason:
    | { trigger: "physical-load"; loadMinutes: number; thresholdMinutes: number }
    | { trigger: "event-prep"; beforeSlotId: string }
    | null;
}

/**
 * Deterministic scheduler. Anchors are immovable; concierge slots flow
 * around them in time order, each placed at the minute the seat objective
 * likes best rather than the first one that is legal, snapped to a
 * 5-minute grid.
 */
export function composeDay(input: ComposeInput): ComposedDay {
  const { request, skeleton, selections, candidatesById, travel } = input;
  const weekday = weekdayOf(request.date);
  const params = GRAMMAR_PARAMS;
  const seating = COMPOSE_PARAMS.seating;
  const chosen = new Map(selections.map((s) => [s.intentId, s.placeId]));
  const exposure = input.exposure ?? null;

  interface Item {
    kind: "anchor" | "intent";
    anchor?: AnchorInput;
    intent?: SlotIntent;
    fixedStart?: number;
  }
  const anchorItems: Item[] = (request.anchors ?? []).map((anchor) => ({
    kind: "anchor",
    anchor,
    fixedStart: timeToMinutes(anchor.startTime),
  }));
  const intentItems: Item[] = skeleton.intents
    .filter((i) => chosen.has(i.id))
    .map((intent) => ({ kind: "intent", intent }));
  const items: Item[] = [...anchorItems, ...intentItems].sort(
    (a, b) =>
      (a.fixedStart ?? a.intent!.window.start) -
      (b.fixedStart ?? b.intent!.window.start),
  );

  const slots: GrammarSlot[] = [];
  const places: Record<string, GrammarPlace> = {};
  const anchorBaseline: Record<string, AnchorBaseline> = {};
  const unfilled: string[] = [];
  const openPeriods: OpenPeriod[] = [];
  let cursor = skeleton.daySpan.start;
  let prevCoords: LatLng | null = request.lodging ?? null;
  let prevNeighborhood: string | null = null;
  let anchorCount = 0;

  const openAfter = new Map<string, OpenIntervalPlan>();
  for (const open of skeleton.opens) {
    if (open.afterIntentId !== null) openAfter.set(open.afterIntentId, open);
  }
  /**
   * Free time whose start is fixed (the cursor was moved for it) but whose
   * end is not known until the next stop seats. Resolved into an
   * `OpenPeriod` there, or dropped if nothing follows — an open period with
   * nothing after it is just the day ending.
   */
  let pendingOpen: {
    id: string;
    start: number;
    end: number;
    reason: OpenPeriod["reason"];
  } | null = null;

  /**
   * The chosen mode for a leg, and the exposure swap if one happened.
   *
   * A walk over its weather cap is swapped for the first sheltered mode
   * the travel chain can actually PRICE. An unpriceable swap would be a
   * guess dressed up as care, so the walk stands and the leg-exposure
   * rule speaks instead.
   */
  const chooseMode = (
    from: LatLng,
    to: LatLng,
    km: number,
    departureLocal: string,
  ): {
    mode: TransportMode;
    swap: ComposedLeg["exposureSwap"];
  } => {
    const base = modeFor(km, request.transport);
    if (exposure === null) return { mode: base, swap: null };
    if (base !== "walk" && base !== "cycle") return { mode: base, swap: null };
    const reading = exposureAt(exposure, departureLocal);
    if (reading === null) return { mode: base, swap: null };
    const estimate = travel.estimate({
      origin: from,
      destination: to,
      mode: base,
      departureLocal,
    });
    if (estimate === null) return { mode: base, swap: null };
    const { capMinutes, drivers } = walkCapMinutes(reading, params.exposure);
    if (Math.ceil(estimate.minutes) <= capMinutes) {
      return { mode: base, swap: null };
    }
    for (const mode of SHELTERED_MODES) {
      if (!request.transport.includes(mode)) continue;
      const alternative = travel.estimate({
        origin: from,
        destination: to,
        mode,
        departureLocal,
      });
      if (alternative === null) continue;
      return {
        mode,
        swap: {
          fromMode: base,
          toMode: mode,
          exposedMinutes: Math.ceil(estimate.minutes),
          capMinutes,
          apparentTempC: reading.apparentTempC,
          drivers,
        },
      };
    }
    return { mode: base, swap: null };
  };

  /**
   * The priced leg between two points, or null when there is nothing to
   * price (same spot, missing coordinates) or no estimate is obtainable.
   * null is honest absence and costs zero minutes — never a guessed number.
   */
  interface PricedLeg {
    minutes: number;
    mode: TransportMode;
    source: string;
    tier: 1 | 2 | 3;
    exposureSwap: ComposedLeg["exposureSwap"];
  }
  /**
   * Memoized per (from, to, departure minute). The seating objective, the
   * slot's `arriveBy` and the recorded leg all want the same answer, and
   * an exposure-aware mode choice prices up to three modes to produce it —
   * asking three times would triple that for no new information.
   */
  const legCache = new Map<string, PricedLeg | null>();
  const priceLeg = (
    from: LatLng | null,
    to: LatLng | null,
  ): PricedLeg | null => {
    if (from === null || to === null) return null;
    const key = `${from.lat},${from.lng}|${to.lat},${to.lng}|${cursor}`;
    const cached = legCache.get(key);
    if (cached !== undefined) return cached;
    const priced = computeLeg(from, to);
    legCache.set(key, priced);
    return priced;
  };

  const computeLeg = (from: LatLng, to: LatLng): PricedLeg | null => {
    const km = haversineKm(from, to);
    if (km <= params.travel.negligibleDistanceKm) return null;
    const departureLocal = minutesToTime(Math.min(cursor, 1439));
    const { mode, swap } = chooseMode(from, to, km, departureLocal);
    const estimate = travel.estimate({
      origin: from,
      destination: to,
      mode,
      departureLocal,
    });
    if (estimate === null) return null;
    return {
      minutes: Math.ceil(estimate.minutes) + (input.slackMinutes ?? 0),
      mode,
      source: estimate.provenance.source,
      tier: estimate.provenance.tier,
      exposureSwap: swap,
    };
  };

  const travelMinutes = (from: LatLng | null, to: LatLng | null): number =>
    priceLeg(from, to)?.minutes ?? 0;

  /** The mode a slot records as its arrival, exposure-aware. */
  const arriveByFor = (from: LatLng | null, to: LatLng | null): TransportMode =>
    priceLeg(from, to)?.mode ??
    modeFor(from && to ? haversineKm(from, to) : 0, request.transport);

  /**
   * LODGING IS A PLACE (XXX-42, Session 14 CP1 §1.6).
   *
   * One mechanism serving four requirements that would otherwise need four:
   *
   *   - the first leg `lodging → stop 1` becomes a REAL recorded leg. It was
   *     priced and thrown away, because `recordLeg` needs a `prevPlaceId` and
   *     lodging had none — so the day's first movement, often its longest,
   *     was invisible on the timeline;
   *   - the return leg is priced against `dayEnd`;
   *   - a REST STOP has somewhere to be: `slots.place_id` is NOT NULL, and a
   *     rest at the hotel is a slot at a place;
   *   - honest absence stays honest — no lodging, no pseudo-place, and every
   *     behaviour below is exactly what it was.
   */
  const lodging = request.lodging ?? null;
  const LODGING_PLACE_ID = "lodging";
  if (lodging !== null) {
    places[LODGING_PLACE_ID] = {
      id: LODGING_PLACE_ID,
      name: "your hotel",
      neighborhood: "",
      coords: lodging,
      tags: { outdoor: false, goldenHourAffine: false, highCrowd: false },
    };
  }

  const legs: ComposedLeg[] = [];
  let prevPlaceId: string | null = lodging === null ? null : LODGING_PLACE_ID;
  /** Why a rest stop was dealt, or null. Never silent — it has a reason. */
  let restReason: ComposedDay["restReason"] = null;
  const recordLeg = (toCoords: LatLng | null, toPlaceId: string): void => {
    const leg = prevPlaceId === null ? null : priceLeg(prevCoords, toCoords);
    if (leg !== null && prevPlaceId !== null) {
      legs.push({ fromPlaceId: prevPlaceId, toPlaceId, ...leg });
    }
    prevPlaceId = toPlaceId;
  };

  const snap5 = (m: number): number => Math.ceil(m / 5) * 5;

  for (const item of items) {
    if (item.kind === "anchor") {
      const anchor = item.anchor!;
      const start = timeToMinutes(anchor.startTime);
      const end = timeToMinutes(anchor.endTime);
      // Reachability: shrink or drop the previous concierge slot until
      // the buffered arrival holds (negative-space discipline).
      for (;;) {
        const t = travelMinutes(prevCoords, anchor.coords);
        if (cursor + t <= start - params.anchors.arrivalBufferMinutes) break;
        const last = slots[slots.length - 1];
        if (last === undefined || last.origin === "user") break; // validator's call now
        const lastPlace = places[last.placeId];
        const lastCategory =
          lastPlace.category?.status === "present"
            ? lastPlace.category.value
            : null;
        const minDwell =
          lastCategory !== null ? params.dwellMinutes[lastCategory].min : 30;
        const lastSpan = timeToMinutes(last.endTime) - timeToMinutes(last.startTime);
        if (lastSpan > minDwell) {
          last.endTime = minutesToTime(timeToMinutes(last.startTime) + minDwell);
          cursor = timeToMinutes(last.endTime);
        } else {
          slots.pop();
          delete places[last.placeId];
          // The leg that was priced INTO the dropped slot goes with it —
          // a leg to a stop that is no longer in the day is not a fact.
          if (legs.length > 0 && legs[legs.length - 1].toPlaceId === last.placeId) {
            legs.pop();
          }
          cursor = slots.length > 0 ? timeToMinutes(slots[slots.length - 1].endTime) : skeleton.daySpan.start;
          const previous = slots.length > 0 ? slots[slots.length - 1] : null;
          prevCoords = previous ? (places[previous.placeId]?.coords ?? null) : (request.lodging ?? null);
          prevPlaceId = previous ? previous.placeId : null;
        }
      }
      anchorCount++;
      const placeId = `anchor-${anchorCount}`;
      places[placeId] = {
        id: placeId,
        name: anchor.label,
        neighborhood: "",
        coords: anchor.coords,
        tags: {
          outdoor: false,
          goldenHourAffine: false,
          highCrowd: anchor.highCrowd ?? false,
        },
      };
      const slotId = `s-anchor-${anchorCount}`;
      const arriveBy = arriveByFor(prevCoords, anchor.coords);
      recordLeg(anchor.coords, placeId);
      slots.push({
        id: slotId,
        origin: "user",
        kind: "activity",
        startTime: anchor.startTime,
        endTime: anchor.endTime,
        placeId,
        arriveBy,
      });
      anchorBaseline[slotId] = {
        startTime: anchor.startTime,
        endTime: anchor.endTime,
        placeId,
      };
      cursor =
        end + (anchor.highCrowd ? params.anchors.crowdEgressBufferMinutes : 0);
      prevCoords = anchor.coords;
      prevNeighborhood = null;
      continue;
    }

    const intent = item.intent!;

    /**
     * Where a candidate could sit, and how good that seat is.
     *
     * The legal start minutes are enumerated on the objective's grid and
     * scored; the old composer took the first one. `null` = it cannot sit
     * at all.
     */
    const trySeat = (
      candidate: Candidate,
    ): { start: number; dwell: number; travel: number; cost: number } | null => {
      const place = candidate.place;
      const t = travelMinutes(prevCoords, place.coords);
      const arrival = cursor + t;
      let window = intent.window;
      if (place.tags.outdoor && input.outdoorLatestEnd !== null) {
        window = { ...window, end: Math.min(window.end, input.outdoorLatestEnd) };
      }
      const wanted =
        place.category?.status === "present"
          ? clampDwell(intent.dwellMinutes, params.dwellMinutes[place.category.value])
          : intent.dwellMinutes;
      const minDwell =
        place.category?.status === "present"
          ? params.dwellMinutes[place.category.value].min
          : 30;
      const earliest = snap5(Math.max(arrival, window.start));
      const latestEnd = Math.min(window.end, skeleton.daySpan.end);
      // Hours unknown covers BOTH never-fetched and fetched-but-absent
      // (openIntervalsOn is null for either): honest absence seats by
      // window alone and the validator reports it — treating absence as
      // unschedulable was the first live run's silent-thin-day bug.
      const hoursKnown = openIntervalsOn(place.hours, weekday) !== null;

      /** Legal start minutes on the grid, in ascending order. */
      const legalStarts = (dwell: number): number[] => {
        const out: number[] = [];
        let from = earliest;
        for (let guard = 0; guard < 288; guard += 1) {
          const next = hoursKnown
            ? earliestVisitStart(place.hours, weekday, from, latestEnd, dwell)
            : from + dwell <= latestEnd
              ? from
              : null;
          if (next === null) break;
          const snapped = snap5(next);
          if (snapped + dwell > latestEnd) break;
          if (out[out.length - 1] !== snapped) out.push(snapped);
          from = snapped + seating.gridMinutes;
          if (from + dwell > latestEnd) break;
        }
        return out;
      };

      for (const dwell of wanted === minDwell ? [wanted] : [wanted, minDwell]) {
        const starts = legalStarts(dwell);
        if (starts.length === 0) continue;
        if (input.seatingLegacyEarliest === true) {
          return { start: starts[0], dwell, travel: t, cost: 0 };
        }
        let best = starts[0];
        let bestCost = Number.POSITIVE_INFINITY;
        for (const start of starts) {
          const cost = seatCost({
            start,
            dwell,
            arrival,
            window,
            latestEnd,
          });
          // Strictly less: ties go to the earlier minute, so the
          // objective stays deterministic.
          if (cost < bestCost) {
            bestCost = cost;
            best = start;
          }
        }
        return { start: best, dwell, travel: t, cost: bestCost };
      }
      return null;
    };

    // The selected venue first; the menu's alternates only if it cannot
    // seat. Venues selected for other intents are reserved.
    const reserved = new Set(chosen.values());
    const placed = new Set(Object.keys(places));
    const order: string[] = [
      chosen.get(intent.id)!,
      ...(input.alternates?.get(intent.id) ?? []).filter(
        (id) => id !== chosen.get(intent.id) && !reserved.has(id) && !placed.has(id),
      ),
    ];
    let seated = false;
    for (const placeId of order) {
      const candidate = candidatesById.get(placeId);
      if (candidate === undefined || placed.has(candidate.place.id)) continue;
      const seat = trySeat(candidate);
      if (seat === null) continue;
      const place = candidate.place;
      // Free time the arc placed BEFORE this stop is now a real interval:
      // the cursor was advanced deliberately, so the gap is a choice with
      // a location rather than whatever the arithmetic left over.
      if (
        pendingOpen !== null &&
        pendingOpen.start < seat.start &&
        prevNeighborhood !== null
      ) {
        openPeriods.push({
          id: pendingOpen.id,
          startTime: minutesToTime(pendingOpen.start),
          endTime: minutesToTime(Math.min(seat.start, pendingOpen.end)),
          locality: prevNeighborhood,
          reason: pendingOpen.reason,
          placed: true,
        });
      }
      pendingOpen = null;
      places[place.id] = place;
      const arriveBy = arriveByFor(prevCoords, place.coords);
      recordLeg(place.coords, place.id);
      slots.push({
        id: `s-${intent.id}`,
        origin: "concierge",
        kind: intent.kind,
        startTime: minutesToTime(seat.start),
        endTime: minutesToTime(seat.start + seat.dwell),
        placeId: place.id,
        arriveBy,
        ...(intent.role === undefined ? {} : { role: intent.role }),
        // The composite bound travels with the SLOT, because the validator
        // reads slots and must know which owner bounded this dwell.
        ...(intent.composite === undefined
          ? {}
          : { compositeDwell: intent.composite }),
      });
      cursor = seat.start + seat.dwell;
      prevCoords = place.coords;
      prevNeighborhood = place.neighborhood === "" ? null : place.neighborhood;
      seated = true;

      // Reserve the arc's free time by moving the cursor: the next stop is
      // pushed later ON PURPOSE. This is what "placed, not residue" means.
      const open = openAfter.get(intent.id);
      if (open !== undefined && open.minutes > 0) {
        const anchorSeated = slots.some((s) => s.role === "anchor");
        pendingOpen = {
          id: open.id,
          start: cursor,
          end: cursor + open.minutes,
          reason: anchorSeated ? "after the anchor" : "before the anchor",
        };
        cursor += open.minutes;
      }
      break;
    }
    if (!seated) unfilled.push(intent.id);
  }

  // --- name every gap the day actually has -------------------------------
  //
  // CP2 finding, and the fix for it. Reserved periods alone were not enough:
  // only four of ten templates carry an `open` step, so days built from the
  // other six still handed the founder an unexplained hole — the A/B measured
  // 135 minutes of it, WORSE than the 133 they complained about. And their
  // complaint was never that free time exists ("too much free time; that too
  // in the middle of nowhere") — it was that it had no location and no
  // reason. So any gap worth noticing becomes a located, named period.
  // `placed: false` keeps it honest about which ones the arc chose.
  const ordered = [...slots].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );
  const anchorAt = ordered.findIndex((s) => s.role === "anchor");
  for (let i = 1; i < ordered.length; i += 1) {
    const gapStart = timeToMinutes(ordered[i - 1].endTime);
    const gapEnd = timeToMinutes(ordered[i].startTime);
    if (gapEnd - gapStart < OPEN_PERIOD_NOTICEABLE_MINUTES) continue;
    if (
      openPeriods.some(
        (p) =>
          timeToMinutes(p.startTime) < gapEnd &&
          gapStart < timeToMinutes(p.endTime),
      )
    ) {
      continue; // the arc already named this stretch
    }
    const locality = places[ordered[i - 1].placeId]?.neighborhood ?? "";
    openPeriods.push({
      id: `g${i}`,
      startTime: minutesToTime(gapStart),
      endTime: minutesToTime(gapEnd),
      // An unlocatable gap is exactly the "middle of nowhere" complaint, so
      // it says so rather than inventing a neighbourhood.
      locality: locality === "" ? "no fixed place" : locality,
      reason:
        anchorAt >= 0 && i - 1 < anchorAt
          ? "before the anchor"
          : gapStart >= timeToMinutes("17:00")
            ? "evening drift"
            : "after the anchor",
      placed: false,
    });
  }
  openPeriods.sort((a, b) => a.startTime.localeCompare(b.startTime));

  /**
   * THE REST STOP (XXX-42, Session 14 CP1 §1.6).
   *
   * Dealt as a POST-PASS rather than as a skeleton step, and that is forced
   * by what the trigger reads: physical load is accumulated TRAVEL time, which
   * does not exist until the day has been seated. A skeleton-time rest stop
   * would have to guess at the thing it is reacting to.
   *
   * Two triggers, either sufficient:
   *
   *   (a) PHYSICAL LOAD — walking plus commute minutes since the day began
   *       crosses `physicalLoadMinutes`. Travel time, not elapsed time: two
   *       hours in a gallery is not load.
   *   (b) EVENT PREP — the next stop is the fancy-dinner class, defined as
   *       three facts rather than a vibe (restaurants · at or after 19:00 ·
   *       priced in the top band the budget admits).
   *
   * It needs a real gap to sit in, so it never displaces a stop — a rest that
   * pushes dinner later is not a rest. And it needs LODGING: without it there
   * is nowhere to rest and `structure.reset-gap-without-lodging` keeps saying
   * so, which is the Session 11 advisory this upgrades rather than replaces.
   */
  if (lodging !== null) {
    const restParams = COMPOSE_PARAMS.rest;
    const ordered2 = [...slots].sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    );
    /**
     * Load is measured over the WHOLE DAY, not accumulated to the gap.
     *
     * The first build accumulated leg by leg and asked "has this traveller
     * walked enough YET". Measured across all eight exam personas with real
     * pool venues, that fired **zero** times — and the reason is structural
     * rather than a threshold being wrong. Load accumulates through the day
     * while the big gaps sit EARLY: `day-2-old-town` totals 175 travel
     * minutes with a 100-minute gap, but the gap is before the anchor when
     * only one leg has been walked, and by the time the threshold is crossed
     * the remaining gaps are 35 minutes.
     *
     * A concierge planning a day is not reacting to fatigue as it arrives; it
     * is looking at a day that totals three and a half hours of moving and
     * putting a reset before the evening. So the day's total decides WHETHER,
     * and the afternoon decides WHERE — which is also the shape of the
     * founder's own example, golden Day 2's 17:00–19:00 hotel reset.
     */
    const dayLoad = legs.reduce((total, leg) => total + leg.minutes, 0);
    const loaded = dayLoad >= restParams.physicalLoadMinutes;
    let restPlaced = false;
    // Latest suitable gap first: a reset belongs next to the evening it is
    // preparing for, not at the first hole of the afternoon.
    for (let i = ordered2.length - 2; i >= 0 && !restPlaced; i -= 1) {
      const gapStart = timeToMinutes(ordered2[i].endTime);
      const gapEnd = timeToMinutes(ordered2[i + 1].startTime);
      if (gapEnd - gapStart < restParams.dwellMinutes) continue;

      const next = ordered2[i + 1];
      const nextPlace = places[next.placeId];
      const nextCategory =
        nextPlace?.category?.status === "present"
          ? nextPlace.category.value
          : null;
      const nextPrice =
        nextPlace?.priceRange?.status === "present"
          ? nextPlace.priceRange.value
          : null;
      const budgetCeiling = request.budgetBand?.max ?? null;
      const eventPrep =
        nextCategory === "restaurants" &&
        next.startTime >= restParams.eventPrepFromHour &&
        budgetCeiling !== null &&
        nextPrice !== null &&
        (nextPrice.min + nextPrice.max) / 2 >=
          budgetCeiling * restParams.eventPrepBudgetShare;

      // Physical load also needs the gap to be in the afternoon; event-prep
      // does not, because it is anchored to the dinner it precedes.
      const loadFits =
        loaded && ordered2[i].endTime >= restParams.fromHour;
      if (!loadFits && !eventPrep) continue;

      const start = gapStart;
      const end = Math.min(gapEnd, start + restParams.dwellMinutes);
      slots.push({
        id: "s-rest",
        origin: "concierge",
        kind: "activity",
        startTime: minutesToTime(start),
        endTime: minutesToTime(end),
        placeId: LODGING_PLACE_ID,
        arriveBy: arriveByFor(
          places[ordered2[i].placeId]?.coords ?? null,
          lodging,
        ),
        role: "rest",
      });
      restReason = loadFits
        ? {
            trigger: "physical-load",
            loadMinutes: dayLoad,
            thresholdMinutes: restParams.physicalLoadMinutes,
          }
        : { trigger: "event-prep", beforeSlotId: next.id };
      restPlaced = true;
      // The gap is now a stop, so it must stop being narrated as free time.
      for (let p = openPeriods.length - 1; p >= 0; p -= 1) {
        const period = openPeriods[p];
        if (
          timeToMinutes(period.startTime) < end &&
          start < timeToMinutes(period.endTime)
        ) {
          openPeriods.splice(p, 1);
        }
      }
    }
  }

  const day: GrammarDay = {
    id: `gen-${request.date}`,
    city: request.city,
    date: request.date,
    archetype: "city",
    dayStart: minutesToTime(skeleton.daySpan.start),
    dayEnd: minutesToTime(skeleton.daySpan.end),
    slots,
    places,
  };
  return {
    day,
    anchorBaseline:
      Object.keys(anchorBaseline).length > 0 ? anchorBaseline : null,
    unfilled,
    legs,
    openPeriods,
    restReason,
  };
}

/**
 * The seat-choice objective (XXX-35 §1.2, COMPOSE_PARAMS v1).
 *
 * Three terms, and the tension between the first two IS the design: the
 * founder complained both that lunch sat on the window's opening edge AND
 * that 2h13 was wasted mid-day. Centering alone fixes the first and causes
 * the second, so the idle term prices waiting.
 */
export function seatCost(input: {
  start: number;
  dwell: number;
  arrival: number;
  window: Span;
  latestEnd: number;
}): number {
  const p = COMPOSE_PARAMS.seating;
  const { start, dwell, arrival, window } = input;
  const windowCenter = (window.start + window.end) / 2;
  const half = Math.max(1, (window.end - window.start) / 2);
  const centerDeviation = Math.min(
    1,
    Math.abs(start + dwell / 2 - windowCenter) / half,
  );
  const idleBefore = Math.min(
    1,
    Math.max(0, start - arrival) / p.idleNormalizerMinutes,
  );
  const tailPressure = Math.min(
    1,
    Math.max(0, start + dwell - (input.latestEnd - p.tailReserveMinutes)) /
      p.tailNormalizerMinutes,
  );
  return (
    p.wCenter * centerDeviation +
    p.wIdle * idleBefore +
    p.wTail * tailPressure
  );
}

function clampDwell(
  wanted: number,
  range: { min: number; max: number },
): number {
  return Math.min(Math.max(wanted, range.min), range.max);
}
