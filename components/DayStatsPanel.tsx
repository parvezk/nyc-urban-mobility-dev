"use client";

import React, { useMemo, useState } from 'react';
import type { DayStats } from '@/lib/clip/story';
import { distanceComparison, formatClock, formatStoryDate } from '@/lib/clip/story';

// The day at a glance: a "shape of the day" line plus the headline numbers.
// Rows with a time jump the map's clock to that moment.

const SPARK_W = 276;
const SPARK_H = 48;
const FROM_MIN = 3 * 60;   // 3 AM: skips the first hour, which misses rides begun the day before
const TO_MIN = 24 * 60;
const BUCKET_MIN = 10;

interface DayStatsPanelProps {
  stats: DayStats;
  currentTime: number;
  onJump: (epochMs: number) => void;
}

interface Row {
  label: string;
  value: string;
  unit?: string;    // follows the value: "58 bikes"
  detail?: string;  // after a dot: "· 3:43 AM"
  jumpTo?: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export default function DayStatsPanel({ stats, currentTime, onJump }: DayStatsPanelProps) {
  const [open, setOpen] = useState(true);
  const curve = stats.activeByMinute;

  const spark = useMemo(() => {
    if (!curve) return null;
    const x = (minute: number) => ((minute - FROM_MIN) / (TO_MIN - FROM_MIN)) * SPARK_W;
    const y = (v: number) => SPARK_H - 2 - (v / stats.peakActive) * (SPARK_H - 8);
    const pts: string[] = [];
    for (let m = FROM_MIN; m < TO_MIN && m < curve.values.length; m += BUCKET_MIN) {
      const v = Math.max(...curve.values.slice(m, m + BUCKET_MIN));
      pts.push(`${x(m).toFixed(1)} ${y(v).toFixed(1)}`);
    }
    const line = `M${pts.join(' L')}`;
    const minuteOf = (epochMs: number) => (epochMs - curve.startEpochMs) / 60000;
    const marks = [stats.nightLow, stats.morningPeak, { epochMs: stats.peakEpochMs, active: stats.peakActive }]
      .filter((m): m is { epochMs: number; active: number } => Boolean(m))
      .map(m => ({ cx: x(minuteOf(m.epochMs)), cy: y(m.active) }));
    return { line, area: `${line} L${SPARK_W} ${SPARK_H} L0 ${SPARK_H} Z`, marks, x, minuteOf };
  }, [curve, stats]);

  const rows: Row[] = [];
  if (stats.nightLow) {
    rows.push({ label: 'Quietest minute', value: fmt(stats.nightLow.active), unit: 'bikes', detail: formatClock(stats.nightLow.epochMs), jumpTo: stats.nightLow.epochMs });
  }
  if (stats.morningPeak) {
    rows.push({ label: 'Morning peak', value: fmt(stats.morningPeak.active), detail: formatClock(stats.morningPeak.epochMs), jumpTo: stats.morningPeak.epochMs });
  }
  rows.push({ label: 'Day peak', value: fmt(stats.peakActive), detail: formatClock(stats.peakEpochMs), jumpTo: stats.peakEpochMs });
  rows.push({ label: 'Rides', value: fmt(stats.totalTrips) });
  if (stats.straightLineKm) {
    rows.push({
      label: 'Distance',
      value: `${fmt(Math.floor(stats.straightLineKm / 1000) * 1000)}+ km`,
      detail: lowerFirst(distanceComparison(stats.straightLineKm).replace(/\.$/, '')),
    });
  }
  if (stats.ebikeShare !== undefined) {
    rows.push({ label: 'E-bikes', value: `${Math.round(stats.ebikeShare * 100)}%`, unit: 'of rides' });
  }
  if (stats.medianRideMinutes !== undefined) {
    rows.push({
      label: 'Typical ride',
      value: `${Math.round(stats.medianRideMinutes)} min`,
      detail: stats.medianRideKm !== undefined ? `${stats.medianRideKm.toFixed(1)} km` : undefined,
    });
  }

  const nowX = spark ? spark.x(Math.min(TO_MIN, Math.max(FROM_MIN, spark.minuteOf(currentTime)))) : 0;

  return (
    <section
      aria-label="One day of Citi Bike, at a glance"
      className="absolute top-4 left-4 z-50 w-[320px] max-w-[calc(100vw-2rem)] bg-slate-900/80 backdrop-blur-xl border border-slate-700/60 rounded-2xl shadow-2xl text-white"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h1 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">One day of Citi Bike</h1>
          <p className="text-lg font-bold leading-tight mt-1">{formatStoryDate(stats.date)}</p>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="shrink-0 h-8 px-3 rounded-full bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {open ? 'Hide' : 'Stats'}
        </button>
      </div>

      {open && (
        <div className="px-5 pb-4">
          {spark && (
            <div className="mb-2">
              <svg
                width={SPARK_W}
                height={SPARK_H}
                viewBox={`0 -4 ${SPARK_W} ${SPARK_H + 4}`}
                role="img"
                aria-label="Bikes in motion from 3 AM to midnight"
                className="block w-full h-auto overflow-visible"
              >
                <path d={spark.area} fill="rgba(255,166,72,0.16)" />
                <path d={spark.line} fill="none" stroke="#FFA648" strokeWidth={1.6} strokeLinejoin="round" />
                <line x1={nowX} x2={nowX} y1={-4} y2={SPARK_H} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
                {spark.marks.map((m, i) => (
                  <circle key={i} cx={m.cx} cy={m.cy} r={3} fill="#ffffff" />
                ))}
              </svg>
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>3 AM</span>
                <span>Noon</span>
                <span>Midnight</span>
              </div>
            </div>
          )}

          <div className="text-[13px]">
            {rows.map(r => {
              const content = (
                <>
                  <span className="text-slate-400">{r.label}</span>
                  <span className="text-right">
                    <span className="font-bold tabular-nums text-white">{r.value}</span>
                    {r.unit && <span className="text-slate-300"> {r.unit}</span>}
                    {r.detail && <span className="text-slate-300"> · {r.detail}</span>}
                  </span>
                </>
              );
              return r.jumpTo !== undefined ? (
                <button
                  key={r.label}
                  onClick={() => onJump(r.jumpTo as number)}
                  title={`Jump to ${formatClock(r.jumpTo)}`}
                  className="w-full flex justify-between items-baseline gap-3 py-1.5 border-t border-white/5 text-left hover:bg-white/5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  {content}
                </button>
              ) : (
                <div key={r.label} className="flex justify-between items-baseline gap-3 py-1.5 border-t border-white/5">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
