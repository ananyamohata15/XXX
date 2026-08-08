/**
 * Violation narration (XXX-5).
 *
 * `Violation.message` is written for a machine that has to repair a draft:
 * subject, observed value, constraint. This layer re-voices the same
 * findings for a human, in the concierge's register — the E2 tone bar:
 * clipped, confident, no hedging, no apology, no exclamation. The
 * concierge states what it did and why; it does not perform.
 *
 * Two consumers, one function. The regeneration prompt takes the
 * `violations` block and gets told what to fix. The UI takes the
 * `advisories` block and shows concierge notes and prep-kit lines. Neither
 * re-derives anything: everything below is a rendering of what
 * validateDay already decided.
 */

import type { RuleId, Severity, Violation } from "./types";

export interface NarratedLine {
  ruleId: RuleId;
  severity: Severity;
  slotIds: string[];
  /** One sentence, concierge voice. */
  text: string;
}

export interface NarratedDay {
  /** Non-empty means the day is rejected. */
  violations: NarratedLine[];
  advisories: NarratedLine[];
  /**
   * The one-line verdict a reviewer or a log wants first.
   */
  headline: string;
}

/**
 * How the concierge opens each kind of finding. The rule text carries the
 * facts; this carries the posture — a violation is something the concierge
 * will not serve, an advisory is something it wants you to know.
 */
const OPENERS: Partial<Record<RuleId, string>> = {
  "validity.permanently-closed": "This one is shut for good.",
  "validity.seasonal-expired": "That season is over.",
  "validity.recurrence-unmet": "Wrong date for that.",
  "validity.status-unverified": "Unconfirmed.",
  "hours.closed-day": "Closed that day.",
  "hours.outside-open-window": "The door is not open then.",
  "hours.unknown": "Hours unverified.",
  "wisdom.off-peak-window": "Open, but past its best.",
  "dwell.overstay": "Too long in one place.",
  "dwell.understay": "Not enough time to be worth it.",
  "dwell.category-unknown": "Unchecked.",
  "daylight.outdoor-after-dark": "There will be no light left.",
  "daylight.outdoor-in-twilight": "The light goes first.",
  "daylight.golden-hour-missed": "Worth moving for the light.",
  "weather.outdoor-in-adverse-window": "The weather is against this hour.",
  "weather.outdoor-unavoidable-adverse": "Pack for it.",
  "weather.unknown": "No forecast this far out.",
  "travel.infeasible": "The clock does not allow it.",
  "travel.tight-transfer": "Tight.",
  "travel.uncertifiable": "Cannot vouch for this leg.",
  "travel.stub-provenance": "Travel times are estimates.",
  "anchor.arrival-late": "You would miss it.",
  "anchor.mutated": "That is your booking.",
  "anchor.egress-buffer-short": "The crowd will still be leaving.",
  "pacing.food-stops-exceeded": "Too many stops for food.",
  "pacing.no-breather": "No air between these.",
  "pacing.wanderer-overscheduled": "Too scheduled for you.",
  "pacing.long-gap-without-food": "A long stretch without a meal.",
  "meal.outside-pattern-window": "Wrong hour for that meal.",
  "meal.pattern-unknown": "No meal pattern set.",
  "budget.over-band": "Over budget.",
  // No opener: the message is already clipped, and every phrasing tried
  // here simply re-said "unpriced".
  "budget.headroom": "Room to spare.",
  "midnight.slot-inverted": "That cannot be scheduled.",
  "midnight.late-night-tail": "Past midnight is another day.",
  "structure.reset-gap-without-lodging": "A gap I cannot vouch for.",
  "reservability.walk-in-only": "No bookings taken.",
  "route.detour-avoidable": "This order costs you.",
};

/** Crude stemmer — enough to see that "prices" and "priced" are the same word. */
const stem = (word: string): string =>
  word.toLowerCase().replace(/[^a-z]/g, "").replace(/(ing|ed|es|s)$/, "");

/**
 * The concierge does not say the same thing twice. An opener that merely
 * restates a word the message already uses ("Tight." in front of "...is
 * tight") is dropped — the message can carry the line alone.
 */
function narrate(finding: Violation): NarratedLine {
  const opener = OPENERS[finding.ruleId];
  const messageStems = new Set(finding.message.split(/\s+/).map(stem));
  const repeats =
    opener !== undefined &&
    opener
      .split(/\s+/)
      .map(stem)
      .filter((w) => w.length >= 4)
      .some((w) => messageStems.has(w));

  // Rule messages lead with a slot label ("slot 7 is Rogers Centre"),
  // which is right for a machine and wrong at the head of a spoken
  // sentence — including the sentence that follows an opener.
  const sentence = finding.message.charAt(0).toUpperCase() + finding.message.slice(1);

  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    slotIds: finding.slotIds,
    text: opener === undefined || repeats ? sentence : `${opener} ${sentence}`,
  };
}

export function describeViolations(found: readonly Violation[]): NarratedDay {
  const violations = found.filter((v) => v.severity === "violation").map(narrate);
  const advisories = found.filter((v) => v.severity === "advisory").map(narrate);

  return { violations, advisories, headline: headlineFor(violations, advisories) };
}

function headlineFor(
  violations: readonly NarratedLine[],
  advisories: readonly NarratedLine[],
): string {
  const notes = `${advisories.length} note${advisories.length === 1 ? "" : "s"}`;
  if (violations.length === 0) {
    return advisories.length === 0
      ? "This day holds up."
      : `This day holds up — ${notes}.`;
  }
  const problems = `${violations.length} problem${violations.length === 1 ? "" : "s"}`;
  return `This day does not hold up: ${problems}, ${notes}.`;
}

/**
 * The block handed to the regeneration prompt. Raw rule messages, not the
 * narrated ones — the generator needs the constraint stated flatly, and
 * the concierge's posture would only be noise to it.
 */
export function regenerationFeedback(found: readonly Violation[]): string {
  const violations = found.filter((v) => v.severity === "violation");
  if (violations.length === 0) return "";
  return [
    "This draft violates the day grammar and must be repaired:",
    ...violations.map((v, i) => `${i + 1}. [${v.ruleId}] ${v.message}`),
    "Fix every item. Slots with origin=user are the traveller's own commitments and must not be moved, reordered, or replaced.",
  ].join("\n");
}
