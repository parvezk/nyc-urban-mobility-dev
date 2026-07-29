/**
 * 4-hotspot-stats.mjs
 *
 * ETL Stage 4 — full-day aggregation artifacts for the front-end overlays.
 * Runs over the ENTIRE chosen day (not the 6k Stage-1 sample), reading the
 * Citi Bike CSVs directly through DuckDB.
 *
 * Emits:
 *   public/data/day-stats.json  { date, totalTrips, peakMinute, peakEpochMs, peakActive }
 *   public/data/hotspots.json   { bucketMs, clusters:[{ lng, lat, name, counts:[[bucketEpochMs, activeCount],…] }] }
 *
 * --- TIMEZONE / EPOCH PARITY (critical) ------------------------------------
 * Stage 2 turns each trip time into an epoch via `nyWallClockToEpochMs()`
 * (lib/ny-time.mjs), which parses the zone-less CSV string as America/New_York
 * wall-clock time using a fixed IANA zone lookup — independent of the host
 * machine's timezone. We MUST produce peakEpochMs / bucketEpochMs the SAME
 * way, or the overlay markers land hours off the animated trips.
 *
 * If we instead computed epochs inside DuckDB (e.g. epoch_ms(started_at)),
 * DuckDB would treat the naive TIMESTAMP as UTC and the result would be 4h off
 * (EDT). So we pull the day's rows out of DuckDB as *strings* and do the sweep
 * + bucketing in JS with `nyWallClockToEpochMs()` — byte-for-byte parity with
 * Stage 2, on any host timezone. A full Citi Bike day is ~200k rows; the
 * in-memory sweep is trivial.
 * We assert the parity at the end (peakEpochMs formats back to peakMinute).
 *
 * The date is derived from Stage 1's output_centroids.json (first pickup_time)
 * so the two stages can never drift onto different days. Run order: 1 && 4.
 * ---------------------------------------------------------------------------
 */
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import fs from 'fs';
import path from 'path';
import { nyWallClockToEpochMs } from './lib/ny-time.mjs';

const ETL_DIR = path.join(process.cwd(), 'scripts', 'etl');
const CSV_GLOB = path.join(ETL_DIR, '202606', '*.csv');
const CENTROIDS_PATH = path.join(ETL_DIR, 'output_centroids.json');
const DAY_STATS_PATH = path.join(process.cwd(), 'public', 'data', 'day-stats.json');
const HOTSPOTS_PATH = path.join(process.cwd(), 'public', 'data', 'hotspots.json');

const BUCKET_MS = 300000;      // 5-minute buckets
const GRID_DEG = 0.005;        // ~0.5 km grid cell for clustering start stations
const MAX_CLUSTERS = 40;
const HOTSPOTS_SIZE_LIMIT = 200 * 1024; // target < 200 KB (200 KiB) — keep as many of the top 40 as fit

const bn = (v) => (typeof v === 'bigint' ? Number(v) : v);

// Derive the chosen day from Stage 1's output (no cross-file constant to drift).
function chosenDay() {
    if (!fs.existsSync(CENTROIDS_PATH)) {
        throw new Error(`❌ ${CENTROIDS_PATH} missing — run 1-aggregate-remote-duckdb.mjs first.`);
    }
    const centroids = JSON.parse(fs.readFileSync(CENTROIDS_PATH, 'utf8'));
    if (!Array.isArray(centroids) || !centroids.length) {
        throw new Error('❌ output_centroids.json is empty.');
    }
    const day = String(centroids[0].pickup_time).slice(0, 10); // YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw new Error(`❌ Could not derive a valid day from pickup_time="${centroids[0].pickup_time}".`);
    }
    return day;
}

// Pull the full filtered day as strings (same filters as Stage 1). Epochs are
// computed in JS below, NOT in SQL — see the timezone note above.
async function loadDay(con, day) {
    const query = `
        SELECT strftime(started_at, '%Y-%m-%dT%H:%M:%S.%g') AS started_at,
               strftime(ended_at,   '%Y-%m-%dT%H:%M:%S.%g') AS ended_at,
               start_station_name                          AS station,
               start_lat, start_lng
        FROM read_csv_auto('${CSV_GLOB}', union_by_name=true)
        WHERE CAST(started_at AS DATE) = DATE '${day}'
          AND start_lat IS NOT NULL AND start_lng IS NOT NULL
          AND end_lat   IS NOT NULL AND end_lng   IS NOT NULL
          AND date_diff('second', started_at, ended_at) BETWEEN 60 AND 14400
          AND start_lat BETWEEN 40.5 AND 41.0 AND end_lat BETWEEN 40.5 AND 41.0
          AND start_lng BETWEEN -74.3 AND -73.6 AND end_lng BETWEEN -74.3 AND -73.6
    `;
    const reader = await con.runAndReadAll(query);
    return reader.getRowObjects().map((r) => {
        const startMs = nyWallClockToEpochMs(String(r.started_at));
        const endMs = nyWallClockToEpochMs(String(r.ended_at));
        return {
            startMs, endMs,
            startStr: String(r.started_at), // retained for a genuine TZ round-trip check
            station: r.station == null ? '' : String(r.station),
            lat: bn(r.start_lat), lng: bn(r.start_lng),
        };
    });
}

// Genuine epoch-parity check (mirrors Stage 1's verifyTimezone): parse one
// real source string the way Stage 2 does, format the epoch back in NY, and
// assert the wall-clock HH:MM:SS matches the source. This is what actually
// validates that our JS-side epochs line up with the animated trips.
function verifyEpochParity(trips) {
    const t = trips[0];
    const back = new Date(t.startMs).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour12: false,
    });
    const backNorm = back === '24:00:00' ? '00:00:00' : back;
    const wall = t.startStr.slice(11, 19); // HH:MM:SS from the source ISO string
    console.log(`🕑 Epoch parity: "${t.startStr}" -> ${t.startMs} -> NY "${backNorm}"`);
    if (backNorm !== wall) {
        throw new Error(
            `❌ EPOCH DRIFT: source ${wall} but epoch round-trips to ${backNorm} in America/New_York.`
        );
    }
    console.log('   ✅ JS epochs match the source wall-clock (parity with Stage 2).');
}

const nyHHMM = (epochMs) =>
    new Date(epochMs).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
    });

// --- day-stats: concurrency via event sweep --------------------------------
function computeDayStats(trips, day) {
    // +1 at each start, -1 at each end. At equal timestamps, apply -1 before +1
    // so a trip ending exactly as another starts is not double-counted.
    const events = [];
    for (const t of trips) {
        events.push([t.startMs, 1]);
        events.push([t.endMs, -1]);
    }
    events.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

    let active = 0, peakActive = -1, peakInstant = 0;
    for (const [ts, delta] of events) {
        active += delta;
        if (active > peakActive) { peakActive = active; peakInstant = ts; }
    }

    // NY minute boundaries align to UTC minute boundaries (whole-hour offset),
    // so flooring the epoch to the minute is safe.
    const peakEpochMs = Math.floor(peakInstant / 60000) * 60000;
    const peakMinute = nyHHMM(peakEpochMs);

    // Genuine (non-tautological) check: the FLOORED epoch and the UNFLOORED peak
    // instant must fall in the same NY minute — i.e. the floor didn't slip us
    // across a minute boundary. Different inputs, so this can actually fail.
    if (nyHHMM(peakInstant) !== peakMinute) {
        throw new Error(
            `❌ Minute-floor crossed a boundary: peakInstant=${nyHHMM(peakInstant)} ` +
            `vs peakEpochMs=${peakMinute} (NY).`
        );
    }

    return { date: day, totalTrips: trips.length, peakMinute, peakEpochMs, peakActive };
}

// --- hotspots: grid-cell clusters × 5-min in-motion buckets -----------------
function computeHotspots(trips) {
    const cells = new Map();
    const cellKey = (lat, lng) =>
        `${Math.round(lat / GRID_DEG) * GRID_DEG}|${Math.round(lng / GRID_DEG) * GRID_DEG}`;

    for (const t of trips) {
        const key = cellKey(t.lat, t.lng);
        let cell = cells.get(key);
        if (!cell) {
            cell = { buckets: new Map(), names: new Map(), sumLat: 0, sumLng: 0, n: 0, total: 0 };
            cells.set(key, cell);
        }
        cell.sumLat += t.lat; cell.sumLng += t.lng; cell.n += 1;
        if (t.station) cell.names.set(t.station, (cell.names.get(t.station) || 0) + 1);

        // A trip started in this cell is "in motion" during every 5-min bucket
        // it overlaps: started_at <= bucketEnd AND ended_at >= bucketStart.
        const firstBucket = Math.floor(t.startMs / BUCKET_MS) * BUCKET_MS;
        const lastBucket = Math.floor(t.endMs / BUCKET_MS) * BUCKET_MS;
        for (let b = firstBucket; b <= lastBucket; b += BUCKET_MS) {
            cell.buckets.set(b, (cell.buckets.get(b) || 0) + 1);
            cell.total += 1;
        }
    }

    let ranked = [...cells.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, MAX_CLUSTERS)
        .map((cell) => {
            let name = '', best = -1;
            for (const [nm, cnt] of cell.names) if (cnt > best) { best = cnt; name = nm; }
            const counts = [...cell.buckets.entries()]
                .filter(([, c]) => c > 0)          // omit zero-count buckets
                .sort((a, b) => a[0] - b[0]);
            return {
                lng: +(cell.sumLng / cell.n).toFixed(6),
                lat: +(cell.sumLat / cell.n).toFixed(6),
                name,
                counts,
            };
        });

    return ranked;
}

// Serialize, and if over the size budget trim the lowest-activity clusters.
function serializeHotspots(clusters) {
    const activityOf = (c) => c.counts.reduce((s, [, v]) => s + v, 0);
    let working = [...clusters];
    let json = JSON.stringify({ bucketMs: BUCKET_MS, clusters: working });
    const dropped = [];
    while (Buffer.byteLength(json) > HOTSPOTS_SIZE_LIMIT && working.length > 1) {
        // Drop the least-active remaining cluster.
        let minIdx = 0;
        for (let i = 1; i < working.length; i++) {
            if (activityOf(working[i]) < activityOf(working[minIdx])) minIdx = i;
        }
        dropped.push(working[minIdx].name);
        working.splice(minIdx, 1);
        json = JSON.stringify({ bucketMs: BUCKET_MS, clusters: working });
    }
    return { json, kept: working.length, dropped, clusters: working };
}

async function main() {
    const day = chosenDay();
    console.log(`📅 Chosen day (from output_centroids.json): ${day}`);

    console.log('🦆 Spawning in-memory DuckDB...');
    const instance = await DuckDBInstance.create(':memory:');
    const con = await DuckDBConnection.create(instance);

    console.log('⛏️  Loading full filtered day (as strings, epochs computed in JS)...');
    const trips = await loadDay(con, day);
    if (!trips.length) throw new Error('❌ No trips loaded for the chosen day.');
    console.log(`   Loaded ${trips.length} filtered-valid trips.`);
    verifyEpochParity(trips);

    // day-stats
    const dayStats = computeDayStats(trips, day);
    fs.writeFileSync(DAY_STATS_PATH, JSON.stringify(dayStats, null, 2));

    // hotspots
    const ranked = computeHotspots(trips);
    const { json, kept, dropped, clusters } = serializeHotspots(ranked);
    fs.writeFileSync(HOTSPOTS_PATH, json);

    // --- report ---
    console.log('\n📈 day-stats.json:');
    console.log(`   date=${dayStats.date}  totalTrips=${dayStats.totalTrips} (filtered-valid)`);
    console.log(`   peakMinute=${dayStats.peakMinute} (NY)  peakActive=${dayStats.peakActive}  peakEpochMs=${dayStats.peakEpochMs}`);

    const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
    const totalBuckets = clusters.reduce((s, c) => s + c.counts.length, 0);
    console.log('\n📍 hotspots.json:');
    console.log(`   clusters=${kept}  totalNonZeroBuckets=${totalBuckets}  size=${sizeKB} KB`);
    if (dropped.length) console.log(`   trimmed ${dropped.length} low-activity clusters to fit <200KB: ${dropped.join(', ')}`);
    console.log(`   top cluster: "${clusters[0].name}" @ ${clusters[0].lat},${clusters[0].lng} (${clusters[0].counts.length} buckets)`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
