"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import type { PlaceView, Reason, SlotView } from "@/shared/timeline";
import {
  ANCHOR_RUBBER_PX,
  FLICK_DISTANCE_FRACTION,
  FLICK_VELOCITY_PX_S,
  LIFT_SCALE,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_MOUSE_PX,
  LONG_PRESS_SLOP_TOUCH_PX,
} from "./constants";
import { SlotCard, type AlternateDetail } from "./SlotCard";

/**
 * One card, three gestures, arbitrated at the pointer level:
 * - hold still LONG_PRESS_MS → lift; the reorder drag session then starts
 *   from the NEXT live pointermove — never from a stored, stale event
 *   (replaying the 220 ms-old pointerdown died silently on real touch)
 * - move horizontally past the slop first → flick (swap) or anchor rubber
 * - move vertically past the slop first → nothing; the page scrolls
 * - quick press-and-release with no movement → tap (expand provenance)
 *
 * Touch ownership: the cards sit under `touch-action: pan-y`, and the
 * browser evaluates touch-action only at touch-start — CSS alone can never
 * hand a mid-gesture touch to Motion. So once a gesture owns the touch
 * (lift fired, or a horizontal flick committed), a NON-PASSIVE touchmove
 * listener calls preventDefault(), which stops native pan-y scrolling from
 * claiming the touch and firing pointercancel into the drag.
 *
 * The anchor never lifts and never swaps: both attempts get the refusal
 * wiggle + Booked-chip pulse. Refusal must read in under 300 ms.
 *
 * `interactivity: "review"` keeps tap-expand and stands the other two
 * down entirely (Session 10 policy of record). Not because a local-only
 * reorder would imply persistence it lacks — because `reflowDay` is
 * deliberately naive about hours, meal windows and pacing, so a drag can
 * produce a grammar-VIOLATING day that renders with the same authority
 * as the validated one. On a page whose whole purpose is judging whether
 * a day is correct, that corrupts the instrument. E5 is the unlock.
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
  interactivity = "gestures",
  footer,
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
  interactivity?: "gestures" | "review";
  /** Rendered under the card; the timeline stays feedback-agnostic. */
  footer?: ReactNode;
}) {
  const isAnchor = slot.origin === "user";
  const review = interactivity === "review";
  const reorderControls = useDragControls();
  const flickControls = useDragControls();
  const [lifted, setLifted] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const itemRef = useRef<HTMLLIElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number | null>(null);
  const downPoint = useRef<{ x: number; y: number } | null>(null);
  const slopPx = useRef<number>(LONG_PRESS_SLOP_MOUSE_PX);
  const suppressTap = useRef(false);
  const ownsTouch = useRef(false);
  const liftArmed = useRef(false);
  const reorderStarted = useRef(false);

  // The only way to keep a touch once pan-y could claim it (see header).
  useEffect(() => {
    const el = itemRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (ownsTouch.current) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const clearPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const triggerRefusal = () => {
    setRefusing(true);
    window.setTimeout(() => setRefusing(false), 350);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (review) return; // tap still fires; nothing else arms
    downPoint.current = { x: e.clientX, y: e.clientY };
    slopPx.current =
      e.pointerType === "touch"
        ? LONG_PRESS_SLOP_TOUCH_PX
        : LONG_PRESS_SLOP_MOUSE_PX;
    suppressTap.current = false;
    liftArmed.current = false;
    reorderStarted.current = false;
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      suppressTap.current = true;
      if (isAnchor) {
        triggerRefusal();
        return;
      }
      // Lift feedback flips the same frame the threshold fires; the drag
      // session itself starts from the next live pointermove.
      liftArmed.current = true;
      ownsTouch.current = true;
      setLifted(true);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (review) return;
    if (liftArmed.current && !reorderStarted.current) {
      reorderStarted.current = true;
      reorderControls.start(e.nativeEvent);
      return;
    }
    if (!downPoint.current) return;
    const dx = e.clientX - downPoint.current.x;
    const dy = e.clientY - downPoint.current.y;
    if (Math.hypot(dx, dy) <= slopPx.current) return;
    // Moved before the press fired: swipe or scroll, never a lift.
    clearPress();
    downPoint.current = null;
    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal intent: flick (or anchor rubber). Own the touch so a
      // stray vertical wobble can't hand the rest of it to native scroll.
      ownsTouch.current = true;
      flickControls.start(e.nativeEvent);
    }
    // Vertical intent falls through to native scroll (touch-action: pan-y).
  };

  const endPress = () => {
    clearPress();
    downPoint.current = null;
    ownsTouch.current = false;
    // Lifted but never moved: no drag session exists to end, so unlift here.
    if (liftArmed.current && !reorderStarted.current) {
      liftArmed.current = false;
      setLifted(false);
    }
  };

  return (
    <Reorder.Item
      ref={itemRef}
      value={slot.id}
      dragListener={false}
      dragControls={reorderControls}
      onDragEnd={() => {
        liftArmed.current = false;
        ownsTouch.current = false;
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
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onContextMenu={(e) => e.preventDefault()}
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
          drag={review ? false : isAnchor ? "x" : lifted ? false : "x"}
          dragListener={false}
          dragControls={flickControls}
          dragSnapToOrigin
          dragConstraints={
            isAnchor
              ? { left: -ANCHOR_RUBBER_PX, right: ANCHOR_RUBBER_PX }
              : undefined
          }
          dragElastic={isAnchor ? 0.05 : 0.7}
          style={{ touchAction: "pan-y" }}
          onDragEnd={(_, info) => {
            ownsTouch.current = false;
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
          {footer}
        </motion.div>
      </AnimatePresence>
    </Reorder.Item>
  );
}
