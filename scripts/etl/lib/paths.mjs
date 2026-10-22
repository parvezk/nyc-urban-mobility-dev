/**
 * paths.mjs: shared CLI args and file locations for the Citi Bike ETL.
 *
 * Every stage takes the day it works on as `--date YYYY-MM-DD`. The month's
 * CSVs live in scripts/etl/data/<YYYYMM>/ (downloaded by stage 0), per-day
 * scratch files in scripts/etl/work/<date>/, and the files the app serves in
 * public/data/days/<date>/.
 */
import path from 'path';

export const ROOT = process.cwd();
export const ETL_DIR = path.join(ROOT, 'scripts', 'etl');
export const DATA_DIR = path.join(ETL_DIR, 'data');
export const WORK_DIR = path.join(ETL_DIR, 'work');
export const MONTH_PATH = path.join(WORK_DIR, 'month.json');
export const DAYS_DIR = path.join(ROOT, 'public', 'data', 'days');

/** Parse `--key value` / `--key=value` pairs from argv. */
export function parseArgs(argv = process.argv.slice(2)) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
        else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
        else out[a.slice(2)] = true;
    }
    return out;
}

/** Validate and return the `--date` argument. */
export function requireDate(args) {
    const d = args.date;
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        throw new Error('❌ Pass the day to process as --date YYYY-MM-DD');
    }
    return d;
}

/** YYYY-MM-DD -> YYYYMM */
export const monthOf = (date) => date.slice(0, 7).replace('-', '');

/** Glob over every CSV of the month (zips sometimes nest a folder). */
export const csvGlob = (month) => path.join(DATA_DIR, month, '**', '*.csv');

export const workDir = (date) => path.join(WORK_DIR, date);
export const dayDir = (date) => path.join(DAYS_DIR, date);

// Shared row filter (Stage 1 sample and Stage 4 full-day stats must match):
// non-null coords, 60s..4h duration (drops dock glitches / rebalancing),
// plausible NYC bounding box.
export const tripFilterSql = (date) => `
    CAST(started_at AS DATE) = DATE '${date}'
    AND start_lat IS NOT NULL AND start_lng IS NOT NULL
    AND end_lat   IS NOT NULL AND end_lng   IS NOT NULL
    AND date_diff('second', started_at, ended_at) BETWEEN 60 AND 14400
    AND start_lat BETWEEN 40.5 AND 41.0 AND end_lat BETWEEN 40.5 AND 41.0
    AND start_lng BETWEEN -74.3 AND -73.6 AND end_lng BETWEEN -74.3 AND -73.6
`;
