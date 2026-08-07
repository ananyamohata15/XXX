/**
 * Distance shortlisting for identity matching (SESSION_NOTES 2.3). Pairwise
 * haversine distance, not polygon containment — the no-point-in-polygon
 * constraint (decision 001) is about deriving area membership from Google
 * coordinates, which nothing here does.
 */

export const MATCH_RADIUS_M = 100;

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export interface GridPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Cell size ≈ 220 m of latitude — one ring of neighbors covers 100 m. */
const CELL_DEG = 0.002;

export interface ProximityGrid {
  /** Points within radiusM of (lat, lng), nearest first. */
  near(lat: number, lng: number, radiusM: number): (GridPoint & { distanceM: number })[];
}

export function buildGrid(points: GridPoint[]): ProximityGrid {
  const cells = new Map<string, GridPoint[]>();
  const keyOf = (lat: number, lng: number) =>
    `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
  for (const p of points) {
    const key = keyOf(p.lat, p.lng);
    const cell = cells.get(key);
    if (cell) cell.push(p);
    else cells.set(key, [p]);
  }
  return {
    near(lat, lng, radiusM) {
      const row = Math.floor(lat / CELL_DEG);
      const col = Math.floor(lng / CELL_DEG);
      const out: (GridPoint & { distanceM: number })[] = [];
      for (let r = row - 1; r <= row + 1; r++) {
        for (let c = col - 1; c <= col + 1; c++) {
          for (const p of cells.get(`${r}:${c}`) ?? []) {
            const distanceM = haversineMeters(lat, lng, p.lat, p.lng);
            if (distanceM <= radiusM) out.push({ ...p, distanceM });
          }
        }
      }
      return out.sort((a, b) => a.distanceM - b.distanceM);
    },
  };
}
