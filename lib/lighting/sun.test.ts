import { daylightAt, nyMidnight, sunTimes } from './sun';

const hm = (h: number | null) => {
  if (h === null) return null;
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

describe('sun times for New York', () => {
  it('lands within a few minutes of typical NYC almanac times', () => {
    // Approximate almanac values for Manhattan (local time).
    const cases: [string, string, string][] = [
      ['2026-06-10', '5:25', '20:28'],
      ['2026-09-23', '6:46', '18:54'],
    ];
    const toMin = (s: string) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]);
    for (const [date, rise, set] of cases) {
      const t = sunTimes(date);
      expect(Math.abs(toMin(hm(t.sunrise)!) - toMin(rise))).toBeLessThanOrEqual(3);
      expect(Math.abs(toMin(hm(t.sunset)!) - toMin(set))).toBeLessThanOrEqual(3);
    }
  });

  it('is full day at noon and full night at 3 AM', () => {
    const m = nyMidnight('2026-09-23');
    expect(daylightAt(m + 13 * 3_600_000).day).toBeGreaterThan(0.99);
    expect(daylightAt(m + 3 * 3_600_000).night).toBeGreaterThan(0.99);
  });
});
