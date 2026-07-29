/**
 * 1-aggregate-remote-duckdb.mjs
 *
 * ETL Stage 1 — Citi Bike (June 2026) origin/destination sampler.
 *
 * Replaces the retired NYC TLC taxi pipeline (Socrata JSON fetch + taxi-zone
 * shapefile spatial join). Citi Bike trip CSVs already carry real start/end
 * lat-lng per ride, so there is NO shapefile, NO httpfs, NO spatial join —
 * DuckDB reads the local CSVs directly.
 *
 * Input : scripts/etl/202606/*.csv  (six part files, ~1 GB, 2020+ schema)
 * Output: scripts/etl/output_centroids.json  (contract shared with Stage 2)
 *
 *   [{ vendor_type, pickup_time, dropoff_time,
 *      start:{lng,lat}, end:{lng,lat} }]
 *
 * TIMEZONE: CSV times are zone-less NY wall-clock strings (e.g.
 * "2026-06-10 08:05:03.403"), emitted as-is. Stages 2/4 must convert via
 * `nyWallClockToEpochMs()` (lib/ny-time.mjs) — a fixed America/New_York zone
 * lookup, not `new Date(str)`, which shifts by the UTC offset on non-NY
 * hosts. verifyTimezone() below round-trips one trip to catch drift.
 */
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import fs from 'fs';
import path from 'path';
import { nyWallClockToEpochMs } from './lib/ny-time.mjs';

const ETL_DIR = path.join(process.cwd(), 'scripts', 'etl');
const CSV_GLOB = path.join(ETL_DIR, '202606', '*.csv');
const OUT_PATH = path.join(ETL_DIR, 'output_centroids.json');

// Read sample size from argv (default 6000). Contract with Stage 2.
const SAMPLE_SIZE = Number.parseInt(process.argv[2], 10) || 6000;

// Two candidate weekdays supplied by the build spec; pick the healthier one.
const CANDIDATE_DAYS = ['2026-06-10', '2026-06-17'];
// A weekday whose volume falls below this fraction of the weekday median is
// treated as an anomalous dip (e.g. a rain day) and skipped.
const DIP_FRACTION = 0.85;

// 2020+ Citi Bike schema — abort loudly if the feed drifted.
const REQUIRED_COLS = [
    'ride_id', 'rideable_type', 'started_at', 'ended_at',
    'start_station_name', 'start_lat', 'start_lng', 'end_lat', 'end_lng',
];

const bn = (v) => (typeof v === 'bigint' ? Number(v) : v);

async function assertSchema(con) {
    console.log('🔎 Asserting 2020+ Citi Bike schema...');
    const reader = await con.runAndReadAll(
        `DESCRIBE SELECT * FROM read_csv_auto('${CSV_GLOB}', union_by_name=true) LIMIT 0`
    );
    const cols = new Set(reader.getRowObjects().map((r) => String(r.column_name)));
    const missing = REQUIRED_COLS.filter((c) => !cols.has(c));
    if (missing.length) {
        throw new Error(
            `❌ SCHEMA DRIFT — missing columns: ${missing.join(', ')}\n` +
            `   Found: ${[...cols].join(', ')}`
        );
    }
    console.log(`   ✅ All ${REQUIRED_COLS.length} required columns present.`);
}

async function chooseDay(con) {
    console.log('\n📊 Trips-per-day (June 2026):');
    const reader = await con.runAndReadAll(`
        SELECT CAST(started_at AS DATE) AS d,
               dayname(started_at)      AS wd,
               COUNT(*)                 AS n
        FROM read_csv_auto('${CSV_GLOB}', union_by_name=true)
        WHERE CAST(started_at AS DATE) BETWEEN DATE '2026-06-01' AND DATE '2026-06-30'
        GROUP BY 1, 2
        ORDER BY 1
    `);
    const rows = reader.getRowObjects().map((r) => ({
        d: String(r.d), wd: String(r.wd), n: Number(bn(r.n)),
    }));

    const isWeekday = (wd) => wd !== 'Saturday' && wd !== 'Sunday';
    for (const r of rows) {
        const mark = CANDIDATE_DAYS.includes(r.d) ? '  <- candidate' : '';
        console.log(`   ${r.d}  ${r.wd.padEnd(9)} ${String(r.n).padStart(7)}${mark}`);
    }

    const weekdayVols = rows.filter((r) => isWeekday(r.wd)).map((r) => r.n).sort((a, b) => a - b);
    const median = weekdayVols[Math.floor(weekdayVols.length / 2)];
    const dipThreshold = Math.round(median * DIP_FRACTION);
    console.log(`   weekday median = ${median}, dip threshold (<${(DIP_FRACTION * 100)}%) = ${dipThreshold}`);

    const candidates = CANDIDATE_DAYS
        .map((d) => rows.find((r) => r.d === d))
        .filter(Boolean)
        .map((r) => ({ ...r, isDip: r.n < dipThreshold }));

    if (!candidates.length) throw new Error('❌ No candidate days found in June 2026 data.');

    // Prefer a non-dip day; among healthy candidates take the highest volume
    // (more rides -> denser, more representative animation).
    const healthy = candidates.filter((c) => !c.isDip);
    const pool = healthy.length ? healthy : candidates;
    pool.sort((a, b) => b.n - a.n);
    const chosen = pool[0];

    for (const c of candidates) {
        console.log(
            `   candidate ${c.d}: ${c.n} trips` +
            `${c.isDip ? ' (ANOMALOUS DIP — skipped)' : ' (healthy)'}`
        );
    }
    console.log(
        `👉 Chosen day: ${chosen.d} (${chosen.n} trips) — ` +
        `healthiest candidate, no anomalous dip vs weekday median ${median}.`
    );
    return chosen.d;
}

async function extractSample(con, day) {
    // Filters: non-null coords; duration 60s..4h (drops dock glitches /
    // rebalancing); plausible NYC bbox. Emit timestamps as zone-less ISO with
    // a 'T' separator and 3-digit ms (matches Stage 2's local-parse contract).
    const query = `
        WITH src AS (
            SELECT rideable_type, started_at, ended_at,
                   start_lat, start_lng, end_lat, end_lng
            FROM read_csv_auto('${CSV_GLOB}', union_by_name=true)
            WHERE CAST(started_at AS DATE) = DATE '${day}'
              AND start_lat IS NOT NULL AND start_lng IS NOT NULL
              AND end_lat   IS NOT NULL AND end_lng   IS NOT NULL
              AND date_diff('second', started_at, ended_at) BETWEEN 60 AND 14400
              AND start_lat BETWEEN 40.5 AND 41.0 AND end_lat BETWEEN 40.5 AND 41.0
              AND start_lng BETWEEN -74.3 AND -73.6 AND end_lng BETWEEN -74.3 AND -73.6
        )
        SELECT rideable_type                                   AS vendor_type,
               strftime(started_at, '%Y-%m-%dT%H:%M:%S.%g')    AS pickup_time,
               strftime(ended_at,   '%Y-%m-%dT%H:%M:%S.%g')    AS dropoff_time,
               start_lng, start_lat, end_lng, end_lat
        FROM src
        USING SAMPLE ${SAMPLE_SIZE} ROWS
    `;
    const reader = await con.runAndReadAll(query);
    return reader.getRowObjects().map((r) => ({
        vendor_type: String(r.vendor_type),
        pickup_time: String(r.pickup_time),
        dropoff_time: String(r.dropoff_time),
        start: { lng: bn(r.start_lng), lat: bn(r.start_lat) },
        end: { lng: bn(r.end_lng), lat: bn(r.end_lat) },
    }));
}

/**
 * Round-trip the timezone contract on one real emitted trip:
 * string -> epoch (fixed America/New_York parse, as Stage 2/4 do) ->
 * formatted back in America/New_York. The HH:MM:SS must match the string we
 * wrote. Host-timezone independent — passes identically on a UTC CI runner
 * or an America/New_York laptop.
 */
function verifyTimezone(trips) {
    const sample = trips[0];
    const epoch = nyWallClockToEpochMs(sample.pickup_time);
    const back = new Date(epoch).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour12: false,
    });
    const wall = sample.pickup_time.slice(11, 19); // HH:MM:SS from the ISO string
    // toLocaleTimeString can emit "24:00:00" for midnight; normalize.
    const backNorm = back === '24:00:00' ? '00:00:00' : back;
    console.log(`\n🕑 Timezone check: "${sample.pickup_time}" -> epoch ${epoch} -> NY "${backNorm}"`);
    if (backNorm !== wall) {
        throw new Error(
            `❌ TIMEZONE DRIFT: wrote ${wall} but epoch round-trips to ${backNorm} in America/New_York. ` +
            `nyWallClockToEpochMs() is broken — Stage 2/4 timestamps would be wrong.`
        );
    }
    console.log('   ✅ Zone-less ISO parses correctly as America/New_York wall-clock (host-timezone independent).');
}

async function main() {
    if (!fs.existsSync(path.join(ETL_DIR, '202606'))) {
        throw new Error('❌ scripts/etl/202606/ not found — download the Citi Bike CSVs first.');
    }

    console.log('🦆 Spawning in-memory DuckDB...');
    const instance = await DuckDBInstance.create(':memory:');
    const con = await DuckDBConnection.create(instance);

    await assertSchema(con);
    const day = await chooseDay(con);

    console.log(`\n⛏️  Sampling ${SAMPLE_SIZE} filtered rides from ${day}...`);
    const trips = await extractSample(con, day);
    if (!trips.length) throw new Error('❌ Sample returned 0 rows — check filters/day.');

    verifyTimezone(trips);

    fs.writeFileSync(OUT_PATH, JSON.stringify(trips, null, 2));
    const kinds = trips.reduce((m, t) => ((m[t.vendor_type] = (m[t.vendor_type] || 0) + 1), m), {});
    console.log(`\n✅ Wrote ${trips.length} trips -> ${OUT_PATH}`);
    console.log(`   vendor_type breakdown: ${JSON.stringify(kinds)}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
