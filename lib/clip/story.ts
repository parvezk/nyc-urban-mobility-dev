// The "Watch New York wake up" social clip: an 8-second scripted loop.
// Everything here is pure (no React, no DOM) so the beat sheet can be unit
// tested and the same frame number always renders the same picture.

export interface StoryMoment {
  minute: string;   // "HH:MM", America/New_York
  epochMs: number;
  active: number;   // bikes in motion
}

// Shape of /data/day-stats.json (written by ETL stage 4).
export interface DayStats {
  date: string;        // ISO date, e.g. "2026-06-10"
  totalTrips: number;
  peakMinute: string;  // e.g. "17:53"
  peakEpochMs: number;
  peakActive: number;
  // Added for the clip. Optional so an older day-stats.json still loads.
  nightLow?: StoryMoment;
  morningPeak?: StoryMoment;
  straightLineKm?: number;
  ebikeShare?: number;        // 0..1
  medianRideMinutes?: number;
  medianRideKm?: number;
  activeByMinute?: { startEpochMs: number; stepMs: number; values: number[] };
}

export type ClipFormat = '9x16' | '1x1' | '16x9';

export interface FormatSpec {
  width: number;   // export size in px
  height: number;
  view: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number };
}

// Bearing 29° turns Manhattan's street grid so the island runs straight up a
// vertical frame; -61° lays it left-to-right for landscape. `zoom` is for the
// export size and is scaled for smaller previews (see zoomForHeight).
export const FORMATS: Record<ClipFormat, FormatSpec> = {
  '9x16': { width: 1080, height: 1920, view: { longitude: -73.994, latitude: 40.741, zoom: 13.1, pitch: 40, bearing: 29 } },
  '1x1': { width: 1080, height: 1080, view: { longitude: -73.991, latitude: 40.740, zoom: 12.6, pitch: 40, bearing: 29 } },
  '16x9': { width: 1920, height: 1080, view: { longitude: -73.991, latitude: 40.754, zoom: 12.7, pitch: 40, bearing: -61 } },
};

export function parseFormat(value: string | null | undefined): ClipFormat {
  return value === '1x1' || value === '16x9' ? value : '9x16';
}

// Keep framing identical whatever size the stage is rendered at.
export function zoomForHeight(format: ClipFormat, stageHeightPx: number): number {
  const spec = FORMATS[format];
  return spec.view.zoom + Math.log2(stageHeightPx / spec.height);
}

export const CLIP_SECONDS = 8;
export const CLIP_FPS = 30;
export const CLIP_FRAMES = CLIP_SECONDS * CLIP_FPS;

// ---------------------------------------------------------------------------
// Time: clip seconds -> hour of the story day (can run past 24 into the night)
// ---------------------------------------------------------------------------

const HOUR_MS = 3600000;

export interface Keyframe { t: number; hour: number }

export function hourOfDay(epochMs: number, dayStartMs: number): number {
  return (epochMs - dayStartMs) / HOUR_MS;
}

// Beat sheet for direction B ("whole day, wake-up hook"). Anchored on the
// day's own moments, so a different day keeps the same rhythm.
export function buildKeyframes(stats: DayStats, dayStartMs: number): Keyframe[] {
  const low = stats.nightLow ? hourOfDay(stats.nightLow.epochMs, dayStartMs) : 3.75;
  const am = stats.morningPeak ? hourOfDay(stats.morningPeak.epochMs, dayStartMs) : 8.75;
  const peak = hourOfDay(stats.peakEpochMs, dayStartMs);

  const raw: Keyframe[] = [
    { t: 0.0, hour: low - 0.05 }, // hook: crawl past the quietest minute
    { t: 1.5, hour: low + 0.025 },
    { t: 2.8, hour: am },         // wake-up
    { t: 3.35, hour: am + 0.75 },
    { t: 4.1, hour: peak - 2.0 }, // midday passes quickly
    { t: 5.1, hour: peak },       // ease into the day's peak
    { t: 5.7, hour: peak + 0.6 },
    { t: 6.6, hour: 23.0 },       // wind down
    { t: CLIP_SECONDS, hour: 24.5 },
  ];
  // Unusual days could put moments out of order; keep hours strictly rising.
  for (let i = 1; i < raw.length; i++) {
    raw[i].hour = Math.max(raw[i].hour, raw[i - 1].hour + 0.05);
  }
  return raw;
}

// Monotone cubic (Fritsch–Carlson): smooth speed changes, never runs backwards.
export function interpolateMonotone(keys: Keyframe[], t: number): number {
  const n = keys.length;
  if (t <= keys[0].t) return keys[0].hour;
  if (t >= keys[n - 1].t) return keys[n - 1].hour;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(keys[i + 1].t - keys[i].t);
    slope.push((keys[i + 1].hour - keys[i].hour) / dx[i]);
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) { m.push(0); continue; }
    const w1 = 2 * dx[i] + dx[i - 1];
    const w2 = dx[i] + 2 * dx[i - 1];
    m.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
  }
  m.push(slope[n - 2]);

  let i = 0;
  while (t > keys[i + 1].t) i++;
  const h = dx[i];
  const s = (t - keys[i].t) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * keys[i].hour +
    (s3 - 2 * s2 + s) * h * m[i] +
    (-2 * s3 + 3 * s2) * keys[i + 1].hour +
    (s3 - s2) * h * m[i + 1];
}

// ---------------------------------------------------------------------------
// Words on screen
// ---------------------------------------------------------------------------

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  });
}

export function formatStoryDate(date: string): string {
  // Anchor at noon so the weekday never rolls across a timezone boundary.
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  });
}

const MOON_KM = 384400;
const EARTH_KM = 40075;

// A plain-English comparison for the day's (straight-line, so minimum) distance.
export function distanceComparison(km: number): string {
  if (km >= 2 * MOON_KM) return 'To the Moon and back.';
  if (km >= MOON_KM) return 'Farther than the Moon.';
  if (km >= 2 * EARTH_KM) return `${Math.floor(km / EARTH_KM)} times around the Earth.`;
  if (km >= EARTH_KM) return 'Once around the Earth.';
  return `${fmtInt(km)} km of riding.`;
}

export interface Caption {
  id: string;
  from: number;   // clip seconds
  to: number;
  lines: string[];
  kind: 'caption' | 'card';
}

export function buildCaptions(stats: DayStats): Caption[] {
  const low = stats.nightLow?.active;
  const captions: Caption[] = [
    {
      id: 'hook', from: 0, to: 1.75, kind: 'caption',
      lines: [low !== undefined ? `Only ${fmtInt(low)} Citi Bikes are moving.` : 'New York is asleep.'],
    },
    { id: 'wake', from: 1.85, to: 3.35, kind: 'caption', lines: ['Then New York wakes up.'] },
    {
      id: 'peak', from: 4.45, to: 6.05, kind: 'caption',
      lines: [`Rush hour: ${fmtInt(stats.peakActive)} bikes at once.`],
    },
  ];
  const card: string[] = [fmtInt(stats.totalTrips), 'rides in one day.'];
  if (stats.straightLineKm) card.push(distanceComparison(stats.straightLineKm));
  captions.push({ id: 'card', from: 6.35, to: 7.8, kind: 'card', lines: card });
  return captions;
}

// The live counter stays hidden while the hook caption says the number, so
// the two never disagree; it fades in as the city wakes.
export function counterOpacity(captions: Caption[], t: number): number {
  const hook = captions.find(c => c.id === 'hook');
  if (!hook) return 1;
  return Math.min(1, Math.max(0, (t - hook.to + 0.1) / 0.3));
}

// 0..1 visibility with short fades, so captions never pop.
export function captionOpacity(c: Caption, t: number, fade = 0.2): number {
  if (t < c.from || t > c.to) return 0;
  return Math.min(1, (t - c.from) / fade, (c.to - t) / fade);
}

// Darken the map under the end card, and lift it again before the loop restarts.
export function dimAmount(t: number): number {
  if (t < 6.2) return 0;
  if (t < 6.8) return 0.6 * ((t - 6.2) / 0.6);
  if (t < 7.6) return 0.6;
  return 0.6 * Math.max(0, (CLIP_SECONDS - t) / 0.4);
}

// Bikes in motion at an instant, from the full-day curve (not the 6k sample).
export function activeAt(stats: DayStats, epochMs: number): number | null {
  const curve = stats.activeByMinute;
  if (!curve) return null;
  const i = Math.floor((epochMs - curve.startEpochMs) / curve.stepMs);
  if (i < 0) return curve.values[0] ?? 0;
  if (i >= curve.values.length) return 0;
  return curve.values[i];
}

// Slow camera drift that returns to where it started at the loop point.
export function cameraAt(format: ClipFormat, t: number, stageHeightPx: number) {
  const { view } = FORMATS[format];
  const phase = Math.sin((2 * Math.PI * t) / CLIP_SECONDS);
  return {
    ...view,
    zoom: zoomForHeight(format, stageHeightPx) + 0.06 * (1 - Math.cos((2 * Math.PI * t) / CLIP_SECONDS)),
    bearing: view.bearing + 3 * phase,
  };
}

// Local midnight of the story day, in epoch ms (EDT or EST as the date needs).
export function nyMidnightEpochMs(date: string): number {
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${date}T12:00:00Z`))
    .find(p => p.type === 'timeZoneName')?.value ?? 'GMT-05:00';
  const offset = offsetName.replace('GMT', '') || '+00:00';
  return new Date(`${date}T00:00:00${offset}`).getTime();
}
