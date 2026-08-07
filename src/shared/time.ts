/**
 * Local wall-clock time helpers — the dependency-free core (XXX-5).
 *
 * These lived in timeline.ts, which builds Zod schemas at module scope; a
 * value-import of the helpers from there pulls Zod into any bundle that
 * touches them. The day-grammar validator is meant to run in the browser
 * for E5's optimistic edit feedback, so it needs these without that
 * weight. timeline.ts re-exports them, so existing importers are unchanged
 * (the same move vocabulary.ts made for the domain constant sets).
 *
 * All times are city-local "HH:MM". Same-day lexical comparison is exact,
 * so ranges use plain string comparison wherever minutes are not needed.
 */

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
