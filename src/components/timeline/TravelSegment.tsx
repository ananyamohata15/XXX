import type { TravelLeg } from "@/shared/timeline";
import { MODE_GLYPH, MODE_LABEL, formatDuration } from "./format";

/**
 * The connector between two cards: a short rail, the travel pill, and —
 * when the day deliberately breathes — a free-time note. A null leg is
 * honest absence: "not computed", never a guess.
 */
export function TravelSegment({
  leg,
  freeMinutes = 0,
}: {
  leg: TravelLeg | null;
  freeMinutes?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-1.5">
      <span className="h-3 w-px bg-zinc-300 dark:bg-zinc-700" aria-hidden />
      {leg ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          <span aria-hidden>{MODE_GLYPH[leg.mode]}</span>
          {MODE_LABEL[leg.mode]} · {formatDuration(leg.minutes)}
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs text-zinc-400 dark:border-zinc-600 dark:text-zinc-500">
          Travel not computed
        </span>
      )}
      {/* Why this is not a walk (XXX-35). Deterministic: the temperature
          shown is the one the cap function read, not a sentence an LLM
          wrote about the weather. A mode swap the traveller cannot see is
          care they never receive. */}
      {leg?.exposureSwap && (
        <span className="max-w-[15rem] py-0.5 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
          {MODE_LABEL[leg.mode]} rather than a{" "}
          {formatDuration(leg.exposureSwap.exposedMinutes)}{" "}
          {MODE_LABEL[leg.exposureSwap.fromMode].toLowerCase()} — it&apos;s{" "}
          {Math.round(leg.exposureSwap.apparentTempC)}° out.
        </span>
      )}
      {freeMinutes > 0 && (
        <span className="py-1 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
          Free time · {formatDuration(freeMinutes)}
        </span>
      )}
      <span className="h-3 w-px bg-zinc-300 dark:bg-zinc-700" aria-hidden />
    </div>
  );
}
