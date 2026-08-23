import type { TravelLeg } from "@/shared/timeline";
import { MODE_GLYPH, MODE_LABEL, formatDuration } from "./format";

/**
 * The connector between two cards: a short rail, the travel pill, and —
 * when the day deliberately breathes — a free-time note. A null leg is
 * honest absence: "not computed", never a guess.
 *
 * Session 15 (XXX-43) pays finding #4: a leg riding a NAMED SERVICE says so.
 * Before, the ferry to Hanlan's Point rendered as "🚇 Transit · 13 min" — the
 * same pill as a streetcar — while the day's whole feasibility hung on a
 * timetable nothing on screen mentioned, and the good label sat unused in
 * `ferry-seed.ts`. `leg.via` is an ANNOTATION rather than a transport mode,
 * because a ferry is not a way a traveller elects to get around; it is what
 * the leg is. See `legServiceSchema`.
 */
export function TravelSegment({
  leg,
  freeMinutes = 0,
}: {
  leg: TravelLeg | null;
  freeMinutes?: number;
}) {
  const service = leg?.via;
  return (
    <div className="flex flex-col items-center gap-1 py-1.5">
      <span className="bg-hair-2 h-3 w-px" aria-hidden />
      {leg ? (
        <span className="bg-sunk text-ink-2 inline-flex flex-col items-center rounded-2xl px-3.5 py-1.5 text-xs">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span aria-hidden>{service ? "⛴" : MODE_GLYPH[leg.mode]}</span>
            {service ? "Ferry" : MODE_LABEL[leg.mode]} ·{" "}
            {formatDuration(leg.minutes)}
          </span>
          {service && (
            <span className="text-muted mt-0.5 text-center text-[0.68rem] font-light">
              {service.label}
              {service.lastDeparture !== null && (
                <> · last boat {service.lastDeparture}</>
              )}
            </span>
          )}
        </span>
      ) : (
        <span className="border-hair-2 text-muted inline-flex items-center rounded-2xl border border-dashed px-3.5 py-1.5 text-xs">
          Travel not computed
        </span>
      )}
      {/* Why this is not a walk (XXX-35). Deterministic: the temperature
          shown is the one the cap function read, not a sentence an LLM
          wrote about the weather. A mode swap the traveller cannot see is
          care they never receive. */}
      {leg?.exposureSwap && (
        <span className="text-muted max-w-[15rem] py-0.5 text-center text-[11px] font-light">
          {MODE_LABEL[leg.mode]} rather than a{" "}
          {formatDuration(leg.exposureSwap.exposedMinutes)}{" "}
          {MODE_LABEL[leg.exposureSwap.fromMode].toLowerCase()} — it&apos;s{" "}
          {Math.round(leg.exposureSwap.apparentTempC)}° out.
        </span>
      )}
      {freeMinutes > 0 && (
        <span className="label-xs text-muted py-1">
          Free time · {formatDuration(freeMinutes)}
        </span>
      )}
      <span className="bg-hair-2 h-3 w-px" aria-hidden />
    </div>
  );
}
