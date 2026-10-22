/**
 * 5-build-index.mjs
 *
 * ETL Stage 5: write public/data/days/index.json, the list of days the app
 * can show, and remove day folders from older runs.
 *
 *   node scripts/etl/5-build-index.mjs
 *
 * index.json:
 *   { month, monthLabel, source, generatedAt,
 *     presets: { default, busiest },
 *     days: [{ date, weekday, totalTrips, peakActive, peakMinute }] }
 *
 * Only days whose folder has trips.json, hotspots.json and day-stats.json are
 * listed, so the app never offers a day it can't load.
 */
import fs from 'fs';
import path from 'path';
import { DAYS_DIR, MONTH_PATH, dayDir } from './lib/paths.mjs';

const FILES = ['trips.json', 'hotspots.json', 'day-stats.json'];

function main() {
    if (!fs.existsSync(MONTH_PATH)) throw new Error('❌ work/month.json missing. Run Stage 0 first.');
    const month = JSON.parse(fs.readFileSync(MONTH_PATH, 'utf8'));

    const wanted = [...new Set(Object.values(month.presets))].sort();
    const days = [];
    for (const date of wanted) {
        const missing = FILES.filter((f) => !fs.existsSync(path.join(dayDir(date), f)));
        if (missing.length) throw new Error(`❌ ${date} is missing ${missing.join(', ')}.`);
        const stats = JSON.parse(fs.readFileSync(path.join(dayDir(date), 'day-stats.json'), 'utf8'));
        const weekday = month.days.find((d) => d.date === date)?.weekday ?? '';
        days.push({
            date, weekday,
            totalTrips: stats.totalTrips,
            peakActive: stats.peakActive,
            peakMinute: stats.peakMinute,
        });
    }

    // Drop folders from earlier months so the repo only carries what's served.
    for (const entry of fs.readdirSync(DAYS_DIR, { withFileTypes: true })) {
        if (entry.isDirectory() && !wanted.includes(entry.name)) {
            fs.rmSync(path.join(DAYS_DIR, entry.name), { recursive: true });
            console.log(`🧹 Removed stale day ${entry.name}`);
        }
    }

    const y = Number(month.month.slice(0, 4));
    const m = Number(month.month.slice(4));
    const monthLabel = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', {
        month: 'long', year: 'numeric', timeZone: 'UTC',
    });

    const index = {
        month: month.month,
        monthLabel,
        source: month.source,
        generatedAt: new Date().toISOString(),
        presets: month.presets,
        days,
    };
    fs.writeFileSync(path.join(DAYS_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    console.log(`✅ Wrote ${path.join(DAYS_DIR, 'index.json')}`);
    console.log(JSON.stringify(index, null, 2));
}

main();
