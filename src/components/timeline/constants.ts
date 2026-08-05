/**
 * Gesture + display tunables (XXX-19). Named constants so the kill-gate
 * review can tune them live — change a number, HMR, feel again.
 */

/** Approved starting range 200–250 ms. The lift must feel instant AT the
 *  threshold — scale + shadow flip the same frame the timer fires. */
export const LONG_PRESS_MS = 220;

/** Finger drift beyond this cancels the press (it's a scroll or a swipe). */
export const LONG_PRESS_SLOP_PX = 8;

export const LIFT_SCALE = 1.03;

/** Horizontal travel (fraction of card width) that commits a swap. */
export const FLICK_DISTANCE_FRACTION = 0.4;

/** Release velocity (px/s) that commits a swap regardless of distance. */
export const FLICK_VELOCITY_PX_S = 500;

/** The anchor gives this much against a heavy rubber band, then refuses. */
export const ANCHOR_RUBBER_PX = 8;

export const ANCHOR_WIGGLE_PX = 3;

/** Gaps shorter than this are travel slack, not free time worth naming. */
export const FREE_TIME_THRESHOLD_MINUTES = 30;
