/**
 * What the founder was looking at (XXX-33).
 *
 * An evidence row claims something about a fact "as displayed". If the
 * client told us what was displayed, a client could tell us anything —
 * so it doesn't. The generation route writes this block into its own
 * trace metadata at the moment the day is produced, and the verdict
 * routes read it back by traceId. The client sends a traceId and a
 * slotId; every adjudicable field is derived here.
 *
 * No fact VALUES land in the trace — only status, source, tier,
 * fetchedAt and a sha256 digest (decision 001 addendum 2026-08-09). The
 * trace stays as free of Google content as it has always been.
 */

import { z } from "zod";
import type { GrammarDay, JsonValue, Violation } from "@/shared/day-grammar/types";
import { TIER_VALUES } from "@/shared/vocabulary";
import { factDigest } from "./digest";

export const TASTING_SURFACE = "tasting_room";

/** The displayed facts a claim can dispute, in card order. */
const SHOWN_KEYS = ["hours", "price_range", "business_status"] as const;
export type ShownKey = (typeof SHOWN_KEYS)[number];

const shownFactSchema = z.strictObject({
  status: z.enum(["present", "absent"]),
  source: z.string(),
  tier: z.literal([...TIER_VALUES]),
  fetched_at: z.string(),
  /** null when the fact was absent — there is no value to fingerprint. */
  digest: z.string().nullable(),
});

const shownCardSchema = z.strictObject({
  place_id: z.string(),
  facts: z.record(z.string(), shownFactSchema),
  rule_ids: z.array(z.string()),
});

export const tastingContextSchema = z.strictObject({
  surface: z.literal(TASTING_SURFACE),
  persona_key: z.string(),
  day_date: z.string(),
  cards: z.record(z.string(), shownCardSchema),
});
export type TastingContext = z.infer<typeof tastingContextSchema>;
export type ShownCard = z.infer<typeof shownCardSchema>;

/**
 * Build the block from the day the engine actually produced. Advisory
 * rule ids ride along per card so the free-text corpus is queryable by
 * rule-adjacency (comment 10296's fourth axis) without re-deriving
 * anything at read time.
 */
export function buildTastingContext(input: {
  day: GrammarDay;
  findings: Violation[];
  personaKey: string;
}): TastingContext {
  const cards: Record<string, ShownCard> = {};
  for (const slot of input.day.slots) {
    const place = input.day.places[slot.placeId];
    if (place === undefined) continue;
    const facts: Record<string, z.infer<typeof shownFactSchema>> = {};
    const sources = {
      hours: place.hours,
      price_range: place.priceRange,
      business_status: place.businessStatus,
    } as const;
    for (const key of SHOWN_KEYS) {
      const fact = sources[key];
      if (fact === undefined) continue; // never fetched: no row, no claim
      facts[key] = {
        status: fact.status,
        source: fact.source,
        tier: fact.tier,
        fetched_at: fact.fetchedAt,
        digest:
          fact.status === "present"
            ? factDigest(fact.value as JsonValue)
            : null,
      };
    }
    cards[slot.id] = {
      place_id: slot.placeId,
      facts,
      rule_ids: input.findings
        .filter((f) => f.slotIds.includes(slot.id))
        .map((f) => f.ruleId),
    };
  }
  return {
    surface: TASTING_SURFACE,
    persona_key: input.personaKey,
    day_date: input.day.date,
    cards,
  };
}

/** null = this trace carries no tasting context (wrong trace, or older). */
export function parseTastingContext(
  metadata: unknown,
): TastingContext | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const tasting = (metadata as Record<string, unknown>).tasting;
  const parsed = tastingContextSchema.safeParse(tasting);
  return parsed.success ? parsed.data : null;
}
