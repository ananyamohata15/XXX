import { z } from "zod";

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
 */

export const CITIES = ["toronto", "london", "new_delhi"] as const;
export const citySchema = z.enum(CITIES);

export const TIERS = { verified: 1, observed: 2, judgment: 3 } as const;
const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const provenanceFields = {
  source: z.string().min(1),
  tier: tierSchema,
  fetchedAt: z.iso.datetime({ offset: true }),
};

/** Local wall-clock time of day, HH:MM (seconds optional). */
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "expected HH:MM time");

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
} as const;
export type FactKey = keyof typeof factValueSchemas;
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
    transportModes: z
      .array(z.enum(["walk", "cycle", "drive", "transit"]))
      .nonempty(),
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
    origin: z.enum(["concierge", "user"]),
    kind: z.enum(["meal", "activity"]),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    placeId: z.uuid(),
    reason: slotReasonSchema.nullable(),
  })
  .refine((s) => s.endTime > s.startTime, "endTime must be after startTime");
export type NewSlot = z.infer<typeof newSlotSchema>;
