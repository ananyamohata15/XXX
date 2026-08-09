/**
 * Feedback vocabulary (XXX-33) — the words for claims and taste signals,
 * owned once and shared by the capture UI and the write path.
 *
 * The two sets are DISJOINT and that is the point. Comment 10289's
 * doctrine is that world-facts and taste must not cross-contaminate, so
 * `not_for_me` is not a spellable evidence claim and `hours_wrong` is
 * not a spellable taste signal — in the database (two CHECK enums), in
 * the types (two unions with no member in common), and here, where the
 * UI picks its buttons from.
 *
 * Dependency-free (src/shared law): the page imports it for labels, the
 * server imports it for parsing.
 */

import type { FounderFactKey } from "./founder-groundtruth";

/** Claims about the world. These attach to a fact and can be adjudicated. */
export const EVIDENCE_CLAIMS = [
  "hours_wrong",
  "price_wrong",
  "permanently_closed",
  "not_as_described",
] as const;
export type EvidenceClaim = (typeof EVIDENCE_CLAIMS)[number];

/** Claims about fit. These attach to a person and cannot be adjudicated. */
export const TASTE_SIGNALS = [
  "liked",
  "wouldnt_recommend",
  "not_for_me",
  "day_verdict",
] as const;
export type TasteSignal = (typeof TASTE_SIGNALS)[number];

export const CLAIM_LABELS: Record<EvidenceClaim, string> = {
  hours_wrong: "Hours wrong",
  price_wrong: "Price wrong",
  permanently_closed: "Permanently closed",
  not_as_described: "Not as described",
};

export const SIGNAL_LABELS: Record<TasteSignal, string> = {
  liked: "Good pick",
  wouldnt_recommend: "Wouldn't recommend",
  not_for_me: "Not for me",
  day_verdict: "Day verdict",
};

/**
 * Which displayed fact a claim disputes. `null` for not_as_described,
 * which is about the whole card and names no single fact — the schema's
 * evidence_fact_key_present CHECK enforces the same pairing.
 *
 * These are the DISPLAYED keys (what the card showed), deliberately not
 * the same vocabulary as the founder key a flip writes: a founder
 * correcting `hours` writes `hours_corrections`. Disputed and written
 * are different questions and the row records both.
 */
export const CLAIM_DISPUTES_FACT: Record<EvidenceClaim, string | null> = {
  hours_wrong: "hours",
  price_wrong: "price_range",
  permanently_closed: "business_status",
  not_as_described: null,
};

/** Which founder fact key a founder's correction writes, if any. */
export const CLAIM_FLIPS_FACT: Record<EvidenceClaim, FounderFactKey | null> = {
  hours_wrong: "hours_corrections",
  price_wrong: "price_range",
  permanently_closed: "business_status",
  not_as_described: null,
};

/**
 * The correction a founder supplies alongside a claim. Absent means the
 * claim is recorded and NOTHING flips — "this is wrong" is a complete
 * and useful statement on its own, and a system that demanded the right
 * answer before it would hear the complaint would collect less truth.
 *
 * `permanently_closed` needs no payload: the claim IS the value.
 */
export type Correction =
  | { kind: "hours"; closedToday: true }
  | { kind: "hours"; closedToday: false; open: string; close: string }
  | { kind: "price"; min: number; max: number; currency: string };
