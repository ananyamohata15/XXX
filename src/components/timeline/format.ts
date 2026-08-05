import type { PriceRange } from "@/shared/timeline";
import { timeToMinutes } from "@/shared/timeline";
import type { TransportMode } from "@/shared/vocabulary";

/** Display-only helpers for the timeline. Pure; no domain logic. */

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function slotDurationMinutes(startTime: string, endTime: string): number {
  return timeToMinutes(endTime) - timeToMinutes(startTime);
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CAD: "$",
  GBP: "£",
  INR: "₹",
};

/** Known-free renders as "Free"; a point price as one number; else a range. */
export function formatPriceRange(p: PriceRange): string {
  if (p.min === 0 && p.max === 0) return "Free";
  const symbol = CURRENCY_SYMBOLS[p.currency] ?? `${p.currency} `;
  if (p.min === p.max) return `${symbol}${p.max}`;
  return `${symbol}${p.min}–${p.max}`;
}

export const MODE_GLYPH: Record<TransportMode, string> = {
  walk: "🚶",
  cycle: "🚲",
  drive: "🚗",
  transit: "🚇",
};

export const MODE_LABEL: Record<TransportMode, string> = {
  walk: "Walk",
  cycle: "Cycle",
  drive: "Drive",
  transit: "Transit",
};

export function formatDayDate(isoDate: string): string {
  // Noon avoids timezone edge-shifts when formatting a date-only value.
  const d = new Date(`${isoDate}T12:00:00`);
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
}
