"use client";

/**
 * The advisory collapse (XXX-43, Session 15) — pays Session 14 finding #6.
 *
 * WHAT IT REPLACES, measured: an uncapped stack of `[rule.id] text` lines
 * rendered ABOVE the timeline, so the founder met the machine's complaints
 * before he ever saw the day. Eleven of them on the islands day. Two rules —
 * `hours.unknown` and `validity.status-unverified` — fire PER SLOT, so a
 * six-stop day with thin facts produced about a dozen lines from those two
 * alone.
 *
 * THE FINDING THAT MADE THE FIX SMALL: most of the wall was repetition. A
 * line reading "Slot 3's hours were looked up and are not published" sat
 * directly above a card that already showed an "Hours not published"
 * provenance chip. The wall was re-stating, in engine words, what the day was
 * already saying in its own.
 *
 * So: per-stop notes go to their card (`slotIds`, restored at the wire
 * boundary), and what is left is ONE line at the FOOT — grouped, counted, and
 * in the day's own voice. Detail on tap. Rule ids never appear here; they
 * live in the Workshop, where engine words are correct.
 */

import { useState } from "react";
import type { NarratedLineView } from "@/shared/tasting";

/**
 * Rule families → one plain sentence each, with the count filled in.
 *
 * A `Record` over the families we actually group, and anything unlisted falls
 * through to its own line rather than being silently swallowed — the
 * difference between summarising and hiding.
 */
const FAMILY_PHRASE: Record<string, (n: number) => string> = {
  "hours.unknown": (n) =>
    n === 1 ? "one stop has hours I couldn't confirm" : `${n} stops have hours I couldn't confirm`,
  "validity.status-unverified": (n) =>
    n === 1
      ? "one stop I couldn't confirm is still trading"
      : `${n} stops I couldn't confirm are still trading`,
  "budget.price-uncertain": (n) =>
    n === 1 ? "one stop has no published price" : `${n} stops have no published price`,
};

export function daySummaryLine(advisories: NarratedLineView[]): string | null {
  const counts = new Map<string, number>();
  for (const a of advisories) {
    if (FAMILY_PHRASE[a.ruleId] === undefined) continue;
    // Per-slot rules fire once per slot; a day-level one counts as one.
    counts.set(a.ruleId, (counts.get(a.ruleId) ?? 0) + Math.max(1, a.slotIds.length));
  }
  const phrases = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2) // two is a sentence; three is a list, and a list is a wall
    .map(([id, n]) => FAMILY_PHRASE[id]!(n));
  if (phrases.length === 0) return null;
  const joined = phrases.join(", and ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

/** Notes belonging to one stop — rendered on the card, not in a wall. */
export function notesForSlot(
  advisories: NarratedLineView[],
  slotId: string,
): NarratedLineView[] {
  return advisories.filter((a) => a.slotIds.includes(slotId));
}

export function DayAdvisories({
  advisories,
  dayNotes,
}: {
  advisories: NarratedLineView[];
  dayNotes: string[];
}) {
  const [open, setOpen] = useState(false);
  const summary = daySummaryLine(advisories);

  // A day with nothing to disclose says nothing. Silence is the correct
  // rendering of "everything checked out", not an empty panel.
  if (summary === null && dayNotes.length === 0) return null;

  return (
    <div className="border-hair flex flex-col gap-3 border-t pt-5">
      {dayNotes.map((note) => (
        <p key={note} className="text-ink-2 text-[0.9rem] font-light">
          {note}
        </p>
      ))}

      {summary !== null && (
        <>
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-ink-2 text-[0.85rem] font-light">{summary}</p>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              className="label-xs text-accent focus-visible:ring-accent shrink-0 cursor-pointer rounded focus-visible:ring-2 focus-visible:outline-none"
            >
              {open ? "Hide" : "Detail"}
            </button>
          </div>

          {open && (
            <ul className="flex flex-col gap-2.5 pt-1">
              {advisories.map((a, i) => (
                <li
                  key={`${a.ruleId}-${i}`}
                  className="text-muted text-[0.8rem] leading-relaxed font-light"
                >
                  {a.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
