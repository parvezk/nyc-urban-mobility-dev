// The lite story: one day of Citi Bike in a 10-second loop.
//
//   0.0–2.0 s  hook       the quietest minute of the night, crawling
//   2.0–4.1 s  wake-up    to the morning peak
//   4.1–6.8 s  the day    midday passes quickly, ease into the evening peak
//   6.8–10 s   evening    winds down to the night under the end card
//   7.7–9.3 s  end card   total rides and how far they went
//
// Pure functions only, so the same timeline drives the live page and the
// frame-by-frame recorder.

import {
  distanceComparison,
  hourOfDay,
  interpolateMonotone,
  nyMidnightEpochMs,
  type DayStats,
  type Keyframe,
} from '@/lib/clip/story';

export const LITE_SECONDS = 10;
export const LITE_FPS = 30;
export const LITE_FRAMES = LITE_SECONDS * LITE_FPS;

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function dayStartMs(stats: DayStats): number {
  if (stats.date) return nyMidnightEpochMs(stats.date);
  return stats.activeByMinute?.startEpochMs ?? stats.peakEpochMs - (stats.peakEpochMs % 86400000);
}

export function liteKeyframes(stats: DayStats, startMs: number): Keyframe[] {
  const low = stats.nightLow ? hourOfDay(stats.nightLow.epochMs, startMs) : 3.75;
  const am = stats.morningPeak ? hourOfDay(stats.morningPeak.epochMs, startMs) : 8.75;
  const peak = hourOfDay(stats.peakEpochMs, startMs);
  const raw: Keyframe[] = [
    { t: 0.0, hour: low - 0.06 },
    { t: 2.0, hour: low + 0.03 },
    { t: 3.5, hour: am },
    { t: 4.1, hour: am + 0.75 },
    { t: 5.0, hour: peak - 2.0 },
    { t: 6.1, hour: peak },
    { t: 6.8, hour: peak + 0.6 },
    { t: 8.0, hour: 21.75 },
    { t: LITE_SECONDS, hour: 24.5 },
  ];
  for (let i = 1; i < raw.length; i++) raw[i].hour = Math.max(raw[i].hour, raw[i - 1].hour + 0.05);
  return raw;
}

export function hourAt(keys: Keyframe[], t: number): number {
  return interpolateMonotone(keys, t);
}

export interface LiteCaption {
  id: 'hook' | 'wake' | 'peak' | 'card';
  from: number;
  to: number;
  lines: string[];
}

export function liteCaptions(stats: DayStats): LiteCaption[] {
  const low = stats.nightLow?.active;
  const card = [fmtInt(stats.totalTrips), 'rides in one day.'];
  if (stats.straightLineKm) card.push(distanceComparison(stats.straightLineKm));
  return [
    { id: 'hook', from: 0, to: 2.0, lines: [low !== undefined ? `Only ${fmtInt(low)} Citi Bikes are moving.` : 'New York is asleep.'] },
    { id: 'wake', from: 2.1, to: 3.9, lines: ['Then New York wakes up.'] },
    { id: 'peak', from: 5.3, to: 6.9, lines: [`Rush hour: ${fmtInt(stats.peakActive)} bikes at once.`] },
    { id: 'card', from: 7.7, to: 9.3, lines: card },
  ];
}

export function fadeWindow(t: number, from: number, to: number, fade = 0.2): number {
  if (t < from || t > to) return 0;
  return Math.max(0, Math.min(1, (t - from) / fade, (to - t) / fade));
}

// The live counter appears once the hook caption has said the number.
export function counterOpacity(t: number): number {
  return fadeWindow(t, 1.9, 7.6, 0.25);
}

// Darken the map under the end card so the words read.
export function dimAt(t: number): number {
  return 0.38 * fadeWindow(t, 7.4, 9.6, 0.45);
}

// A slow drift so the close-up never sits still.
export function driftAt(t: number): { scale: number; rotateDeg: number } {
  const p = (2 * Math.PI * t) / LITE_SECONDS;
  return { scale: 1 + 0.03 * (1 - Math.cos(p)), rotateDeg: 1.2 * Math.sin(p) };
}

export function activeAtHour(stats: DayStats, startMs: number, hour: number): number | null {
  const c = stats.activeByMinute;
  if (!c || !c.values.length) return null;
  const i = Math.floor((startMs + hour * 3600000 - c.startEpochMs) / c.stepMs);
  return c.values[Math.max(0, Math.min(c.values.length - 1, i))];
}

export function clockLabel(hour: number): string {
  const m = ((Math.floor(hour * 60) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  return `${h24 % 12 || 12}:${mm < 10 ? '0' : ''}${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

// The story is Manhattan only. When the day's stats carry a Manhattan scope
// (rides that start or end in Manhattan), every number on screen uses it.
export function scopeToManhattan(stats: DayStats): { stats: DayStats; manhattan: boolean } {
  const s = stats as DayStats & { scope?: string; manhattan?: Partial<DayStats> };
  if (s.scope === 'manhattan') return { stats, manhattan: true };
  const m = s.manhattan;
  if (!m || typeof m.totalTrips !== 'number') return { stats, manhattan: false };
  return { stats: { ...stats, ...m, date: stats.date } as DayStats, manhattan: true };
}
