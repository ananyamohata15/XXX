/**
 * The 30-day coordinate retention ceiling (SST §14.3, decision doc 001).
 *
 * Two layers enforce it: the XXX-25 sweep deletes expired values in the
 * database, and every read path calls coordsExpired() so a late sweep can
 * never cause an over-retention read. Pure; unit-tested at the boundary.
 */

export const COORDS_TTL_DAYS = 30;

const TTL_MS = COORDS_TTL_DAYS * 24 * 60 * 60 * 1000;

/** True once coords_fetched_at is 30 or more consecutive days in the past. */
export function coordsExpired(coordsFetchedAt: string, now: Date): boolean {
  return now.getTime() - new Date(coordsFetchedAt).getTime() >= TTL_MS;
}

/** The columns the sweep predicate reads; any row shape carrying them works. */
export interface SweepPredicateRow {
  coords_status: string;
  coords_fetched_at: string | null;
}

/**
 * Pure mirror of the SQL sweep predicate in sweep_expired_coords()
 * (migration 20260806200000): status 'present' AND fetched_at >= 30 days
 * old. Used by ttl-sweep --status previews and fixture-tested against the
 * same boundary as coordsExpired so the two layers cannot drift silently.
 */
export function sweepWouldExpire(row: SweepPredicateRow, now: Date): boolean {
  return (
    row.coords_status === "present" &&
    row.coords_fetched_at !== null &&
    coordsExpired(row.coords_fetched_at, now)
  );
}

/**
 * True when the row's 30-day deadline falls within the next `days` days
 * (already-expired counts too). Mirrors the sweep's expiring_within_7d
 * metadata; feeds the re-discovery human-trigger warning.
 */
export function expiresWithinDays(
  row: SweepPredicateRow,
  now: Date,
  days: number,
): boolean {
  if (row.coords_status !== "present" || row.coords_fetched_at === null) {
    return false;
  }
  const deadline = new Date(row.coords_fetched_at).getTime() + TTL_MS;
  return deadline - now.getTime() <= days * 24 * 60 * 60 * 1000;
}
