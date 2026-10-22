/**
 * 2-osrm-routing.mjs
 *
 * ETL Stage 2: route each sampled ride along streets.
 *
 *   node scripts/etl/2-osrm-routing.mjs --date 2026-09-16
 *
 * Takes the start/end points from Stage 1 and asks an OSRM server (bicycle
 * profile) for the street path, then spreads the ride's real duration along
 * that path as per-vertex timestamps for Deck.gl's TripsLayer.
 *
 * Input : scripts/etl/work/<date>/centroids.json
 * Output: public/data/days/<date>/trips.json
 *   [{ vendor_type, member, path:[[lng, lat, epochMs], …] }]
 *
 * OSRM runs in Docker (GitHub Actions in production, see
 * .github/workflows/citibike-etl.yml). Override the URL with OSRM_BASE.
 */
import fs from 'fs';
import path from 'path';
import { nyWallClockToEpochMs } from './lib/ny-time.mjs';
import { dayDir, parseArgs, requireDate, workDir } from './lib/paths.mjs';

const OSRM_BASE = process.env.OSRM_BASE || "http://localhost:5000/route/v1/bicycle";
// Parallel requests to the local OSRM server.
const CONCURRENCY = Number.parseInt(process.env.OSRM_CONCURRENCY, 10) || 16;
// Fail the run if fewer than this share of rides could be routed.
const MIN_SUCCESS_RATE = 0.9;

const DAY = requireDate(parseArgs());
const IN_PATH = path.join(workDir(DAY), 'centroids.json');
const OUT_PATH = path.join(dayDir(DAY), 'trips.json');

// Route one ride. Returns the Deck.gl trip object, or null if OSRM found no path.
async function routeTrip(trip) {
    if (!trip.start?.lng || !trip.end?.lng) return null;
    const startCoords = `${trip.start.lng},${trip.start.lat}`;
    const endCoords = `${trip.end.lng},${trip.end.lat}`;

    // NOTE: overview=simplified proved too aggressive for street-level
    // animation (6 points on a 2km trip = chords cutting through blocks). We
    // fetch the full geometry and downsample instead (see the filter below).
    let data;
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(`${OSRM_BASE}/${startCoords};${endCoords}?overview=full&geometries=geojson`);
            data = await res.json();
            break;
        } catch (err) {
            if (attempt >= 3) throw err;
            await new Promise((r) => setTimeout(r, 500 * attempt));
        }
    }
    if (data.code !== "Ok" || !data.routes?.length) return null;

    const fullLineString = data.routes[0].geometry.coordinates; // [lng, lat][]
    // Keep first + last + every 4th point in between (~45m spacing, still hugs
    // the streets; every 3rd left the 6k-trip payload at 2.46MB gz, over the 2MB SLO)
    const line = fullLineString.filter(
        (_, idx) => idx === 0 || idx === fullLineString.length - 1 || idx % 4 === 0
    );

    // Fixed America/New_York parse, NOT `new Date(str)`, which would parse in
    // the host's local zone and shift every trip by the UTC offset (4-5h) on a
    // non-NY host (e.g. a UTC CI runner).
    const pickupMs = nyWallClockToEpochMs(trip.pickup_time);
    const dropoffMs = nyWallClockToEpochMs(trip.dropoff_time);
    const diffMs = dropoffMs - pickupMs;
    const n = line.length;

    const path = line.map((coord, index) => {
        const fraction = n > 1 ? index / (n - 1) : 0;
        // Integer ms; 5-decimal coords (~1m). Both keep the payload small.
        return [
            Math.round(coord[0] * 1e5) / 1e5,
            Math.round(coord[1] * 1e5) / 1e5,
            Math.round(pickupMs + diffMs * fraction),
        ];
    });

    return { vendor_type: trip.vendor_type, member: Boolean(trip.member), path };
}

async function runRouter() {
    console.log(`📍 Loading ${IN_PATH} ...`);
    if (!fs.existsSync(IN_PATH)) {
        throw new Error(`Data missing! Run 1-aggregate-remote-duckdb.mjs --date ${DAY} first.`);
    }
    const trips = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
    const results = new Array(trips.length);

    console.log(`📡 Routing ${trips.length} rides via ${OSRM_BASE} (${CONCURRENCY} at a time)...`);
    let next = 0, done = 0;
    const worker = async () => {
        while (next < trips.length) {
            const i = next++;
            try {
                results[i] = await routeTrip(trips[i]);
            } catch (err) {
                console.error(`OSRM request failed: ${err.message}`);
                results[i] = null;
            }
            if (++done % 1000 === 0) console.log(`[Progress] ${done}/${trips.length}`);
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const routed = results.filter(Boolean);
    const rate = routed.length / trips.length;
    console.log(`✅ Routed ${routed.length}/${trips.length} (${(rate * 100).toFixed(1)}%)`);
    if (rate < MIN_SUCCESS_RATE) {
        throw new Error(`❌ Only ${(rate * 100).toFixed(1)}% of rides routed. Is OSRM up at ${OSRM_BASE}?`);
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(routed)); // compact; pretty-print tripled the payload
    const mb = (fs.statSync(OUT_PATH).size / 1e6).toFixed(2);
    console.log(`💾 Wrote ${OUT_PATH} (${mb} MB raw)`);
}

runRouter().catch(err => {
    console.error(err);
    process.exit(1);
});
