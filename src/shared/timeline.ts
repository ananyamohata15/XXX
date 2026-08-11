import { z } from "zod";
import { minutesToTime, timeToMinutes } from "./time";
import {
  CITIES,
  SLOT_KINDS,
  SLOT_ORIGINS,
  SLOT_ROLES,
  TIERS,
  TIER_VALUES,
  TRANSPORT_MODES,
  type Tier,
} from "./vocabulary";

/**
 * View model for the timeline prototype (XXX-18 / XXX-19). Mirrors the
 * domain's shapes — honest absence, provenance on every fact, tier-3
 * reasons — without touching the database. The fixture day is parsed
 * through fixtureDaySchema at module load, so a malformed fixture fails
 * the build, not the demo.
 */

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM time");

const tierSchema = z.literal([...TIER_VALUES]);

const provenanceFields = {
  source: z.string().min(1),
  tier: tierSchema,
  fetchedAt: z.iso.datetime({ offset: true }),
};

/**
 * A displayed fact, three-valued exactly as the domain stores it:
 *   present  — a value, with provenance
 *   absent   — we looked and it is not published, with provenance
 *   unknown  — never fetched, so there IS no provenance to state
 *
 * The third arm arrived with live output (XXX-32): the fixture always had
 * values, but a generated day hits never-fetched constantly — `vibe` is
 * never fetched by the engine at all, and `hours` is never fetched for a
 * candidate with no Google link. Collapsing it into "absent" would claim
 * we looked when we did not, which is the silent fallback constraint 4
 * forbids at the point the user actually reads.
 */
const factView = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("present"),
      value,
      ...provenanceFields,
    }),
    z.strictObject({ status: z.literal("absent"), ...provenanceFields }),
    z.strictObject({ status: z.literal("unknown") }),
  ]);

/** The displayed-fact shape, as a plain type for component props. */
export type FactView<T> =
  | { status: "present"; value: T; source: string; tier: Tier; fetchedAt: string }
  | { status: "absent"; source: string; tier: Tier; fetchedAt: string }
  | { status: "unknown" };

export const priceRangeSchema = z
  .strictObject({
    min: z.number().min(0),
    max: z.number().min(0),
    currency: z.string().length(3),
  })
  .refine((r) => r.max >= r.min, "max must be >= min");
export type PriceRange = z.infer<typeof priceRangeSchema>;

export const placeViewSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  neighborhood: z.string().min(1),
  priceRange: factView(priceRangeSchema),
  hoursToday: factView(z.string().min(1)),
  vibe: factView(z.string().min(1)),
});
export type PlaceView = z.infer<typeof placeViewSchema>;

/** The concierge's reason is always Judgment — the tier is pinned, not chosen. */
export const reasonSchema = z.strictObject({
  text: z.string().min(1),
  source: z.string().min(1),
  tier: z.literal(TIERS.judgment),
});
export type Reason = z.infer<typeof reasonSchema>;

export const alternateViewSchema = z.strictObject({
  placeId: z.string().min(1),
  rank: z.number().int().min(1),
  reason: reasonSchema,
});
export type AlternateView = z.infer<typeof alternateViewSchema>;

export const slotViewSchema = z
  .strictObject({
    id: z.string().min(1),
    origin: z.enum(SLOT_ORIGINS),
    kind: z.enum(SLOT_KINDS),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    placeId: z.string().min(1),
    /**
     * null on anchor slots — the user placed it; the concierge claims no
     * credit. Also null on a live concierge slot whose narration produced
     * no reason: the card says so rather than inventing one.
     */
    reason: reasonSchema.nullable(),
    alternates: z.array(alternateViewSchema),
    /**
     * What this stop is FOR in the day's arc (XXX-35). The card marks the
     * `anchor` so the day's centrepiece is VISIBLE — the founder's verdict
     * on two separate days was "the day isnt anchored on anything", and a
     * centre nobody can see is not much better than no centre.
     *
     * Optional because the hand-authored fixture predates the arc, and
     * absent is the honest reading: that day was not composed around one.
     */
    role: z.enum(SLOT_ROLES).optional(),
  })
  .refine((s) => s.endTime > s.startTime, "endTime must be after startTime");
export type SlotView = z.infer<typeof slotViewSchema>;

export const travelLegSchema = z.strictObject({
  mode: z.enum(TRANSPORT_MODES),
  minutes: z.number().int().positive(),
  /**
   * Per-leg provenance. Optional because the hand-authored fixture
   * carries one provenance for the whole matrix (travelProvenance); a
   * live day's legs come from different providers — stored matrix, live
   * transit, haversine stub — and averaging that into one line would be
   * the kind of tidy lie this codebase does not tell.
   */
  source: z.string().min(1).optional(),
  tier: tierSchema.optional(),
});
export type TravelLeg = z.infer<typeof travelLegSchema>;

/** Keys are canonical unordered pairs — build them with travelKey(). */
export type TravelMatrix = Record<string, TravelLeg>;

/**
 * The day shape the timeline components render. The hand-authored
 * fixture and a live generation both satisfy it; `fixtureDaySchema`
 * below adds the stricter rules that only make sense for authored data.
 */
export const timelineDaySchema = z
  .strictObject({
    city: z.enum(CITIES),
    date: z.iso.date(),
    /** When the day opens — reflow lays concierge slots forward from here. */
    dayStart: timeOfDaySchema,
    places: z.record(z.string(), placeViewSchema),
    slots: z.array(slotViewSchema).min(1),
    travel: z.record(z.string(), travelLegSchema),
    /** One provenance for the whole matrix — the fixture's travel times share a source. */
    travelProvenance: z.strictObject(provenanceFields),
  })
  .superRefine((d, ctx) => {
    d.slots.forEach((s, i) => {
      if (!d.places[s.placeId]) {
        ctx.addIssue({
          code: "custom",
          message: `slot references unknown place "${s.placeId}"`,
          path: ["slots", i, "placeId"],
        });
      }
      s.alternates.forEach((a, j) => {
        if (!d.places[a.placeId]) {
          ctx.addIssue({
            code: "custom",
            message: `alternate references unknown place "${a.placeId}"`,
            path: ["slots", i, "alternates", j, "placeId"],
          });
        }
      });
      if (s.origin === "user" && (s.reason !== null || s.alternates.length > 0)) {
        ctx.addIssue({
          code: "custom",
          message: "anchor slots carry no concierge judgment",
          path: ["slots", i],
        });
      }
      if (i > 0 && s.startTime < d.slots[i - 1].endTime) {
        ctx.addIssue({
          code: "custom",
          message: "slots must be ordered and non-overlapping",
          path: ["slots", i, "startTime"],
        });
      }
    });
    for (const key of Object.keys(d.travel)) {
      const [a, b] = key.split("|");
      if (!a || !b || !d.places[a] || !d.places[b]) {
        ctx.addIssue({
          code: "custom",
          message: `travel key "${key}" does not join two known places`,
          path: ["travel", key],
        });
      }
    }
  });
export type TimelineDay = z.infer<typeof timelineDaySchema>;

/**
 * The hand-authored fixture, which is held to one rule a live day cannot
 * be: an authored concierge slot with no reason is an authoring mistake,
 * whereas a generated one is honest absence the card renders as such.
 */
export const fixtureDaySchema = timelineDaySchema.superRefine((d, ctx) => {
  d.slots.forEach((s, i) => {
    if (s.origin === "concierge" && s.reason === null) {
      ctx.addIssue({
        code: "custom",
        message: "concierge slots must state their reason",
        path: ["slots", i, "reason"],
      });
    }
  });
});
export type FixtureDay = z.infer<typeof fixtureDaySchema>;

// ---------------------------------------------------------------------------
// Pure time + reflow logic. No side effects, unit-testable with fixtures.
// ---------------------------------------------------------------------------

/** Re-exported from ./time so existing importers keep working. */
export { minutesToTime, timeToMinutes };

/** Canonical unordered key for the travel matrix — travel is symmetric here. */
export function travelKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** null = honest absence: this pair was never computed. Never guessed. */
export function lookupTravel(
  matrix: TravelMatrix,
  a: string,
  b: string,
): TravelLeg | null {
  return matrix[travelKey(a, b)] ?? null;
}

export interface ReflowedSlot {
  slotId: string;
  placeId: string;
  startTime: string;
  endTime: string;
}

export interface ReflowResult {
  /**
   * Final placement order — it can differ from the input order: a slot
   * whose recomputed times would collide with the anchor slides past it.
   */
  slots: ReflowedSlot[];
  /** Travel between consecutive placed slots (length slots - 1); null = not computed. */
  legs: (TravelLeg | null)[];
  /**
   * Minutes of late arrival at an anchor after travel from the previous
   * slot. The anchor never moves — a late arrival is reported, not
   * absorbed. Real conflict resolution is E5's job.
   */
  anchorOverrunMinutes: number;
}

/** Reflowed starts snap up to a 5-minute grid — a stand-in for E5's real
 *  buffer logic, and it keeps recomputed times looking deliberate. */
const GRID_MINUTES = 5;
const snapUp = (m: number) => Math.ceil(m / GRID_MINUTES) * GRID_MINUTES;

/**
 * Recompute a day's times for a new visual order. Naive on purpose — what
 * it ignores (opening hours, meal windows, pacing) is E5's job. Rules:
 * durations preserved; travel comes from the matrix (never guessed —
 * unknown legs add no time and surface as null); the anchor keeps its own
 * times immovably; a slot that would collide with the anchor slides past
 * it; slots after the anchor flow from max(anchor end, computed arrival).
 */
export function reflowDay(
  orderedSlots: readonly SlotView[],
  travel: TravelMatrix,
  dayStart: string,
): ReflowResult {
  const anchor = orderedSlots.find((s) => s.origin === "user") ?? null;
  const anchorStart = anchor ? timeToMinutes(anchor.startTime) : Infinity;
  const durationOf = (s: SlotView) =>
    timeToMinutes(s.endTime) - timeToMinutes(s.startTime);

  let cursor = timeToMinutes(dayStart);
  let anchorPlaced = anchor === null;
  let anchorOverrunMinutes = 0;
  let lastPlaceId: string | null = null;
  const slots: ReflowedSlot[] = [];
  const legs: (TravelLeg | null)[] = [];
  const deferred: SlotView[] = [];

  const travelFromLast = (slot: SlotView): TravelLeg | null =>
    lastPlaceId === null ? null : lookupTravel(travel, lastPlaceId, slot.placeId);

  const place = (slot: SlotView) => {
    if (lastPlaceId !== null) {
      const leg = travelFromLast(slot);
      legs.push(leg);
      if (leg) cursor += leg.minutes;
    }
    if (slot.origin === "user") {
      if (cursor > anchorStart) anchorOverrunMinutes += cursor - anchorStart;
      slots.push({
        slotId: slot.id,
        placeId: slot.placeId,
        startTime: slot.startTime,
        endTime: slot.endTime,
      });
      cursor = Math.max(cursor, timeToMinutes(slot.endTime));
      anchorPlaced = true;
    } else {
      const start = snapUp(cursor);
      slots.push({
        slotId: slot.id,
        placeId: slot.placeId,
        startTime: minutesToTime(start),
        endTime: minutesToTime(start + durationOf(slot)),
      });
      cursor = start + durationOf(slot);
    }
    lastPlaceId = slot.placeId;
  };

  for (const slot of orderedSlots) {
    if (!anchorPlaced && slot.origin !== "user") {
      const leg = travelFromLast(slot);
      const wouldStart = snapUp(cursor + (leg?.minutes ?? 0));
      if (wouldStart + durationOf(slot) > anchorStart) {
        deferred.push(slot);
        continue;
      }
    }
    place(slot);
    if (slot.origin === "user") for (const d of deferred.splice(0)) place(d);
  }

  return { slots, legs, anchorOverrunMinutes };
}
