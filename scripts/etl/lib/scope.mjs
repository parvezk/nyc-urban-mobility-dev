/**
 * scope.mjs: which rides the map shows.
 *
 * The app shows Manhattan only. A ride is kept when its start OR end is inside
 * the "Manhattan catch area": the borough boundary buffered ~70 m so waterfront
 * stations count (same polygon the map uses, /mnt/project-files/geo/manhattan.geojson).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPE = 'manhattan';

const here = path.dirname(fileURLToPath(import.meta.url));
const feature = JSON.parse(fs.readFileSync(path.join(here, 'manhattan-catch.geojson'), 'utf8'));
const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;

// Bounding box for a cheap first test.
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const poly of polygons) for (const [x, y] of poly[0]) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}

function inRing(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

const cache = new Map();
export function inManhattan(lng, lat) {
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) return false;
    const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    let hit = cache.get(key);
    if (hit === undefined) {
        hit = polygons.some((poly) => inRing(poly[0], lng, lat) && !poly.slice(1).some((hole) => inRing(hole, lng, lat)));
        cache.set(key, hit);
    }
    return hit;
}

export const rideInScope = (startLng, startLat, endLng, endLat) =>
    inManhattan(startLng, startLat) || inManhattan(endLng, endLat);
