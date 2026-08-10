/**
 * Composition (CP1 §1.1 stage 7): the code-owned structure layer. The
 * skeleton decides what kinds of slots the day wants; the scheduler
 * turns selections into a timed `GrammarDay` against meal-pattern
 * windows, pinned anchors (XXX-27: fill the negative space), hours
 * predicates, and the travel chain. The LLM owns none of this.
 *
 * The composer is deliberately conservative, not clever: it avoids the
 * violations it can see coming (hours, pattern windows, anchor buffers,
 * daylight for outdoor slots) and lets `validateDay` catch the rest —
 * the grammar loop, not the composer, is the guarantee.
 */

import {
  earliestVisitStart,
  openIntervalsOn,
  type Span,
} from "@/shared/day-grammar/predicates";
import { GRAMMAR_PARAMS } from "@/shared/day-grammar/params";
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
import { categoryAffinity, type Persona } from "@/shared/persona";
import { minutesToTime, timeToMinutes } from "@/shared/time";
import {
  PLACE_CATEGORIES,
  weekdayOf,
  type PlaceCategory,
  type TransportMode,
} from "@/shared/vocabulary";
import type {
  AnchorInput,
  Candidate,
  ComposedLeg,
  GenerationRequest,
  Selection,
  SlotIntent,
} from "./types";
export type { ComposedLeg } from "./types";

/** Variety within a day is code-enforced (10294 point 4). */
export const MAX_SLOTS_PER_CATEGORY = 2;

const ACTIVITY_COUNT: Record<Persona["pace"], number> = {
  relaxed: 2,
  moderate: 3,
  packed: 4,
};

const DEFAULT_DAY: Record<Persona["pace"], { start: string; end: string }> = {
  relaxed: { start: "09:30", end: "21:00" },
  moderate: { start: "09:00", end: "21:30" },
  packed: { start: "08:30", end: "22:00" },
};

/** Meal dwell judgments (minutes) — inside the category min/max bands. */
const MEAL_DWELL: Record<string, number> = {
  breakfast: 45,
  coffee: 45,
  brunch: 75,
  lunch: 60,
  dinner: 90,
  grazing: 45,
};

const MEAL_CATEGORIES: Record<string, PlaceCategory[]> = {
  breakfast: ["cafes", "restaurants"],
  coffee: ["cafes"],
  brunch: ["restaurants", "cafes"],
  lunch: ["restaurants"],
  dinner: ["restaurants"],
  grazing: ["markets", "cafes", "restaurants"],
};

export function defaultMealPattern(persona: Persona): MealPatternId {
  return persona.structure === "wanderer" ? "coffee_then_brunch" : "classic";
}

/** Activity categories in persona-gravity order, food categories excluded. */
export function rankedActivityCategories(persona: Persona): PlaceCategory[] {
  return PLACE_CATEGORIES.filter(
    (c) => c !== "restaurants" && c !== "cafes",
  ).sort(
    (a, b) =>
      categoryAffinity(persona, b) - categoryAffinity(persona, a) ||
      a.localeCompare(b),
  );
}

export interface Skeleton {
  intents: SlotIntent[];
  daySpan: Span;
  mealPattern: MealPatternId;
}

/**
 * What the day wants, before any venue exists. Scheduler personas get a
 * full timeline; wanderers get three anchors and their negative space —
 * the unstructured fraction IS the shape (rule 27 guards it).
 */
export function buildSkeleton(request: GenerationRequest): Skeleton {
  const persona = request.persona;
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
  const intents: SlotIntent[] = [];
  let nextId = 1;
  const intent = (
    kind: SlotIntent["kind"],
    label: string,
    window: Span,
    categories: PlaceCategory[],
    dwellMinutes: number,
  ): SlotIntent => ({
    id: `i${nextId++}`,
    kind,
    label,
    window,
    categories,
    dwellMinutes,
  });

  if (persona.structure === "wanderer") {
    // Three anchors + zones. The gaps are deliberately unowned.
    const top = rankedActivityCategories(persona)[0];
    intents.push(
      intent("meal", "brunch", spanClip({ start: 600, end: 720 }, daySpan), MEAL_CATEGORIES.brunch, 90),
      intent("activity", "afternoon anchor", spanClip({ start: 850, end: 990 }, daySpan), [top], 90),
      intent(
        "meal",
        "evening anchor",
        spanClip({ start: 1170, end: 1290 }, daySpan),
        categoryAffinity(persona, "nightlife_bars") >= 0.5
          ? ["nightlife_bars", "restaurants"]
          : ["restaurants", "nightlife_bars"],
        120,
      ),
    );
    return { intents: intents.filter((i) => spanMinutes(i.window) >= i.dwellMinutes), daySpan, mealPattern };
  }

  // Meals from the pattern's windows, clipped to the day.
  const mealIntents: SlotIntent[] = [];
  for (const window of pattern.windows) {
    const clipped = spanClip(
      { start: timeToMinutes(window.open), end: timeToMinutes(window.close) },
      daySpan,
    );
    const dwell = MEAL_DWELL[window.label] ?? 60;
    if (spanMinutes(clipped) < dwell) continue;
    mealIntents.push(
      intent(
        "meal",
        window.label,
        clipped,
        MEAL_CATEGORIES[window.label] ?? ["restaurants"],
        dwell,
      ),
    );
  }

  // Activities fill the gaps between meals, persona-gravity categories,
  // max two slots per category across the day.
  const ranked = rankedActivityCategories(persona);
  const categoryUse = new Map<PlaceCategory, number>();
  /**
   * Evening activity slots draw only from categories plausibly open at
   * night — museums and markets at 19:30 are exactly the unverified-junk
   * trap the first live run walked into (CP2 finding): every verified
   * venue is filtered by its real hours and only unknowns survive.
   */
  const EVENING_OK: PlaceCategory[] = ["nightlife_bars", "historic_sites"];
  const takeCategory = (evening: boolean): PlaceCategory => {
    const pool = evening ? ranked.filter((c) => EVENING_OK.includes(c)) : ranked;
    for (const c of pool) {
      if ((categoryUse.get(c) ?? 0) < MAX_SLOTS_PER_CATEGORY) {
        categoryUse.set(c, (categoryUse.get(c) ?? 0) + 1);
        return c;
      }
    }
    return pool[0] ?? ranked[0];
  };

  const gaps: { label: string; window: Span }[] = [];
  const sortedMeals = [...mealIntents].sort((a, b) => a.window.start - b.window.start);
  let cursor = daySpan.start;
  for (const meal of sortedMeals) {
    if (meal.window.start - cursor >= 60) {
      gaps.push({
        label: labelForGap(cursor),
        window: { start: cursor, end: meal.window.start + 30 },
      });
    }
    cursor = Math.max(cursor, meal.window.start + (MEAL_DWELL[meal.label] ?? 60));
  }
  if (daySpan.end - cursor >= 60) {
    gaps.push({ label: labelForGap(cursor), window: { start: cursor, end: daySpan.end } });
  }

  const activityCount = ACTIVITY_COUNT[persona.pace];
  const activities: SlotIntent[] = [];
  let gi = 0;
  while (activities.length < activityCount && gaps.length > 0) {
    const gap = gaps[gi % gaps.length];
    const category = takeCategory(gap.window.start >= timeToMinutes("19:00"));
    activities.push(
      intent(
        "activity",
        `${gap.label} activity`,
        gap.window,
        [category],
        GRAMMAR_PARAMS.dwellMinutes[category].typical,
      ),
    );
    gi++;
    if (gi > gaps.length * 3) break; // safety: never loop forever
  }

  // Evening nightlife when the persona actually wants it and the day
  // is still awake for it.
  if (
    daySpan.end >= timeToMinutes("21:30") &&
    categoryAffinity(persona, "nightlife_bars") >= 0.35 &&
    (categoryUse.get("nightlife_bars") ?? 0) === 0
  ) {
    activities.push(
      intent(
        "activity",
        "evening",
        { start: timeToMinutes("20:30"), end: daySpan.end },
        ["nightlife_bars"],
        90,
      ),
    );
  }

  const all = [...mealIntents, ...activities].sort(
    (a, b) => a.window.start - b.window.start || a.id.localeCompare(b.id),
  );
  return { intents: all, daySpan, mealPattern };
}

const spanMinutes = (s: Span): number => Math.max(0, s.end - s.start);
const spanClip = (s: Span, outer: Span): Span => ({
  start: Math.max(s.start, outer.start),
  end: Math.min(s.end, outer.end),
});
const labelForGap = (startMinutes: number): string =>
  startMinutes < 720 ? "morning" : startMinutes < 1020 ? "afternoon" : "evening";

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
   * Menu order per intent (placeIds). When the SELECTED venue cannot be
   * seated — the cursor ate its window, its verified hours refuse — the
   * scheduler tries these in order rather than dropping the intent. The
   * selector's choice is honored whenever it seats; alternates are the
   * same legal menu, so no venue enters the day that selection could not
   * have offered. Venues chosen for other intents are never stolen.
   */
  alternates?: Map<string, string[]>;
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
}

/**
 * Deterministic greedy scheduler. Anchors are immovable; concierge slots
 * flow around them in time order, each placed at the earliest legal
 * minute after travel, snapped to a 5-minute grid (snapping only ever
 * adds slack — buffers price friction, the grid is cosmetic).
 */
export function composeDay(input: ComposeInput): ComposedDay {
  const { request, skeleton, selections, candidatesById, travel } = input;
  const weekday = weekdayOf(request.date);
  const params = GRAMMAR_PARAMS;
  const chosen = new Map(selections.map((s) => [s.intentId, s.placeId]));

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
  let cursor = skeleton.daySpan.start;
  let prevCoords: LatLng | null = request.lodging ?? null;
  let anchorCount = 0;

  /**
   * The priced leg between two points, or null when there is nothing to
   * price (same spot, missing coordinates) or no estimate is obtainable.
   * null is honest absence and costs zero minutes — never a guessed number.
   */
  const travelLeg = (
    from: LatLng | null,
    to: LatLng | null,
  ): { minutes: number; mode: TransportMode; source: string; tier: 1 | 2 | 3 } | null => {
    if (from === null || to === null) return null;
    const km = haversineKm(from, to);
    if (km <= params.travel.negligibleDistanceKm) return null;
    const mode = modeFor(km, request.transport);
    const estimate = travel.estimate({
      origin: from,
      destination: to,
      mode,
      departureLocal: minutesToTime(Math.min(cursor, 1439)),
    });
    if (estimate === null) return null;
    return {
      minutes: Math.ceil(estimate.minutes) + (input.slackMinutes ?? 0),
      mode,
      source: estimate.provenance.source,
      tier: estimate.provenance.tier,
    };
  };

  const travelMinutes = (from: LatLng | null, to: LatLng | null): number =>
    travelLeg(from, to)?.minutes ?? 0;

  const legs: ComposedLeg[] = [];
  let prevPlaceId: string | null = null;
  const recordLeg = (toCoords: LatLng | null, toPlaceId: string): void => {
    const leg = prevPlaceId === null ? null : travelLeg(prevCoords, toCoords);
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
      recordLeg(anchor.coords, placeId);
      slots.push({
        id: slotId,
        origin: "user",
        kind: "activity",
        startTime: anchor.startTime,
        endTime: anchor.endTime,
        placeId,
        arriveBy: modeFor(
          prevCoords ? haversineKm(prevCoords, anchor.coords) : 0,
          request.transport,
        ),
      });
      anchorBaseline[slotId] = {
        startTime: anchor.startTime,
        endTime: anchor.endTime,
        placeId,
      };
      cursor =
        end + (anchor.highCrowd ? params.anchors.crowdEgressBufferMinutes : 0);
      prevCoords = anchor.coords;
      continue;
    }

    const intent = item.intent!;

    /** Where a candidate could sit given the cursor, or null. */
    const trySeat = (
      candidate: Candidate,
    ): { start: number; dwell: number; travel: number } | null => {
      const place = candidate.place;
      const t = travelMinutes(prevCoords, place.coords);
      const arrival = cursor + t;
      let window = intent.window;
      if (place.tags.outdoor && input.outdoorLatestEnd !== null) {
        window = { ...window, end: Math.min(window.end, input.outdoorLatestEnd) };
      }
      let dwell =
        place.category?.status === "present"
          ? clampDwell(intent.dwellMinutes, params.dwellMinutes[place.category.value])
          : intent.dwellMinutes;
      const earliest = snap5(Math.max(arrival, window.start));
      const latestEnd = Math.min(window.end, skeleton.daySpan.end);
      // Hours unknown covers BOTH never-fetched and fetched-but-absent
      // (openIntervalsOn is null for either): honest absence seats by
      // window alone and the validator reports it — treating absence as
      // unschedulable was the first live run's silent-thin-day bug.
      const hoursKnown = openIntervalsOn(place.hours, weekday) !== null;
      let start = hoursKnown
        ? earliestVisitStart(place.hours, weekday, earliest, latestEnd, dwell)
        : earliest + dwell <= latestEnd
          ? earliest
          : null;
      if (start === null) {
        // The shortest worthwhile visit before giving up.
        const minDwell =
          place.category?.status === "present"
            ? params.dwellMinutes[place.category.value].min
            : 30;
        start = hoursKnown
          ? earliestVisitStart(place.hours, weekday, earliest, latestEnd, minDwell)
          : earliest + minDwell <= latestEnd
            ? earliest
            : null;
        dwell = minDwell;
      }
      if (start === null) return null;
      start = snap5(start);
      if (start + dwell > latestEnd) return null;
      return { start, dwell, travel: t };
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
      places[place.id] = place;
      recordLeg(place.coords, place.id);
      slots.push({
        id: `s-${intent.id}`,
        origin: "concierge",
        kind: intent.kind,
        startTime: minutesToTime(seat.start),
        endTime: minutesToTime(seat.start + seat.dwell),
        placeId: place.id,
        arriveBy: modeFor(
          prevCoords && place.coords ? haversineKm(prevCoords, place.coords) : 0,
          request.transport,
        ),
      });
      cursor = seat.start + seat.dwell;
      prevCoords = place.coords;
      seated = true;
      break;
    }
    if (!seated) unfilled.push(intent.id);
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
  };
}

function clampDwell(
  wanted: number,
  range: { min: number; max: number },
): number {
  return Math.min(Math.max(wanted, range.min), range.max);
}
