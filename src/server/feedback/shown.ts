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
  /**
   * A fabricated day over real pool places (the synthetic preview). The
   * claim is still recorded — the founder's words are worth keeping —
   * but no fact write may follow from a card that was never generated.
   * Defaulted so traces written before this field parse unchanged.
   */
  synthetic: z.boolean().default(false),
  /**
   * What the traveller asked to DO today (XXX-48, Session 16 CP3).
   *
   * THE GAP THIS CLOSES. Session 15 built `wants` — the positive half of the
   * product, and the fix for a founder day that had neither shopping nor
   * pubs in it — and recorded that the trace should carry it. The patch
   * failed to apply and nobody noticed, because a missing audit field breaks
   * nothing: the OVERRIDE landed and worked, and only its record was absent.
   * The consequence was exact and was felt this session: the trace of the
   * picnic request could not confirm whether the parser's `wants` had reached
   * generation at all, so the diagnosis had to reason about it instead of
   * reading it.
   *
   * That is XXX-43's own defect-4 lesson generalised. A record that cannot
   * say what governed a day gives a confident wrong answer to anyone mining
   * it later — and "the field is simply missing" is the same wrong answer as
   * "the field says day-1-jays".
   *
   * These are the APPLIED wants — the list that actually became the day's
   * gravity, after the `MAX_INTERESTS` cap. A sentence naming five interests
   * shows three here, and that is the truth about the day rather than the
   * truth about the sentence.
   *
   * `.default([])` so every trace written before this field parses unchanged.
   */
  day_wants: z.array(z.string()).default([]),
});

/**
 * NOT ADDED, and the omission is deliberate — `persona_source`.
 *
 * Session 15's note said the fix should record *"`profile` plus a
 * `persona_source`"*. It should not. `persona_key === "profile"` already IS
 * the source; a second field beside it would be two ways to say one thing,
 * free to disagree, which is the duplicate-ownership this project bans in
 * constraint 3 and has now paid for five times under other names. The half
 * of that patch worth landing was `day_wants`, and it is above.
 */
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
  synthetic?: boolean;
  /** The applied wants — what actually became the day's gravity. */
  dayWants?: readonly string[];
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
    synthetic: input.synthetic ?? false,
    day_wants: [...(input.dayWants ?? [])],
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
