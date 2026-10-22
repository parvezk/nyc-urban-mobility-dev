/**
 * landmarks.mjs: the places the "Places" feature can fly to.
 *
 * Coordinates are the public square / building centre. Rides that start or
 * end within RADIUS_M of a place count toward it (once per ride).
 */
export const RADIUS_M = 300;

export const LANDMARKS = [
    { id: 'times-square', name: 'Times Square', lng: -73.98552, lat: 40.75800 },
    { id: 'columbus-circle', name: 'Columbus Circle', lng: -73.98190, lat: 40.76810 },
    { id: 'madison-square-garden', name: 'Madison Square Garden', lng: -73.99340, lat: 40.75050 },
    { id: 'herald-square', name: 'Herald Square', lng: -73.98770, lat: 40.74970 },
    { id: 'union-square', name: 'Union Square', lng: -73.99060, lat: 40.73590 },
    { id: 'washington-square-park', name: 'Washington Square Park', lng: -73.99730, lat: 40.73080 },
    { id: 'world-trade-center', name: 'World Trade Center', lng: -74.01320, lat: 40.71270 },
];

// Equirectangular distance in metres; plenty accurate at a few hundred metres.
export function metresBetween(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
    const y = (lat2 - lat1) * rad;
    return Math.sqrt(x * x + y * y) * 6371008.8;
}
