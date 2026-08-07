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
