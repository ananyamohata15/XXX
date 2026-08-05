import type { PlaceView, SlotView } from "@/shared/timeline";
import { ProvenanceChip } from "./ProvenanceChip";
import { formatDuration, formatPriceRange, slotDurationMinutes } from "./format";

function BookedChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
      <svg viewBox="0 0 16 16" className="size-3" fill="currentColor" aria-hidden>
        <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
      </svg>
      Booked
    </span>
  );
}

export function SlotCard({
  slot,
  place,
  alternateNames,
}: {
  slot: SlotView;
  place: PlaceView;
  alternateNames: string[];
}) {
  const anchor = slot.origin === "user";
  return (
    <article
      className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900 ${
        anchor
          ? "border-2 border-zinc-900 dark:border-zinc-100"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
          {slot.startTime}–{slot.endTime}
          <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
            {formatDuration(slotDurationMinutes(slot.startTime, slot.endTime))}
          </span>
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
          {slot.kind === "meal" ? "Meal" : "Activity"}
        </span>
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
          {place.name}
        </h2>
        {anchor && <BookedChip />}
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {place.neighborhood}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {place.priceRange.status === "present" ? (
          <ProvenanceChip tier={place.priceRange.tier}>
            {formatPriceRange(place.priceRange.value)}
          </ProvenanceChip>
        ) : (
          <ProvenanceChip tier={place.priceRange.tier} absent>
            Price not published
          </ProvenanceChip>
        )}
        {place.hoursToday.status === "present" ? (
          <ProvenanceChip tier={place.hoursToday.tier}>
            {place.hoursToday.value}
          </ProvenanceChip>
        ) : (
          <ProvenanceChip tier={place.hoursToday.tier} absent>
            Hours not published
          </ProvenanceChip>
        )}
      </div>

      {slot.reason && (
        <p className="mt-3 border-l-2 border-violet-300 pl-3 text-sm leading-relaxed text-zinc-600 dark:border-violet-700 dark:text-zinc-300">
          {slot.reason.text}
        </p>
      )}

      {alternateNames.length > 0 && (
        <p className="mt-3 border-t border-zinc-100 pt-2.5 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            {alternateNames.length} alternate{alternateNames.length > 1 ? "s" : ""} ready
          </span>
          {" · "}
          {alternateNames.join(" · ")}
        </p>
      )}
    </article>
  );
}
