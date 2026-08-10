import { z } from "zod";
import { BUSINESS_STATUSES } from "@/shared/day-grammar/types";
import { FOUNDER_SOURCE } from "@/shared/founder-groundtruth";
import {
  CITIES,
  PLACE_CATEGORIES,
  SLOT_KINDS,
  SLOT_ORIGINS,
  TIERS,
  TIER_VALUES,
  TRANSPORT_MODES,
  WEEKDAYS,
} from "@/shared/vocabulary";

/**
 * Zod schemas for the core domain (XXX-15). These are the write boundary:
 * repository functions parse every input before it reaches the database, so
 * a shape that Zod rejects never becomes a row. The database constraints in
 * 20260803000002_core_domain.sql enforce the same invariants a second time —
 * belt and braces, and the DB wins arguments.
 *
 * Provenance-at-creation: every fact-bearing input requires source + tier +
 * fetchedAt. There is no overload without them — omitting provenance is a
 * type error before it is a runtime error.
 *
 * Constant sets live in src/shared/vocabulary.ts (XXX-18) — one home,
 * re-exported here so existing importers keep working.
 */

export { CITIES, TIERS };
export const citySchema = z.enum(CITIES);

export { PLACE_CATEGORIES };
export type { PlaceCategory } from "@/shared/vocabulary";
export const placeCategorySchema = z.enum(PLACE_CATEGORIES);

const tierSchema = z.literal([...TIER_VALUES]);

const provenanceFields = {
  source: z.string().min(1),
  tier: tierSchema,
  fetchedAt: z.iso.datetime({ offset: true }),
};

/** Local wall-clock time of day, HH:MM (seconds optional). */
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "expected HH:MM time");

/** A closing time, which may be the midnight boundary "24:00". */
const openCloseSchema = z.union([timeOfDaySchema, z.literal("24:00")]);

export const newPlaceSchema = z.strictObject({
  city: citySchema,
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** null = not published / not known (honest absence). */
  address: z.string().min(1).nullable(),
  /** null = no Google listing (founder ground-truth or sparse market). */
  googlePlaceId: z.string().min(1).nullable(),
  ...provenanceFields,
});
export type NewPlace = z.infer<typeof newPlaceSchema>;

/**
 * Per-key value schemas — the fact-key registry. The database stores
 * fact_key as free text so a new key never needs a migration; this registry
 * is the code-level gate. Adding a key = adding a line here.
 */
export const factValueSchemas = {
  /** Canonical URL of the place's own site. Tier 1 territory. */
  website: z.url(),
  /** Always a range; a point price is min = max. Delhi-ready. */
  price_range: z
    .strictObject({
      min: z.number().min(0),
      max: z.number().min(0),
      currency: z.string().length(3),
    })
    .refine((r) => r.max >= r.min, "max must be >= min"),
  /** Concierge/founder judgment about character. Tier 3 territory. */
  vibe: z.string().min(1),
  /**
   * Our seven-category mapping of a place plus the source taxonomy labels it
   * was mapped from (storable under the source's license — decision 002;
   * kept so future re-mapping needs no dataset re-scan). Tier 2 territory.
   */
  categories: z.strictObject({
    mapped: z
      .array(placeCategorySchema)
      .nonempty()
      .refine((a) => new Set(a).size === a.length, "mapped must be unique"),
    source_labels: z.array(z.string().min(1)).nonempty(),
  }),
  /**
   * Founder-only (XXX-33). Google's businessStatus is fetched
   * request-time and never persisted (decision 001); the only
   * business_status that can live in this table is one the founder
   * verified in person. FOUNDER_ONLY_FACT_KEYS enforces it here, and
   * the facts_founder_only_keys CHECK enforces it in the database.
   */
  business_status: z.enum(BUSINESS_STATUSES),
  /**
   * Founder-only (XXX-33). A SPARSE weekday map: only the weekdays the
   * founder actually knows, with an empty array meaning "closed that
   * weekday". Sparse because founder knowledge is sparse — a full week
   * would force inventing six days to record one.
   */
  hours_corrections: z
    .record(
      z.enum(WEEKDAYS),
      z.array(
        z.strictObject({ open: timeOfDaySchema, close: openCloseSchema }),
      ),
    )
    .refine((c) => Object.keys(c).length > 0, "at least one weekday required"),
} as const;
export type FactKey = keyof typeof factValueSchemas;

/**
 * Keys the founder ground-truth channel owns outright. A Google-sourced
 * value must be unable to reach them even through a careless future
 * caller — so the rule is stated at the Zod boundary and again as a DB
 * CHECK (migration 20260809000000).
 */
export const FOUNDER_ONLY_FACT_KEYS = [
  "business_status",
  "hours_corrections",
] as const satisfies readonly FactKey[];
const factKeySchema = z.enum(
  Object.keys(factValueSchemas) as [FactKey, ...FactKey[]],
);

const newFactBase = {
  placeId: z.uuid(),
  factKey: factKeySchema,
  ...provenanceFields,
};

/**
 * Honest absence is explicit: status "absent" (we looked, it isn't
 * published) is a distinct shape with no value field at all, and "never
 * fetched" is no row. The present arm refuses null — the DB CHECK
 * (jsonb_typeof(value) <> 'null') agrees.
 */
export const newFactSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("present"),
      value: z.json().refine((v) => v !== null, "present fact cannot be null"),
      ...newFactBase,
    }),
    z.strictObject({
      status: z.literal("absent"),
      ...newFactBase,
    }),
  ])
  .superRefine((f, ctx) => {
    if (
      f.status === "present" &&
      !factValueSchemas[f.factKey].safeParse(f.value).success
    ) {
      ctx.addIssue({
        code: "custom",
        message: `value does not match the ${f.factKey} schema`,
        path: ["value"],
      });
    }
    if (
      (FOUNDER_ONLY_FACT_KEYS as readonly string[]).includes(f.factKey) &&
      (f.source !== FOUNDER_SOURCE || f.tier !== 1)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${f.factKey} is founder-only: source must be ${FOUNDER_SOURCE} at tier 1`,
        path: ["source"],
      });
    }
  });
export type NewFact = z.infer<typeof newFactSchema>;

const budgetSchema = z
  .strictObject({
    min: z.number().min(0),
    max: z.number().min(0),
    currency: z.string().length(3),
  })
  .refine((b) => b.max >= b.min, "max must be >= min");

export const newTripSchema = z
  .strictObject({
    userId: z.uuid(),
    city: citySchema,
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    partySize: z.number().int().min(1),
    transportModes: z.array(z.enum(TRANSPORT_MODES)).nonempty(),
    /**
     * Required-but-nullable: callers must say "no budget" out loud with an
     * explicit null (user declined to state), never by omission.
     */
    budget: budgetSchema.nullable(),
  })
  .refine((t) => t.endDate >= t.startDate, "endDate must be >= startDate");
export type NewTrip = z.infer<typeof newTripSchema>;

export const newDaySchema = z.strictObject({
  tripId: z.uuid(),
  date: z.iso.date(),
  /** null = not produced by a live generation (fixture / hand-seeded). */
  traceId: z.uuid().nullable(),
});
export type NewDay = z.infer<typeof newDaySchema>;

/**
 * The concierge's reason is Tier 3 judgment and carries provenance; the
 * repository pins tier to 3 on write — callers cannot claim otherwise.
 * null = no judgment recorded (legitimate for fixtures).
 */
const slotReasonSchema = z.strictObject({
  text: z.string().min(1),
  source: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
});

export const newSlotSchema = z
  .strictObject({
    dayId: z.uuid(),
    origin: z.enum(SLOT_ORIGINS),
    kind: z.enum(SLOT_KINDS),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    placeId: z.uuid(),
    reason: slotReasonSchema.nullable(),
  })
  .refine((s) => s.endTime > s.startTime, "endTime must be after startTime");
export type NewSlot = z.infer<typeof newSlotSchema>;
