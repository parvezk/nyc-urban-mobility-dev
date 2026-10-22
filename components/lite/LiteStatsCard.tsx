import React, { useMemo } from 'react';
import { formatStoryDate, type DayStats } from '@/lib/clip/story';
import { clockLabel } from '@/lib/lite/timeline';

// The day in seven numbers, with a curve of bikes in motion from 3 AM to
// midnight. The playhead line is moved by the player (nowRef), not by React.

const SPARK_W = 312;
const SPARK_H = 52;
const FROM_H = 3;
const TO_H = 24;
const MOON_KM = 384400;
const EARTH_KM = 40075;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export const sparkX = (hour: number) =>
  Math.max(0, Math.min(SPARK_W, ((hour - FROM_H) / (TO_H - FROM_H)) * SPARK_W));

function distanceRow(km: number): { value: string; detail?: string } {
  const value = `${fmt(Math.floor(km / 1000) * 1000)}+ km`;
  if (km >= MOON_KM) return { value, detail: 'past the Moon' };
  if (km >= EARTH_KM) return { value, detail: `${Math.floor(km / EARTH_KM)}× around the Earth` };
  return { value };
}

interface Props {
  stats: DayStats;
  dayStartMs: number;
  nowRef?: React.Ref<SVGLineElement>;
  scope?: string;
}

export default function LiteStatsCard({ stats, dayStartMs, nowRef, scope }: Props) {
  const hourOf = (ms: number) => (ms - dayStartMs) / 3600000;

  const spark = useMemo(() => {
    const c = stats.activeByMinute;
    if (!c?.values.length) return null;
    // 10-minute maxima keep the peaks and drop the jitter.
    const pts: string[] = [];
    const bucket = 10;
    for (let m = FROM_H * 60; m < TO_H * 60; m += bucket) {
      let v = 0;
      for (let k = 0; k < bucket; k++) {
        const i = Math.floor((dayStartMs + (m + k) * 60000 - c.startEpochMs) / c.stepMs);
        if (i >= 0 && i < c.values.length) v = Math.max(v, c.values[i]);
      }
      const y = SPARK_H - 2 - (v / stats.peakActive) * (SPARK_H - 8);
      pts.push(`${sparkX(m / 60 + bucket / 120).toFixed(1)} ${y.toFixed(1)}`);
    }
    const line = `M${pts.join(' L')}`;
    return { line, area: `${line} L${SPARK_W} ${SPARK_H} L0 ${SPARK_H} Z` };
  }, [stats, dayStartMs]);

  const yOf = (v: number) => SPARK_H - 2 - (v / stats.peakActive) * (SPARK_H - 8);
  const marks = [
    stats.nightLow && { h: hourOf(stats.nightLow.epochMs), v: stats.nightLow.active },
    stats.morningPeak && { h: hourOf(stats.morningPeak.epochMs), v: stats.morningPeak.active },
    { h: hourOf(stats.peakEpochMs), v: stats.peakActive },
  ].filter(Boolean) as Array<{ h: number; v: number }>;

  const rows: Array<{ label: string; value: string; detail?: string }> = [];
  if (stats.nightLow) {
    rows.push({ label: 'Quietest minute', value: `${fmt(stats.nightLow.active)} bikes`, detail: clockLabel(hourOf(stats.nightLow.epochMs)) });
  }
  if (stats.morningPeak) {
    rows.push({ label: 'Morning peak', value: fmt(stats.morningPeak.active), detail: clockLabel(hourOf(stats.morningPeak.epochMs)) });
  }
  rows.push({ label: 'Day peak', value: fmt(stats.peakActive), detail: clockLabel(hourOf(stats.peakEpochMs)) });
  rows.push({ label: 'Rides', value: fmt(stats.totalTrips) });
  if (stats.straightLineKm) rows.push({ label: 'Distance', ...distanceRow(stats.straightLineKm) });
  if (stats.ebikeShare !== undefined) rows.push({ label: 'E-bikes', value: `${Math.round(stats.ebikeShare * 100)}%`, detail: 'of rides' });
  if (stats.medianRideMinutes !== undefined) {
    rows.push({
      label: 'Typical ride',
      value: `${Math.round(stats.medianRideMinutes)} min`,
      detail: stats.medianRideKm !== undefined ? `${stats.medianRideKm.toFixed(1)} km` : undefined,
    });
  }

  const label = `Bikes in motion from 3 AM to midnight, peaking at ${fmt(stats.peakActive)} at ${clockLabel(hourOf(stats.peakEpochMs))}`;

  return (
    <section
      aria-label="The day in numbers"
      className="w-[360px] max-w-full box-border flex flex-col gap-3.5 rounded-2xl px-[22px] py-5 text-white"
      style={{ background: 'rgba(15,17,22,0.96)', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}
    >
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">One day of Citi Bike{scope ? ` · ${scope}` : ''}</div>
        <div className="text-lg font-bold">{stats.date ? formatStoryDate(stats.date) : 'One day'}</div>
      </div>

      {spark && (
        <div className="flex flex-col gap-1">
          <svg width="100%" viewBox={`-2 -4 ${SPARK_W + 4} ${SPARK_H + 8}`} role="img" aria-label={label}>
            <path d={spark.area} fill="rgba(255,166,72,0.16)" />
            <path d={spark.line} fill="none" stroke="#FFA648" strokeWidth={1.6} strokeLinejoin="round" />
            {marks.map(m => (
              <circle key={m.h} cx={sparkX(m.h)} cy={yOf(m.v)} r={3} fill="#fff" />
            ))}
            <line ref={nowRef} x1={0} x2={0} y1={-4} y2={SPARK_H} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
          </svg>
          <div className="flex justify-between text-[10px] text-white/60">
            <span>3 AM</span>
            <span>Noon</span>
            <span>Midnight</span>
          </div>
        </div>
      )}

      <div className="flex flex-col text-[13px]">
        {rows.map(r => (
          <div key={r.label} className="flex items-baseline justify-between border-t border-white/[0.07] py-[7px]">
            <span className="text-white/70">{r.label}</span>
            <span>
              <b className="font-bold tabular-nums">{r.value}</b>
              {r.detail && <span className="text-white/80"> · {r.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
