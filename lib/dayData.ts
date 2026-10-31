import type { DayStats } from '@/lib/clip/story';

// One place that knows where a day's files live, so the map, the stats panel
// and /clip all follow the same day.
//
// New layout (per-day ETL output):
//   /data/days/index.json                 { days: [...], presets: { default, busiest } }
//   /data/days/<YYYY-MM-DD>/day-stats.json, trips.json
// Legacy layout (single day): /data/day-stats.json + /api/trips.

export interface DaysIndex {
  days: Array<string | { date: string }>;
  presets?: { default?: string; busiest?: string; [name: string]: string | undefined };
}

export interface DaySources {
  date: string | null;     // null = legacy single-day files
  statsUrl: string;
  tripsUrl: string;
}

const LEGACY: DaySources = { date: null, statsUrl: '/data/day-stats.json', tripsUrl: '/api/trips' };

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// `requested` may be a date ("2026-09-17"), a preset name ("busiest") or empty.
export function pickDay(index: DaysIndex, requested?: string | null): string | null {
  const dates = index.days.map(d => (typeof d === 'string' ? d : d.date));
  if (requested && isDate(requested) && dates.includes(requested)) return requested;
  const preset = requested && index.presets?.[requested];
  if (preset && dates.includes(preset)) return preset;
  const fallback = index.presets?.default;
  if (fallback && dates.includes(fallback)) return fallback;
  return dates.length ? dates[dates.length - 1] : null;
}

export async function resolveDay(requested?: string | null): Promise<DaySources> {
  try {
    const res = await fetch('/data/days/index.json');
    if (!res.ok) return LEGACY;
    const date = pickDay((await res.json()) as DaysIndex, requested);
    if (!date) return LEGACY;
    return {
      date,
      statsUrl: `/data/days/${date}/day-stats.json`,
      tripsUrl: `/data/days/${date}/trips.json`,
    };
  } catch {
    return LEGACY;
  }
}

export async function loadDayStats(sources: DaySources): Promise<DayStats> {
  const res = await fetch(sources.statsUrl);
  return (await res.json()) as DayStats;
}
