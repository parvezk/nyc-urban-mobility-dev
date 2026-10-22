import { pickDay } from './dayData';

const index = { days: ['2026-09-16', { date: '2026-09-17' }, '2026-09-20'], presets: { default: '2026-09-17', busiest: '2026-09-20' } };

describe('pickDay', () => {
  it('takes an existing date, then a preset, then the default', () => {
    expect(pickDay(index, '2026-09-16')).toBe('2026-09-16');
    expect(pickDay(index, 'busiest')).toBe('2026-09-20');
    expect(pickDay(index, '2026-01-01')).toBe('2026-09-17');
    expect(pickDay(index, null)).toBe('2026-09-17');
  });

  it('falls back to the latest day without presets', () => {
    expect(pickDay({ days: ['2026-09-01', '2026-09-02'] }, undefined)).toBe('2026-09-02');
    expect(pickDay({ days: [] }, undefined)).toBeNull();
  });
});
