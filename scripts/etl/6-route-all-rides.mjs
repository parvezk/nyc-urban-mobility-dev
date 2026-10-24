/**
 * 6-route-all-rides.mjs
 *
 * ETL Stage 6: route EVERY ride of the day (not the 6k sample) and write a
 * compact binary the app can stream hour by hour.
 *
 *   node scripts/etl/6-route-all-rides.mjs --date 2026-09-23
 *
 * Needs the month's CSVs (Stage 0) and an OSRM bicycle server (OSRM_BASE).
 *
 * Output: public/data/days/<date>/rides/
 *   manifest.json  { format:"cbr1", date, dayStartEpochMs, totalRides,
 *                    fallbackRides, hours:[{ hour, rides, bytes }] }
 *   HH.bin.gz      gzipped, one per start hour (NY local), HH = 00..23
 *
 * HH.bin layout (little-endian), format "cbr1":
 *   char[4]  magic "CBR1"
 *   uint32   rideCount
 *   per ride:
 *     uint8  flags      bit0 = electric bike, bit1 = annual member
 *     uint8  n          number of points (2..255)
 *     uint32 startSec   seconds since local midnight (dayStartEpochMs)
 *     int32  lng0, lat0 first point, 1e-5 degrees
 *     (n-1) × { int16 dLng, int16 dLat (1e-5 deg, from previous point),
 *               uint16 dtSec (seconds from previous point) }
 *
 * Paths are OSRM bicycle routes simplified with Douglas-Peucker (~12 m,
 * at most MAX_POINTS points); the ride's real duration is spread along the
 * path by distance. Routes are cached per start/end coordinate pair, so
 * station-to-station repeats (most classic-bike rides) cost one request.
 * If OSRM can't route a ride it is kept as a straight line and counted in
 * fallbackRides, so the totals always match the real day.
 */
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { nyWallClockToEpochMs } from './lib/ny-time.mjs';
import { csvGlob, dayDir, monthOf, parseArgs, requireDate, tripFilterSql } from './lib/paths.mjs';

import { SCOPE, rideInScope } from './lib/scope.mjs';

const OSRM_BASE = process.env.OSRM_BASE || 'http://localhost:5000/route/v1/bicycle';
const CONCURRENCY = Number.parseInt(process.env.OSRM_CONCURRENCY, 10) || 32;
const TOLERANCE_M = 12;
const MAX_POINTS = 24;
const MAX_FALLBACK_RATE = 0.1;

const DAY = requireDate(parseArgs());
const CSV_GLOB = csvGlob(monthOf(DAY));
const OUT_DIR = path.join(dayDir(DAY), 'rides');

const bn = (v) => (typeof v === 'bigint' ? Number(v) : v);

async function loadRides() {
    const con = await DuckDBConnection.create(await DuckDBInstance.create(':memory:'));
    const reader = await con.runAndReadAll(`
        SELECT rideable_type = 'electric_bike'                  AS electric,
               member_casual = 'member'                         AS member,
               strftime(started_at, '%Y-%m-%dT%H:%M:%S.%g')     AS started_at,
               strftime(ended_at,   '%Y-%m-%dT%H:%M:%S.%g')     AS ended_at,
               start_lng, start_lat, end_lng, end_lat
        FROM read_csv_auto('${CSV_GLOB}', union_by_name=true)
        WHERE ${tripFilterSql(DAY)}
        ORDER BY started_at
    `);
    return reader.getRowObjects()
        .filter((r) => rideInScope(bn(r.start_lng), bn(r.start_lat), bn(r.end_lng), bn(r.end_lat)))
        .map((r) => ({
        electric: Boolean(r.electric),
        member: Boolean(r.member),
        startMs: nyWallClockToEpochMs(String(r.started_at)),
        endMs: nyWallClockToEpochMs(String(r.ended_at)),
        a: [bn(r.start_lng), bn(r.start_lat)],
        b: [bn(r.end_lng), bn(r.end_lat)],
    }));
}

// --- geometry ---------------------------------------------------------------
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((40.73 * Math.PI) / 180);
const toXY = ([lng, lat]) => [lng * M_PER_DEG_LNG, lat * M_PER_DEG_LAT];

function segDistSq(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return x * x + y * y;
}

// Douglas-Peucker on lng/lat, tolerance in metres.
function simplify(coords, tolM) {
    if (coords.length <= 2) return coords;
    const xy = coords.map(toXY);
    const keep = new Uint8Array(coords.length);
    keep[0] = keep[coords.length - 1] = 1;
    const stack = [[0, coords.length - 1]];
    const tolSq = tolM * tolM;
    while (stack.length) {
        const [s, e] = stack.pop();
        let maxD = -1, idx = -1;
        for (let i = s + 1; i < e; i++) {
            const d = segDistSq(xy[i], xy[s], xy[e]);
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > tolSq) {
            keep[idx] = 1;
            stack.push([s, idx], [idx, e]);
        }
    }
    return coords.filter((_, i) => keep[i]);
}

function simplifyCapped(coords) {
    let tol = TOLERANCE_M;
    let out = simplify(coords, tol);
    while (out.length > MAX_POINTS) {
        tol *= 1.5;
        out = simplify(coords, tol);
    }
    return out;
}

// Quantise to 1e-5 deg ints and split any segment whose delta would overflow int16.
function quantise(coords) {
    const q = coords.map(([lng, lat]) => [Math.round(lng * 1e5), Math.round(lat * 1e5)]);
    const out = [q[0]];
    for (let i = 1; i < q.length; i++) {
        const prev = out[out.length - 1];
        const dx = q[i][0] - prev[0], dy = q[i][1] - prev[1];
        const parts = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 32000) || 1;
        for (let k = 1; k <= parts; k++) {
            out.push([prev[0] + Math.round((dx * k) / parts), prev[1] + Math.round((dy * k) / parts)]);
        }
    }
    // Drop consecutive duplicates (zero-length segments), keeping at least 2 points.
    const dedup = out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
    return dedup.length >= 2 ? dedup : [out[0], out[out.length - 1]];
}

// --- routing ----------------------------------------------------------------
const routeCache = new Map(); // "lng,lat;lng,lat" -> quantised path, or null
let osrmCalls = 0;

async function route(a, b) {
    const key = `${a[0].toFixed(5)},${a[1].toFixed(5)};${b[0].toFixed(5)},${b[1].toFixed(5)}`;
    if (routeCache.has(key)) return routeCache.get(key);
    let result = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            osrmCalls++;
            const res = await fetch(`${OSRM_BASE}/${key}?overview=full&geometries=geojson`);
            const data = await res.json();
            if (data.code === 'Ok' && data.routes?.length) {
                result = quantise(simplifyCapped(data.routes[0].geometry.coordinates));
            }
            break;
        } catch (err) {
            if (attempt === 3) console.error(`OSRM request failed: ${err.message}`);
            else await new Promise((r) => setTimeout(r, 300 * attempt));
        }
    }
    routeCache.set(key, result);
    return result;
}

// Seconds from the start for each point, spread by distance along the path.
function pointTimes(q, startSec, durSec) {
    const cum = [0];
    for (let i = 1; i < q.length; i++) {
        const dx = (q[i][0] - q[i - 1][0]) * 1e-5 * M_PER_DEG_LNG;
        const dy = (q[i][1] - q[i - 1][1]) * 1e-5 * M_PER_DEG_LAT;
        cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    const total = cum[cum.length - 1] || 1;
    return cum.map((d) => Math.round(startSec + (durSec * d) / total));
}

function encodeRide(ride, q, dayStartMs) {
    const startSec = Math.floor((ride.startMs - dayStartMs) / 1000); // floor: 23:59:59.6 must stay in hour 23
    const durSec = Math.max(1, Math.round((ride.endMs - ride.startMs) / 1000));
    const times = pointTimes(q, startSec, durSec);
    const n = q.length;
    const buf = Buffer.alloc(14 + (n - 1) * 6);
    let o = 0;
    buf.writeUInt8((ride.electric ? 1 : 0) | (ride.member ? 2 : 0), o); o += 1;
    buf.writeUInt8(n, o); o += 1;
    buf.writeUInt32LE(startSec, o); o += 4;
    buf.writeInt32LE(q[0][0], o); o += 4;
    buf.writeInt32LE(q[0][1], o); o += 4;
    for (let i = 1; i < n; i++) {
        buf.writeInt16LE(q[i][0] - q[i - 1][0], o); o += 2;
        buf.writeInt16LE(q[i][1] - q[i - 1][1], o); o += 2;
        buf.writeUInt16LE(Math.min(65535, times[i] - times[i - 1]), o); o += 2;
    }
    return { hour: Math.floor(startSec / 3600), buf };
}

async function main() {
    const dayStartMs = nyWallClockToEpochMs(`${DAY}T00:00:00.000`);
    console.log(`🦆 Loading every filtered ride on ${DAY} ...`);
    const rides = await loadRides();
    if (!rides.length) throw new Error(`❌ No rides for ${DAY}. Did Stage 0 download that month?`);
    console.log(`   ${rides.length} rides start or end in ${SCOPE}`);

    const encoded = new Array(rides.length);
    let fallback = 0, next = 0, done = 0;
    const t0 = Date.now();
    const worker = async () => {
        while (next < rides.length) {
            const i = next++;
            const ride = rides[i];
            let q = await route(ride.a, ride.b);
            if (!q) {
                fallback++;
                q = quantise([ride.a, ride.b]);
            }
            encoded[i] = encodeRide(ride, q, dayStartMs);
            if (++done % 20000 === 0) {
                console.log(`[Progress] ${done}/${rides.length}  (${osrmCalls} OSRM calls, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
            }
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const rate = fallback / rides.length;
    console.log(`✅ Routed ${rides.length} rides with ${osrmCalls} OSRM calls; ${fallback} straight-line fallbacks (${(rate * 100).toFixed(2)}%)`);
    if (rate > MAX_FALLBACK_RATE) {
        throw new Error(`❌ ${(rate * 100).toFixed(1)}% of rides could not be routed. Is OSRM up at ${OSRM_BASE}?`);
    }

    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const hours = [];
    let rawTotal = 0, gzTotal = 0;
    for (let hour = 0; hour < 24; hour++) {
        const items = encoded.filter((e) => e.hour === hour);
        const header = Buffer.alloc(8);
        header.write('CBR1', 0, 'ascii');
        header.writeUInt32LE(items.length, 4);
        const raw = Buffer.concat([header, ...items.map((e) => e.buf)]);
        const gz = zlib.gzipSync(raw, { level: 9 });
        fs.writeFileSync(path.join(OUT_DIR, `${String(hour).padStart(2, '0')}.bin.gz`), gz);
        hours.push({ hour, rides: items.length, bytes: gz.length });
        rawTotal += raw.length;
        gzTotal += gz.length;
    }
    const manifest = {
        format: 'cbr1',
        scope: SCOPE,
        date: DAY,
        dayStartEpochMs: dayStartMs,
        totalRides: rides.length,
        fallbackRides: fallback,
        hours,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const biggest = hours.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    console.log(`💾 ${OUT_DIR}: ${(rawTotal / 1e6).toFixed(1)} MB raw, ${(gzTotal / 1e6).toFixed(1)} MB gzipped; ` +
        `largest chunk ${String(biggest.hour).padStart(2, '0')}h = ${(biggest.bytes / 1e6).toFixed(2)} MB (${biggest.rides} rides)`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
