/**
 * Day-grammar vocabulary (XXX-5, epic layer 2).
 *
 * The validator's input types. These are DOMAIN shapes, deliberately not
 * the E2 view model in ../timeline.ts: that one carries no coordinates, no
 * per-weekday hours, no categories and no outdoor tag, and bending a view
 * model into a domain model would be the wrong repair. Both are built from
 * the same E1 constant sets in ../vocabulary.ts, so the words agree.
 *
 * Honest absence is three-valued throughout, exactly as the domain stores
 * it: `undefined` = never fetched (no fact row at all), `{status:
 * "absent"}` = we looked and it is not published, `{status: "present"}` =
 * a value. Provenance rides on every fact including fixtures — constraint
 * 2 admits no exception for fixture data.
 */

import type { DaylightTimes, SchedulingWindows } from "../scheduling-windows";
import type { PriceRange } from "../timeline";
import type {
  PlaceCategory,
  SlotKind,
  SlotOrigin,
  Tier,
  TransportMode,
  Weekday,
} from "../vocabulary";
import type { City } from "../vocabulary";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Provenance {
  source: string;
  tier: Tier;
  fetchedAt: string;
}

/** Present-with-value or looked-and-absent; never-fetched is `undefined`. */
export type GrammarFact<T> =
  | ({ status: "present"; value: T } & Provenance)
  | ({ status: "absent" } & Provenance);

// ---------------------------------------------------------------------------
// Fact value shapes
// ---------------------------------------------------------------------------

/** "HH:MM" open/close pair; `close` may be "24:00" for a midnight close. */
export interface OpenInterval {
  open: string;
  close: string;
}

/** Empty array = closed that weekday. Trap class 2 lives or dies here. */
export type HoursByWeekday = Record<Weekday, OpenInterval[]>;

export const BUSINESS_STATUSES = [
  "operational",
  "closed_temporarily",
  "closed_permanently",
] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export const RESERVABILITIES = ["accepts", "required", "walk_in_only"] as const;
export type Reservability = (typeof RESERVABILITIES)[number];

/** Inclusive calendar range, "YYYY-MM-DD". Trap class 4. */
export interface SeasonalRange {
  startDate: string;
  endDate: string;
}

/**
 * A date-math offering rule — "free admission, first Wednesday evening"
 * (trap class 3). Distinct from hours: hours say when the door is open,
 * this says when a particular offering is available behind it.
 */
export interface RecurringOffering {
  label: string;
  kind: "nth-weekday-of-month";
  weekday: Weekday;
  /** 1 = first occurrence of that weekday in the month. */
  ordinal: number;
  window: OpenInterval;
}

/**
 * Tier-3 tags the daylight, weather and crowd rules read. Booleans rather
 * than a discriminated union because they are independent properties of a
 * place, not alternative states of one.
 */
export interface PlaceTags {
  /** The experience is outdoors — daylight and weather windows bind. */
  outdoor: boolean;
  /** Worth seeing in golden light; drives an advisory only. */
  goldenHourAffine: boolean;
  /** Stadiums, arenas, major events — drives the egress buffer. */
  highCrowd: boolean;
}

export const NO_TAGS: PlaceTags = {
  outdoor: false,
  goldenHourAffine: false,
  highCrowd: false,
};

export interface GrammarPlace {
  id: string;
  name: string;
  neighborhood: string;
  /** null = no coordinates; travel across this place cannot be certified. */
  coords: LatLng | null;
  tags: PlaceTags;
  category?: GrammarFact<PlaceCategory>;
  hours?: GrammarFact<HoursByWeekday>;
  businessStatus?: GrammarFact<BusinessStatus>;
  seasonal?: GrammarFact<SeasonalRange>;
  priceRange?: GrammarFact<PriceRange>;
  reservability?: GrammarFact<Reservability>;
  offerings?: GrammarFact<RecurringOffering[]>;
}

export interface GrammarSlot {
  id: string;
  origin: SlotOrigin;
  kind: SlotKind;
  /** City-local "HH:MM". */
  startTime: string;
  endTime: string;
  placeId: string;
  /** How the traveller reaches this slot from the previous one. */
  arriveBy: TransportMode;
  /**
   * Names an offering this slot depends on (Day 3's free-admission AGO).
   * Matched against the place's `offerings` by label.
   */
  requiresOffering?: string;
}

export const DAY_ARCHETYPES = ["city", "excursion"] as const;
/**
 * `excursion` carries no rules this session (XXX-28 is out of scope). It
 * exists so excursion days can be represented and so XXX-28's corridor
 * rules have somewhere to attach without reshaping the day.
 */
export type DayArchetype = (typeof DAY_ARCHETYPES)[number];

export interface GrammarDay {
  id: string;
  city: City;
  /** "YYYY-MM-DD" city-local calendar date. */
  date: string;
  archetype: DayArchetype;
  /** When the traveller starts and is home — the span pacing measures against. */
  dayStart: string;
  dayEnd: string;
  slots: GrammarSlot[];
  places: Record<string, GrammarPlace>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const MEAL_PATTERNS = ["classic", "coffee_then_brunch", "grazing"] as const;
export type MealPatternId = (typeof MEAL_PATTERNS)[number];

export const PERSONA_STRUCTURES = ["scheduler", "wanderer"] as const;
export type PersonaStructure = (typeof PERSONA_STRUCTURES)[number];

/** The user's own commitment, as they entered it. Rule 23 compares to this. */
export interface AnchorBaseline {
  startTime: string;
  endTime: string;
  placeId: string;
}

export interface TravelQuery {
  origin: LatLng;
  destination: LatLng;
  mode: TransportMode;
  /** City-local "HH:MM" — time-of-day bucketing is XXX-24's to use. */
  departureLocal: string;
}

export interface TravelEstimate {
  minutes: number;
  provenance: { source: string; tier: Tier };
}

/**
 * Travel times, as the validator sees them.
 *
 * Synchronous on purpose. The validator must stay pure and sync so E5 can
 * run it in the browser for optimistic edit feedback, which means it can
 * never await. XXX-24's provider is networked and async, so it does not
 * implement this interface directly: context assembly pre-fetches the
 * day's pairs and hands the validator a matrix-backed provider that reads
 * them synchronously. The validator does not change when that lands.
 *
 * `null` is honest absence — no estimate obtainable, never a zero.
 */
export interface TravelTimeProvider {
  estimate(query: TravelQuery): TravelEstimate | null;
}

import type { GrammarParams } from "./params";

/**
 * Everything the validator needs that is not the day itself. Every
 * nullable field is a thing we may genuinely not know; each has a named
 * advisory so the absence is reported rather than assumed away.
 */
export interface GrammarContext {
  /** Computed ephemeris (Tier 1). null = not computed for this date. */
  daylight: DaylightTimes | null;
  /** Session 6's derived windows, consumed as-is. null = no weather row. */
  windows: SchedulingWindows | null;
  /** Selected upstream by the taste profile — grammar validates, never selects. */
  mealPattern: MealPatternId | null;
  persona: { structure: PersonaStructure } | null;
  budgetBand: PriceRange | null;
  /** Trip circumstance the schema does not carry yet (trap class 5). */
  lodging: LatLng | null;
  /** null = no baseline supplied; anchor-mutation checking is skipped. */
  anchorBaseline: Record<string, AnchorBaseline> | null;
  travel: TravelTimeProvider;
  params: GrammarParams;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const RULE_IDS = [
  // validity
  "validity.permanently-closed",
  "validity.seasonal-expired",
  "validity.recurrence-unmet",
  "validity.status-unverified",
  // hours
  "hours.closed-day",
  "hours.outside-open-window",
  "hours.unknown",
  // wisdom — legal but wrong
  "wisdom.off-peak-window",
  // dwell
  "dwell.overstay",
  "dwell.understay",
  "dwell.category-unknown",
  // daylight
  "daylight.outdoor-after-dark",
  "daylight.outdoor-in-twilight",
  "daylight.golden-hour-missed",
  // weather
  "weather.outdoor-in-adverse-window",
  "weather.outdoor-unavoidable-adverse",
  "weather.unknown",
  // travel
  "travel.infeasible",
  "travel.tight-transfer",
  "travel.uncertifiable",
  "travel.stub-provenance",
  // anchors
  "anchor.arrival-late",
  "anchor.mutated",
  "anchor.egress-buffer-short",
  // pacing
  "pacing.food-stops-exceeded",
  "pacing.no-breather",
  "pacing.wanderer-overscheduled",
  "pacing.long-gap-without-food",
  // meals
  "meal.outside-pattern-window",
  "meal.pattern-unknown",
  // budget
  "budget.over-band",
  "budget.price-uncertain",
  "budget.headroom",
  // midnight
  "midnight.slot-inverted",
  "midnight.late-night-tail",
  // structure
  "structure.reset-gap-without-lodging",
  "reservability.walk-in-only",
  "route.detour-avoidable",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

/**
 * violation = the day is rejected and regenerated before any user sees it.
 * advisory  = the day ships; the advisory seeds a concierge note, a
 *             prep-kit line, or an XXX-29 offer.
 */
export type Severity = "violation" | "advisory";

/**
 * One finding. Machine-usable via `data`, regeneration-usable via
 * `message` — which states subject, observed value and constraint so a
 * draft can be repaired without re-deriving anything.
 *
 * `data` is an open record rather than a 38-arm discriminated union: only
 * XXX-29 needs a typed payload today (`deltaMinutes` off
 * route.detour-avoidable), and 38 arms to serve one reader is the
 * speculative abstraction CLAUDE.md forbids. Per-rule keys are documented
 * at each emit site; typed accessors get extracted at the third consumer.
 */
export interface Violation {
  ruleId: RuleId;
  severity: Severity;
  /** Empty = day-level finding. */
  slotIds: string[];
  message: string;
  data: Readonly<Record<string, JsonValue>>;
}
