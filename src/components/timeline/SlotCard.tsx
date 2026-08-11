"use client";

import { AnimatePresence, motion } from "motion/react";
import type { FactView, PlaceView, PriceRange, Reason } from "@/shared/timeline";
import {
  TIER_LABELS,
  type SlotKind,
  type SlotOrigin,
  type SlotRole,
} from "@/shared/vocabulary";
import { ANCHOR_WIGGLE_PX } from "./constants";
import { ProvenanceChip } from "./ProvenanceChip";
import {
  formatAgo,
  formatDuration,
  formatPriceRange,
  slotDurationMinutes,
} from "./format";

export interface AlternateDetail {
  name: string;
  reasonText: string | null;
}

function BookedChip({ pulsing }: { pulsing: boolean }) {
  return (
    <motion.span
      animate={pulsing ? { scale: [1, 1.18, 1] } : { scale: 1 }}
      transition={{ duration: 0.3 }}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
    >
      <svg viewBox="0 0 16 16" className="size-3" fill="currentColor" aria-hidden>
        <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
      </svg>
      Booked
    </motion.span>
  );
}

function FactRow<T>({
  label,
  fact,
  render,
}: {
  label: string;
  fact: FactView<T>;
  render: (value: T) => string;
}) {
  return (
    <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
      <span className="font-medium text-zinc-600 dark:text-zinc-300">
        {label}:
      </span>{" "}
      {fact.status === "unknown"
        ? "not recorded"
        : fact.status === "present"
          ? render(fact.value)
          : "not published"}
      {/* Never fetched, so there is nothing to cite — saying "we looked"
          would be the claim the three-valued shape exists to avoid. */}
      {fact.status !== "unknown" && (
        <span className="text-zinc-400 dark:text-zinc-500">
          {" · "}
          {fact.source} · {TIER_LABELS[fact.tier]} · fetched{" "}
          {formatAgo(fact.fetchedAt)}
        </span>
      )}
    </p>
  );
}

/** One collapsed-card chip, three-valued like the fact behind it. */
function FactChip<T>({
  fact,
  render,
  absentLabel,
  unknownLabel,
}: {
  fact: FactView<T>;
  render: (value: T) => string;
  absentLabel: string;
  unknownLabel: string;
}) {
  if (fact.status === "present") {
    return <ProvenanceChip tier={fact.tier}>{render(fact.value)}</ProvenanceChip>;
  }
  if (fact.status === "absent") {
    return (
      <ProvenanceChip tier={fact.tier} absent>
        {absentLabel}
      </ProvenanceChip>
    );
  }
  return <ProvenanceChip tier={null}>{unknownLabel}</ProvenanceChip>;
}

export function SlotCard({
  kind,
  origin,
  startTime,
  endTime,
  place,
  reason,
  alternates,
  role,
  expanded = false,
  refusing = false,
}: {
  kind: SlotKind;
  origin: SlotOrigin;
  /** What this stop is FOR in the day's arc (XXX-35); absent on fixtures. */
  role?: SlotRole;
  startTime: string;
  endTime: string;
  place: PlaceView;
  /** The reason for the CURRENT occupant — the alternate's own line after a swap. */
  reason: Reason | null;
  /** Remaining rotation (what a flick brings next), in order. */
  alternates: AlternateDetail[];
  expanded?: boolean;
  refusing?: boolean;
}) {
  const anchor = origin === "user";
  return (
    <motion.article
      animate={
        refusing
          ? { x: [0, -ANCHOR_WIGGLE_PX, ANCHOR_WIGGLE_PX, 0] }
          : { x: 0 }
      }
      transition={{ duration: 0.28 }}
      className={`rounded-2xl border bg-white p-4 dark:bg-zinc-900 ${
        anchor
          ? "border-2 border-zinc-900 dark:border-zinc-100"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
          {startTime}–{endTime}
          <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
            {formatDuration(slotDurationMinutes(startTime, endTime))}
          </span>
        </span>
        {/* The elected centrepiece is NAMED. The founder's verdict on two
            separate days was "the day isnt anchored on anything", and a
            centre the traveller cannot see is barely a centre. */}
        <span
          className={
            role === "anchor"
              ? "text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-700 dark:text-zinc-200"
              : "text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500"
          }
        >
          {role === "anchor"
            ? "The anchor"
            : kind === "meal"
              ? "Meal"
              : "Activity"}
        </span>
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
          {place.name}
        </h2>
        {anchor && <BookedChip pulsing={refusing} />}
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {place.neighborhood}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <FactChip
          fact={place.priceRange as FactView<PriceRange>}
          render={formatPriceRange}
          absentLabel="Price not published"
          unknownLabel="Price not recorded"
        />
        <FactChip
          fact={place.hoursToday as FactView<string>}
          render={(v) => v}
          absentLabel="Hours not published"
          unknownLabel="Hours not recorded"
        />
      </div>

      {reason && (
        <p className="mt-3 border-l-2 border-violet-300 pl-3 text-sm leading-relaxed text-zinc-600 dark:border-violet-700 dark:text-zinc-300">
          {reason.text}
        </p>
      )}

      {!expanded && alternates.length > 0 && (
        <p className="mt-3 border-t border-zinc-100 pt-2.5 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            {alternates.length} alternate{alternates.length > 1 ? "s" : ""} ready
          </span>
          {" · "}
          {alternates.map((a) => a.name).join(" · ")}
        </p>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <FactRow
                label="Price"
                fact={place.priceRange as FactView<PriceRange>}
                render={formatPriceRange}
              />
              <FactRow
                label="Hours"
                fact={place.hoursToday as FactView<string>}
                render={(v) => v}
              />
              <FactRow
                label="Vibe"
                fact={place.vibe as FactView<string>}
                render={(v) => v}
              />
              {alternates.length > 0 && (
                <div className="pt-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
                    Alternates — flick to swap
                  </p>
                  {alternates.map((a) => (
                    <p
                      key={a.name}
                      className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400"
                    >
                      <span className="font-medium text-zinc-600 dark:text-zinc-300">
                        {a.name}
                      </span>
                      {a.reasonText ? ` — ${a.reasonText}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
