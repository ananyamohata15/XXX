"use client";

/**
 * The day (XXX-43, Session 15) — Screen 4.
 *
 * The timeline components are KEPT. They work, and the mandate was not to
 * rebuild them. What changes is what surrounds them:
 *
 *  - the advisory wall collapses to one line at the FOOT (finding #6), with
 *    per-stop notes on their own cards;
 *  - the theme prints its name, not `toronto-islands (derived)`;
 *  - the anchor-degraded box stops printing category slugs;
 *  - nothing says "E5".
 */

import { InteractiveTimeline } from "@/components/timeline/InteractiveTimeline";
import { VerdictControls } from "@/components/tasting/VerdictControls";
import { Button, Label } from "@/components/ui/primitives";
import { DayAdvisories, notesForSlot } from "./Advisories";
import type { TastingOutcome } from "@/shared/tasting";
import { CATEGORY_LABELS, type PlaceCategory } from "@/shared/vocabulary";
import { themeLabel } from "@/shared/theme";
import { DIETARY_ABSENCE_NOTE } from "@/shared/dietary";
import { CATEGORY_CONSTRAINT_LIMITATION } from "@/shared/constraints";
import { useState } from "react";

export function DayView({
  outcome,
  onNew,
  dietaryStated = false,
  constrained = false,
}: {
  outcome: Extract<TastingOutcome, { status: "ok" }>;
  onNew: () => void;
  dietaryStated?: boolean;
  /** A hard category constraint is in force, so the day owes its limitation. */
  constrained?: boolean;
}) {
  const [verdict, setVerdict] = useState("");
  const [sent, setSent] = useState(false);

  const sendDayVerdict = async () => {
    if (verdict.trim().length === 0) return;
    await fetch("/api/tasting/taste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        traceId: outcome.meter.traceId,
        signal: "day_verdict",
        freeText: verdict.trim(),
      }),
    });
    setSent(true);
  };

  return (
    <div className="flex flex-col gap-8 pt-6">
      {/* The theme, said out loud rather than printed as a slug. */}
      {outcome.theme && <Label>{themeLabel(outcome.theme.id)}</Label>}

      {outcome.weatherBlind && (
        <p className="text-muted text-[0.82rem] font-light">
          That date is far enough out that nobody has a forecast for it yet.
          Hours and pacing were checked; the weather was not.
        </p>
      )}

      {outcome.anchorDegraded && (
        <p className="text-muted text-[0.82rem] font-light">
          The centre of this day is a shorter stop than I&apos;d like — the
          best I could seat only holds{" "}
          {outcome.anchorDegraded.fittedMinutes} minutes.{" "}
          {/* The category is a slug on the wire; only render it if the
              vocabulary actually knows it, rather than printing raw. */}
          {CATEGORY_LABELS[outcome.anchorDegraded.category as PlaceCategory] !==
            undefined &&
            `Looking for ${CATEGORY_LABELS[outcome.anchorDegraded.category as PlaceCategory]}.`}
        </p>
      )}

      <InteractiveTimeline
        day={outcome.day}
        interactivity="review"
        renderSlotFooter={(slot) => {
          const notes = notesForSlot(outcome.advisories, slot.id);
          return (
            <div className="flex flex-col gap-2">
              {/* Per-stop notes, on the stop they concern. */}
              {notes.map((n, i) => (
                <p
                  key={`${n.ruleId}-${i}`}
                  className="text-muted text-[0.72rem] leading-snug font-light"
                >
                  {n.text}
                </p>
              ))}
              <VerdictControls
                traceId={outcome.meter.traceId}
                slotId={slot.id}
              />
            </div>
          );
        }}
      />

      {dietaryStated && (
        <p className="text-muted text-[0.8rem] font-light">
          {DIETARY_ABSENCE_NOTE}
        </p>
      )}

      {/* The edge of the promise, on the day where it could mislead (XXX-44).
          The wine bar this line used to apologise for is now filtered by its
          own directory labels; what the line names is what is genuinely left,
          which is a restaurant that simply pours and says nothing about it.
          A traveller who knows the limit can work around it — and a limit that
          has stopped being true is a silent one, so the sentence moved with
          the fix rather than outliving it. */}
      {constrained && (
        <p className="text-muted text-[0.8rem] font-light">
          {CATEGORY_CONSTRAINT_LIMITATION}
        </p>
      )}

      <DayAdvisories
        advisories={outcome.advisories}
        dayNotes={outcome.dayNotes}
      />

      <div className="border-hair flex flex-col gap-4 border-t pt-6">
        <Label>The day as a whole</Label>
        <textarea
          rows={3}
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
          placeholder="Morning was right, evening felt like a brochure…"
          className="border-hair-2 text-ink placeholder:text-muted focus:border-accent w-full resize-none border-0 border-b bg-transparent pb-3 text-[0.95rem] font-light focus:outline-none"
        />
        <Button
          onClick={() => void sendDayVerdict()}
          disabled={sent || verdict.trim().length === 0}
        >
          {sent ? "Got it" : "Send"}
        </Button>
      </div>

      <Button variant="ghost" onClick={onNew}>
        Plan another
      </Button>
    </div>
  );
}
