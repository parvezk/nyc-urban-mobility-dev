import {
  CLIP_FPS, CLIP_SECONDS, DayStats, activeAt, buildCaptions, buildKeyframes,
  captionOpacity, cameraAt, counterOpacity, dimAmount, distanceComparison, interpolateMonotone,
  nyMidnightEpochMs, parseFormat, zoomForHeight, FORMATS,
} from './story';

const MIDNIGHT = nyMidnightEpochMs('2026-06-10');
const at = (h: number, m: number) => MIDNIGHT + (h * 60 + m) * 60000;

const STATS: DayStats = {
  date: '2026-06-10',
  totalTrips: 197490,
  peakMinute: '17:53',
  peakEpochMs: at(17, 53),
  peakActive: 4280,
  nightLow: { minute: '03:43', epochMs: at(3, 43), active: 58 },
  morningPeak: { minute: '08:44', epochMs: at(8, 44), active: 3186 },
  straightLineKm: 408857,
  activeByMinute: { startEpochMs: MIDNIGHT, stepMs: 60000, values: [32, 75, 111] },
};

describe('nyMidnightEpochMs', () => {
  it('uses EDT in summer and EST in winter', () => {
    expect(new Date(nyMidnightEpochMs('2026-06-10')).toISOString()).toBe('2026-06-10T04:00:00.000Z');
    expect(new Date(nyMidnightEpochMs('2026-01-15')).toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });
});

describe('story clock', () => {
  const keys = buildKeyframes(STATS, MIDNIGHT);

  it('runs night to night across the loop', () => {
    expect(keys[0].t).toBe(0);
    expect(keys[keys.length - 1].t).toBe(CLIP_SECONDS);
    expect(interpolateMonotone(keys, 0)).toBeCloseTo(3.67, 1);
    expect(interpolateMonotone(keys, CLIP_SECONDS)).toBe(24.5);
  });

  it('hits the morning and evening peaks on their beats', () => {
    expect(interpolateMonotone(keys, 2.8)).toBeCloseTo(8 + 44 / 60, 5);
    expect(interpolateMonotone(keys, 5.1)).toBeCloseTo(17 + 53 / 60, 5);
  });

  it('never runs backwards', () => {
    let prev = -Infinity;
    for (let f = 0; f <= CLIP_SECONDS * CLIP_FPS; f++) {
      const h = interpolateMonotone(keys, f / CLIP_FPS);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  it('keeps keyframes rising on odd days', () => {
    const odd = { ...STATS, peakEpochMs: at(9, 0) }; // peak right after the morning peak
    const k = buildKeyframes(odd, MIDNIGHT);
    for (let i = 1; i < k.length; i++) expect(k[i].hour).toBeGreaterThan(k[i - 1].hour);
  });
});

describe('captions', () => {
  it('reads the numbers from the day, not from the code', () => {
    const lines = buildCaptions(STATS).flatMap(c => c.lines);
    expect(lines).toEqual([
      'Only 58 Citi Bikes are moving.',
      'Then New York wakes up.',
      'Rush hour: 4,280 bikes at once.',
      '197,490',
      'rides in one day.',
      'Farther than the Moon.',
    ]);
  });

  it('falls back when an older day-stats.json has no story fields', () => {
    const { nightLow, straightLineKm, ...old } = STATS;
    const captions = buildCaptions(old);
    expect(captions[0].lines[0]).toBe('New York is asleep.');
    expect(captions[captions.length - 1].lines).toEqual(['197,490', 'rides in one day.']);
  });

  it('fades in and out', () => {
    const hook = buildCaptions(STATS)[0];
    expect(captionOpacity(hook, 0)).toBe(0);
    expect(captionOpacity(hook, 1)).toBe(1);
    expect(captionOpacity(hook, 2)).toBe(0);
  });

  it('hides the live counter while the hook states the number', () => {
    const captions = buildCaptions(STATS);
    expect(counterOpacity(captions, 0)).toBe(0);
    expect(counterOpacity(captions, 1.5)).toBe(0);
    expect(counterOpacity(captions, 2.2)).toBe(1);
  });
});

describe('distanceComparison', () => {
  it('picks a plain comparison', () => {
    expect(distanceComparison(408857)).toBe('Farther than the Moon.');
    expect(distanceComparison(800000)).toBe('To the Moon and back.');
    expect(distanceComparison(130000)).toBe('3 times around the Earth.');
    expect(distanceComparison(50000)).toBe('Once around the Earth.');
    expect(distanceComparison(12345)).toBe('12,345 km of riding.');
  });
});

describe('loop seams', () => {
  it('starts and ends undimmed with the camera back home', () => {
    expect(dimAmount(0)).toBe(0);
    expect(dimAmount(CLIP_SECONDS)).toBe(0);
    expect(dimAmount(7)).toBeCloseTo(0.6);
    const a = cameraAt('9x16', 0, 1920);
    const b = cameraAt('9x16', CLIP_SECONDS, 1920);
    expect(b.bearing).toBeCloseTo(a.bearing, 6);
    expect(b.zoom).toBeCloseTo(a.zoom, 6);
  });
});

describe('formats', () => {
  it('defaults to vertical and scales zoom with stage size', () => {
    expect(parseFormat(undefined)).toBe('9x16');
    expect(parseFormat('16x9')).toBe('16x9');
    expect(zoomForHeight('9x16', 1920)).toBe(FORMATS['9x16'].view.zoom);
    expect(zoomForHeight('9x16', 960)).toBeCloseTo(FORMATS['9x16'].view.zoom - 1);
  });
});

describe('activeAt', () => {
  it('reads the per-minute curve', () => {
    expect(activeAt(STATS, MIDNIGHT + 90000)).toBe(75);
    expect(activeAt(STATS, MIDNIGHT + 10 * 60000)).toBe(0);
    expect(activeAt({ ...STATS, activeByMinute: undefined }, MIDNIGHT)).toBeNull();
  });
});
