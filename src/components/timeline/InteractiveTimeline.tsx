"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Reorder } from "motion/react";
import {
  lookupTravel,
  reflowDay,
  timeToMinutes,
  type PlaceView,
  type Reason,
  type SlotView,
  type TimelineDay,
} from "@/shared/timeline";
import { CITY_LABELS } from "@/shared/vocabulary";
import { FREE_TIME_THRESHOLD_MINUTES } from "./constants";
import { InteractiveCard } from "./InteractiveCard";
import { TravelSegment } from "./TravelSegment";
import { formatDayDate } from "./format";

interface SlotTimes {
  startTime: string;
  endTime: string;
}

/**
 * The stateful board (XXX-19). State it owns:
 * - orderIds: visual order; live-updated during a lift-drag, re-canonicalized
 *   by reflowDay on release (which may slide a colliding slot past the anchor)
 * - rotations: per-slot occupant cycle; a flick moves the front card to the
 *   back — a decision, not a deletion (and in the real product, a taste signal)
 * - times: current display times, from the last reflow (fixture times at load —
 *   the authored day keeps its buffers until the user touches it)
 * All recomputation is the pure reflowDay; this component only holds state.
 */
export function InteractiveTimeline({
  day,
  interactivity = "gestures",
  renderSlotFooter,
  footerNote,
}: {
  day: TimelineDay;
  /** "review" = tap-expand only; see InteractiveCard for the argument. */
  interactivity?: "gestures" | "review";
  /**
   * A rendering seam, not a vocabulary one: the tasting room hangs its
   * verdict controls here so src/components/timeline never learns the
   * words "evidence" or "taste".
   */
  renderSlotFooter?: (slot: SlotView) => ReactNode;
  /** Replaces the prototype's provenance line (attribution lives here). */
  footerNote?: ReactNode;
}) {
  const slotById = useMemo(
    () => new Map(day.slots.map((s) => [s.id, s])),
    [day],
  );
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    day.slots.map((s) => s.id),
  );
  const [rotations, setRotations] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      day.slots.map((s) => [
        s.id,
        [s.placeId, ...s.alternates.map((a) => a.placeId)],
      ]),
    ),
  );
  const [times, setTimes] = useState<Record<string, SlotTimes>>(() =>
    Object.fromEntries(
      day.slots.map((s) => [
        s.id,
        { startTime: s.startTime, endTime: s.endTime },
      ]),
    ),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overrunMinutes, setOverrunMinutes] = useState(0);
  const [swapDirs, setSwapDirs] = useState<Record<string, 1 | -1>>({});

  const baseSlot = (id: string): SlotView => {
    const s = slotById.get(id);
    if (!s) throw new Error(`fixture invariant broken: unknown slot "${id}"`);
    return s;
  };
  const place = (id: string): PlaceView => {
    const p = day.places[id];
    if (!p) throw new Error(`fixture invariant broken: unknown place "${id}"`);
    return p;
  };
  const occupantOf = (slotId: string): string =>
    (rotations[slotId] ?? [baseSlot(slotId).placeId])[0];

  /** The reason shown belongs to the current occupant, not the slot. */
  const reasonFor = (slotId: string, placeId: string): Reason | null => {
    const s = baseSlot(slotId);
    if (placeId === s.placeId) return s.reason;
    return s.alternates.find((a) => a.placeId === placeId)?.reason ?? null;
  };

  const commitReflow = (ids: string[], rot: Record<string, string[]>) => {
    const input = ids.map((id) => ({
      ...baseSlot(id),
      placeId: (rot[id] ?? [baseSlot(id).placeId])[0],
    }));
    const result = reflowDay(input, day.travel, day.dayStart);
    setOrderIds(result.slots.map((s) => s.slotId));
    setTimes(
      Object.fromEntries(
        result.slots.map((s) => [
          s.slotId,
          { startTime: s.startTime, endTime: s.endTime },
        ]),
      ),
    );
    setOverrunMinutes(result.anchorOverrunMinutes);
  };

  const handleSwap = (slotId: string, dir: 1 | -1) => {
    const rot = rotations[slotId];
    if (!rot || rot.length < 2) return;
    const nextRotations = {
      ...rotations,
      [slotId]: [...rot.slice(1), rot[0]],
    };
    setSwapDirs((d) => ({ ...d, [slotId]: dir }));
    setRotations(nextRotations);
    commitReflow(orderIds, nextRotations);
  };

  const first = times[orderIds[0]];
  const last = times[orderIds[orderIds.length - 1]];

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-16 pt-8">
      <header className="mb-6 px-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
          {CITY_LABELS[day.city]}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {formatDayDate(day.date)}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {day.slots.length} stops · {first?.startTime}–{last?.endTime}
        </p>
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          {interactivity === "gestures"
            ? "Hold to move · flick sideways to swap · tap for provenance"
            : "Tap a card for provenance · reordering and swapping arrive with E5 — this is the day exactly as the engine produced it"}
        </p>
      </header>

      <Reorder.Group
        as="ol"
        axis="y"
        values={orderIds}
        onReorder={setOrderIds}
        className="flex flex-col"
      >
        {orderIds.map((slotId, i) => {
          const s = baseSlot(slotId);
          const occupantId = occupantOf(slotId);
          const t = times[slotId] ?? {
            startTime: s.startTime,
            endTime: s.endTime,
          };
          const nextId: string | undefined = orderIds[i + 1];
          const leg = nextId
            ? lookupTravel(day.travel, occupantId, occupantOf(nextId))
            : null;
          const nextT = nextId ? times[nextId] : null;
          const gapMinutes = nextT
            ? timeToMinutes(nextT.startTime) -
              timeToMinutes(t.endTime) -
              (leg?.minutes ?? 0)
            : 0;
          const nextIsAnchor = nextId
            ? baseSlot(nextId).origin === "user"
            : false;
          const remaining = (rotations[slotId] ?? []).slice(1);

          return (
            <Fragment key={slotId}>
              <InteractiveCard
                slot={s}
                occupant={place(occupantId)}
                startTime={t.startTime}
                endTime={t.endTime}
                reason={reasonFor(slotId, occupantId)}
                alternates={remaining.map((pid) => ({
                  name: place(pid).name,
                  reasonText: reasonFor(slotId, pid)?.text ?? null,
                }))}
                expanded={expandedId === slotId}
                onToggleExpand={() =>
                  setExpandedId((cur) => (cur === slotId ? null : slotId))
                }
                onSwap={(dir) => handleSwap(slotId, dir)}
                onDragSettled={() => commitReflow(orderIds, rotations)}
                swapDir={swapDirs[slotId] ?? 1}
                interactivity={interactivity}
                footer={renderSlotFooter?.(s)}
              />
              {nextId && (
                <li className="list-none">
                  <TravelSegment
                    leg={leg}
                    freeMinutes={
                      gapMinutes >= FREE_TIME_THRESHOLD_MINUTES
                        ? gapMinutes
                        : 0
                    }
                  />
                  {nextIsAnchor && overrunMinutes > 0 && (
                    <p className="pb-1.5 text-center text-xs font-medium text-amber-600 dark:text-amber-400">
                      Arrives {overrunMinutes} min after the booking
                    </p>
                  )}
                </li>
              )}
            </Fragment>
          );
        })}
      </Reorder.Group>

      <footer className="mt-8 space-y-2 px-1 text-xs text-zinc-400 dark:text-zinc-500">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            Verified
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
            Observed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-violet-500" aria-hidden />
            Judgment
          </span>
        </p>
        {footerNote ?? (
          <p>
            Travel times: Google Routes (fixture). Prototype — hand-authored
            data, nothing fetched.
          </p>
        )}
      </footer>
    </div>
  );
}
