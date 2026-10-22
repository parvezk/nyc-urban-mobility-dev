/**
 * 1-aggregate-remote-duckdb.mjs
 *
 * ETL Stage 1: sample one day of Citi Bike rides.
 *
 *   node scripts/etl/1-aggregate-remote-duckdb.mjs --date 2026-09-16 [--sample 6000]
 *
 * Input : scripts/etl/data/<YYYYMM>/**.csv  (downloaded by Stage 0)
 * Output: scripts/etl/work/<date>/centroids.json  (contract shared with Stage 2)
 *
 *   [{ vendor_type, member, pickup_time, dropoff_time,
 *      start:{lng,lat}, end:{lng,lat} }]
 *
 * TIMEZONE: CSV times are zone-less NY wall-clock strings (e.g.
 * "2026-06-10 08:05:03.403"), emitted as-is. Stages 2/4 must convert via
 * `nyWallClockToEpochMs()` (lib/ny-time.mjs), a fixed America/New_York zone
 * lookup, not `new Date(str)`, which shifts by the UTC offset on non-NY
 * hosts. verifyTimezone() below round-trips one trip to catch drift.
 */
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import fs from 'fs';
import path from 'path';
import { nyWallClockToEpochMs } from './lib/ny-time.mjs';
import { csvGlob, monthOf, parseArgs, requireDate, tripFilterSql, workDir } from './lib/paths.mjs';

const args = parseArgs();
const DAY = requireDate(args);
const CSV_GLOB = csvGlob(monthOf(DAY));
const OUT_PATH = path.join(workDir(DAY), 'centroids.json');

// Rides to sample. ~6k keeps 60fps and the payload under the 2 MB SLO.
const SAMPLE_SIZE = Number.parseInt(args.sample, 10) || 6000;

const bn = (v) => (typeof v === 'bigint' ? Number(v) : v);

async function extractSample(con, day) {
    // Filters live in lib/paths.mjs (shared with Stage 4). Emit timestamps as zone-less ISO with
    // a 'T' separator and 3-digit ms (matches Stage 2's local-parse contract).
    const query = `
        WITH src AS (
            SELECT rideable_type, member_casual, started_at, ended_at,
                   start_lat, start_lng, end_lat, end_lng
            FROM read_csv_auto('${CSV_GLOB}', union_by_name=true)
            WHERE ${tripFilterSql(day)}
        )
        SELECT rideable_type                                   AS vendor_type,
               member_casual = 'member'                        AS member,
               strftime(started_at, '%Y-%m-%dT%H:%M:%S.%g')    AS pickup_time,
               strftime(ended_at,   '%Y-%m-%dT%H:%M:%S.%g')    AS dropoff_time,
               start_lng, start_lat, end_lng, end_lat
        FROM src
        USING SAMPLE ${SAMPLE_SIZE} ROWS
    `;
    const reader = await con.runAndReadAll(query);
    return reader.getRowObjects().map((r) => ({
        vendor_type: String(r.vendor_type),
        member: Boolean(r.member),
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
    console.log('🦆 Spawning in-memory DuckDB...');
    const instance = await DuckDBInstance.create(':memory:');
    const con = await DuckDBConnection.create(instance);

    console.log(`⛏️  Sampling ${SAMPLE_SIZE} filtered rides from ${DAY}...`);
    const trips = await extractSample(con, DAY);
    if (!trips.length) throw new Error(`❌ Sample returned 0 rows for ${DAY}. Did Stage 0 download that month?`);

    verifyTimezone(trips);

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(trips));
    const kinds = trips.reduce((m, t) => ((m[t.vendor_type] = (m[t.vendor_type] || 0) + 1), m), {});
    const members = trips.filter((t) => t.member).length;
    console.log(`\n✅ Wrote ${trips.length} trips -> ${OUT_PATH}`);
    console.log(`   vendor_type breakdown: ${JSON.stringify(kinds)}  members: ${members}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
