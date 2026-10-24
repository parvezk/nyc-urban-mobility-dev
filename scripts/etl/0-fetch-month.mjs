/**
 * 0-fetch-month.mjs
 *
 * ETL Stage 0: find the latest Citi Bike month, download it, and pick the
 * days the app will show.
 *
 *   node scripts/etl/0-fetch-month.mjs              # latest published month
 *   node scripts/etl/0-fetch-month.mjs --month 202609
 *
 * Source: the public Citi Bike System Data bucket (s3.amazonaws.com/tripdata),
 * NYC files named YYYYMM-citibike-tripdata.zip (Jersey City files start "JC-").
 *
 * Output: scripts/etl/work/month.json
 *   { month, source, days:[{date, weekday, trips}], presets:{ default, busiest } }
 *
 *   default: the "Watch New York wake up" day: the Tuesday, Wednesday or
 *            Thursday whose ride count is closest to the median of those days
 *            (a typical working day; holidays and rain-day dips are skipped
 *            automatically, and Mondays/Fridays are left out as atypical).
 *   busiest: the single day with the most rides.
 *
 * When run inside GitHub Actions it also writes `month` and `dates` to
 * $GITHUB_OUTPUT so the workflow can loop over the chosen days.
 */
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, MONTH_PATH, WORK_DIR, csvGlob, parseArgs } from './lib/paths.mjs';

const BUCKET = 'https://s3.amazonaws.com/tripdata';
const NYC_MONTHLY = /^(\d{6})-citibike-tripdata(?:\.csv)?\.zip$/;

// 2020+ Citi Bike schema; abort loudly if the feed drifts.
const REQUIRED_COLS = [
    'ride_id', 'rideable_type', 'started_at', 'ended_at', 'start_station_name',
    'start_lat', 'start_lng', 'end_lat', 'end_lng', 'member_casual',
];

/** List every NYC monthly archive in the bucket (handles S3 pagination). */
async function listMonthlyArchives() {
    const keys = [];
    let token = '';
    for (;;) {
        const url = `${BUCKET}/?list-type=2${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`❌ Listing ${BUCKET} failed: HTTP ${res.status}`);
        const xml = await res.text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
        const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
        if (!next) break;
        token = next[1];
    }
    return keys
        .map((key) => ({ key, m: key.match(NYC_MONTHLY) }))
        .filter((x) => x.m)
        .map((x) => ({ key: x.key, month: x.m[1] }))
        .sort((a, b) => a.month.localeCompare(b.month));
}

function download(month, key) {
    const dir = path.join(DATA_DIR, month);
    const hasCsv = fs.existsSync(dir) &&
        execFileSync('find', [dir, '-name', '*.csv'], { encoding: 'utf8' }).trim().length > 0;
    if (hasCsv) {
        console.log(`📦 ${dir} already has CSVs; skipping download.`);
        return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, key);
    console.log(`⬇️  Downloading ${BUCKET}/${key} ...`);
    execFileSync('curl', ['-fsSL', '--retry', '3', '-o', zip, `${BUCKET}/${key}`], { stdio: 'inherit' });
    console.log('🗜️  Unzipping ...');
    // Skip macOS resource-fork junk, which would otherwise match *.csv.
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir, '-x', '__MACOSX/*', '*/._*', '._*'], { stdio: 'inherit' });
    fs.rmSync(zip);
}

async function assertSchema(con, glob) {
    const reader = await con.runAndReadAll(
        `DESCRIBE SELECT * FROM read_csv_auto('${glob}', union_by_name=true) LIMIT 0`
    );
    const cols = new Set(reader.getRowObjects().map((r) => String(r.column_name)));
    const missing = REQUIRED_COLS.filter((c) => !cols.has(c));
    if (missing.length) {
        throw new Error(`❌ SCHEMA DRIFT: missing columns ${missing.join(', ')}. Found: ${[...cols].join(', ')}`);
    }
    console.log(`✅ Schema OK (${REQUIRED_COLS.length} required columns present).`);
}

async function dailyCounts(con, glob, month) {
    const first = `${month.slice(0, 4)}-${month.slice(4)}-01`;
    const reader = await con.runAndReadAll(`
        SELECT CAST(started_at AS DATE) AS d, dayname(started_at) AS wd, COUNT(*) AS n
        FROM read_csv_auto('${glob}', union_by_name=true)
        WHERE CAST(started_at AS DATE) >= DATE '${first}'
          AND CAST(started_at AS DATE) <  DATE '${first}' + INTERVAL 1 MONTH
        GROUP BY 1, 2 ORDER BY 1
    `);
    return reader.getRowObjects().map((r) => ({
        date: String(r.d), weekday: String(r.wd), trips: Number(r.n),
    }));
}

function choosePresets(days) {
    const MIDWEEK = ['Tuesday', 'Wednesday', 'Thursday'];
    const weekdays = days.filter((d) => MIDWEEK.includes(d.weekday));
    if (!weekdays.length) throw new Error('❌ No midweek days in this month?');
    const sorted = weekdays.map((d) => d.trips).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const typical = [...weekdays].sort(
        (a, b) => Math.abs(a.trips - median) - Math.abs(b.trips - median) || b.trips - a.trips
    )[0];
    const busiest = [...days].sort((a, b) => b.trips - a.trips)[0];
    console.log(`   midweek median ${median}`);
    console.log(`👉 default (typical weekday): ${typical.date} ${typical.weekday}, ${typical.trips} rides`);
    console.log(`👉 busiest day:              ${busiest.date} ${busiest.weekday}, ${busiest.trips} rides`);
    return { default: typical.date, busiest: busiest.date };
}

async function main() {
    const args = parseArgs();
    const archives = await listMonthlyArchives();
    if (!archives.length) throw new Error('❌ No NYC monthly archives found in the bucket.');

    const target = args.month
        ? archives.find((a) => a.month === String(args.month))
        : archives[archives.length - 1];
    if (!target) throw new Error(`❌ Month ${args.month} not found. Latest is ${archives.at(-1).month}.`);
    console.log(`📅 Month: ${target.month} (latest published: ${archives.at(-1).month})`);

    download(target.month, target.key);

    const glob = csvGlob(target.month);
    const instance = await DuckDBInstance.create(':memory:');
    const con = await DuckDBConnection.create(instance);
    await assertSchema(con, glob);

    const days = await dailyCounts(con, glob, target.month);
    console.log('\n📊 Rides per day:');
    for (const d of days) console.log(`   ${d.date}  ${d.weekday.padEnd(9)} ${String(d.trips).padStart(7)}`);
    const presets = choosePresets(days);

    fs.mkdirSync(WORK_DIR, { recursive: true });
    const out = { month: target.month, source: `${BUCKET}/${target.key}`, days, presets };
    fs.writeFileSync(MONTH_PATH, JSON.stringify(out, null, 2));
    console.log(`\n💾 Wrote ${MONTH_PATH}`);

    const dates = [...new Set(Object.values(presets))];
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `month=${target.month}\ndates=${dates.join(' ')}\n`);
    }
    console.log(`DATES=${dates.join(' ')}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
