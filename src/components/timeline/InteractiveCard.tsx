"use client";

import { useRef, useState } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import type { PlaceView, Reason, SlotView } from "@/shared/timeline";
import {
  ANCHOR_RUBBER_PX,
  FLICK_DISTANCE_FRACTION,
  FLICK_VELOCITY_PX_S,
  LIFT_SCALE,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
} from "./constants";
import { SlotCard, type AlternateDetail } from "./SlotCard";

/**
 * One card, three gestures, arbitrated at the pointer level:
 * - hold still LONG_PRESS_MS → lift (vertical reorder via Reorder.Item)
 * - move horizontally past the slop first → flick (swap) or anchor rubber
 * - move vertically past the slop first → nothing; the page scrolls
 * - quick press-and-release with no movement → tap (expand provenance)
 * The anchor never lifts and never swaps: both attempts get the refusal
 * wiggle + Booked-chip pulse. Refusal must read in under 300 ms.
 */
export function InteractiveCard({
  slot,
  occupant,
  startTime,
  endTime,
  reason,
  alternates,
  expanded,
  onToggleExpand,
  onSwap,
  onDragSettled,
  swapDir,
}: {
  slot: SlotView;
  occupant: PlaceView;
  startTime: string;
  endTime: string;
  reason: Reason | null;
  alternates: AlternateDetail[];
  expanded: boolean;
  onToggleExpand: () => void;
  onSwap: (dir: 1 | -1) => void;
  onDragSettled: () => void;
  swapDir: 1 | -1;
}) {
  const isAnchor = slot.origin === "user";
  const reorderControls = useDragControls();
  const flickControls = useDragControls();
  const [lifted, setLifted] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number | null>(null);
  const downEvent = useRef<PointerEvent | null>(null);
  const downPoint = useRef<{ x: number; y: number } | null>(null);
  const suppressTap = useRef(false);

  const clearPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const triggerRefusal = () => {
    setRefusing(true);
    window.setTimeout(() => setRefusing(false), 350);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    downEvent.current = e.nativeEvent;
    downPoint.current = { x: e.clientX, y: e.clientY };
    suppressTap.current = false;
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      downPoint.current = null;
      suppressTap.current = true;
      if (isAnchor) {
        triggerRefusal();
        return;
      }
      // Lift feedback flips the same frame the threshold fires.
      setLifted(true);
      if (downEvent.current) reorderControls.start(downEvent.current);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!downPoint.current) return;
    const dx = e.clientX - downPoint.current.x;
    const dy = e.clientY - downPoint.current.y;
    if (Math.hypot(dx, dy) <= LONG_PRESS_SLOP_PX) return;
    // Moved before the press fired: swipe or scroll, never a lift.
    clearPress();
    downPoint.current = null;
    if (Math.abs(dx) > Math.abs(dy)) flickControls.start(e.nativeEvent);
    // Vertical intent falls through to native scroll (touch-action: pan-y).
  };

  const endPress = () => {
    clearPress();
    downPoint.current = null;
  };

  return (
    <Reorder.Item
      value={slot.id}
      dragListener={false}
      dragControls={reorderControls}
      onDragEnd={() => {
        setLifted(false);
        onDragSettled();
      }}
      animate={{
        scale: lifted ? LIFT_SCALE : 1,
        boxShadow: lifted
          ? "0 16px 40px rgba(0, 0, 0, 0.22)"
          : "0 1px 2px rgba(0, 0, 0, 0.05)",
      }}
      transition={{ duration: 0.15 }}
      style={{
        position: "relative",
        zIndex: lifted ? 20 : undefined,
        touchAction: "pan-y",
        borderRadius: 16,
        listStyle: "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
    >
      <AnimatePresence initial={false} custom={swapDir} mode="popLayout">
        <motion.div
          key={occupant.id}
          ref={cardRef}
          custom={swapDir}
          variants={{
            enter: (dir: 1 | -1) => ({ x: `${-dir * 110}%`, opacity: 1 }),
            center: { x: 0, opacity: 1 },
            exit: (dir: 1 | -1) => ({ x: `${dir * 110}%`, opacity: 0.9 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: "spring", stiffness: 420, damping: 40 }}
          drag={isAnchor ? "x" : lifted ? false : "x"}
          dragListener={false}
          dragControls={flickControls}
          dragSnapToOrigin
          dragConstraints={
            isAnchor
              ? { left: -ANCHOR_RUBBER_PX, right: ANCHOR_RUBBER_PX }
              : undefined
          }
          dragElastic={isAnchor ? 0.05 : 0.7}
          onDragEnd={(_, info) => {
            if (isAnchor) {
              if (Math.abs(info.offset.x) > 2) triggerRefusal();
              return;
            }
            const width = cardRef.current?.offsetWidth ?? 360;
            if (
              Math.abs(info.offset.x) > width * FLICK_DISTANCE_FRACTION ||
              Math.abs(info.velocity.x) > FLICK_VELOCITY_PX_S
            ) {
              onSwap(info.offset.x < 0 ? -1 : 1);
            }
          }}
          onTap={() => {
            if (suppressTap.current) {
              suppressTap.current = false;
              return;
            }
            onToggleExpand();
          }}
        >
          <SlotCard
            kind={slot.kind}
            origin={slot.origin}
            startTime={startTime}
            endTime={endTime}
            place={occupant}
            reason={reason}
            alternates={alternates}
            expanded={expanded}
            refusing={refusing}
          />
        </motion.div>
      </AnimatePresence>
    </Reorder.Item>
  );
}
