// Manhattan scope: which rides count, where the camera may go, and the
// mask that fades everything off the island.

import { MANHATTAN_CATCH, MANHATTAN_ISLAND, type Ring } from './manhattanShape';
import type { MapFocus } from '@/lib/lighting/mapLook';

interface Box { w: number; s: number; e: number; n: number }

const boxOf = (ring: Ring): Box => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return { w, s, e, n };
};

const CATCH = MANHATTAN_CATCH.map(ring => ({ ring, box: boxOf(ring) }));

// Even-odd ray cast.
function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// True for a point on Manhattan (or within ~70 m of its shore, for waterfront docks).
export function inManhattan(lng: number, lat: number): boolean {
  for (const { ring, box } of CATCH) {
    if (lng < box.w || lng > box.e || lat < box.s || lat > box.n) continue;
    if (inRing(lng, lat, ring)) return true;
  }
  return false;
}

// A ride belongs to the Manhattan story if it starts or ends there.
export const rideTouchesManhattan = (x0: number, y0: number, x1: number, y1: number) =>
  inManhattan(x0, y0) || inManhattan(x1, y1);

// Camera limits: the island plus a margin for the rivers and pitched views.
export const MANHATTAN_VIEW_BOUNDS = { minLng: -74.06, maxLng: -73.88, minLat: 40.68, maxLat: 40.885 };
export const MANHATTAN_MIN_ZOOM = 11.3;

// The world with Manhattan cut out (outer ring first, island rings as holes),
// its outline, and the area whose labels stay.
export const MANHATTAN_FOCUS: MapFocus = {
  mask: [[
    [[-75, 40.2], [-73, 40.2], [-73, 41.4], [-75, 41.4], [-75, 40.2]],
    ...MANHATTAN_ISLAND.map(r => [...r].reverse() as Ring),
  ]],
  outline: MANHATTAN_ISLAND,
  area: MANHATTAN_CATCH,
};
