"use client";

import React, { useMemo, useState } from 'react';
import type { DayStats } from '@/lib/clip/story';
import { distanceComparison, formatClock, formatStoryDate } from '@/lib/clip/story';
import { sunTimes } from '@/lib/lighting/sun';

// Field guide to the day: a "shape of the day" line, the day's chapters
// (click one to jump the clock there; the current one is highlighted as the
// day plays), then the headline numbers.

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
}

interface Chapter {
  title: string;
  caption?: string;
  at: number;       // epoch ms
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

  // Sunrise and sunset for this date sit between the ride moments as chapters.
  const sun = useMemo(() => sunTimes(stats.date), [stats.date]);
  const sunEpoch = (h: number | null) => (h === null ? null : sun.midnight + h * 3_600_000);
  const sunrise = sunEpoch(sun.sunrise);
  const sunset = sunEpoch(sun.sunset);

  const chapters: Chapter[] = [];
  if (stats.nightLow) {
    chapters.push({ title: 'Quietest minute', caption: `${fmt(stats.nightLow.active)} bikes moving. The city is asleep.`, at: stats.nightLow.epochMs });
  }
  if (sunrise !== null) chapters.push({ title: 'Sunrise', caption: 'New York starts to wake up.', at: sunrise });
  if (stats.morningPeak) {
    chapters.push({ title: 'Morning peak', caption: `${fmt(stats.morningPeak.active)} bikes moving. Morning rush.`, at: stats.morningPeak.epochMs });
  }
  chapters.push({ title: 'Day peak', caption: `${fmt(stats.peakActive)} bikes at once, the most all day.`, at: stats.peakEpochMs });
  if (sunset !== null) chapters.push({ title: 'Sunset', at: sunset });
  chapters.sort((x, y) => x.at - y.at);
  // The chapter the clock is in: the last one it has passed.
  let current = -1;
  chapters.forEach((c, i) => { if (currentTime >= c.at) current = i; });

  const rows: Row[] = [];
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
      className="absolute top-4 left-4 z-50 w-[320px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-7rem)] overflow-y-auto bg-[#FAFAF8]/90 backdrop-blur-xl border border-black/5 rounded-2xl shadow-[0_10px_40px_rgba(20,22,30,0.14)] text-slate-900"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h1 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">One day of Citi Bike · Manhattan</h1>
          <p className="text-lg font-bold leading-tight mt-1">{formatStoryDate(stats.date)}</p>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="shrink-0 h-8 px-3 rounded-full bg-black/5 hover:bg-black/10 text-xs font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
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
                {sunrise !== null && sunset !== null && (
                  <rect
                    x={spark.x(spark.minuteOf(sunrise))}
                    y={-4}
                    width={Math.max(0, spark.x(spark.minuteOf(sunset)) - spark.x(spark.minuteOf(sunrise)))}
                    height={SPARK_H + 4}
                    fill="rgba(245,165,36,0.10)"
                  />
                )}
                <path d={spark.area} fill="rgba(58,85,224,0.14)" />
                <path d={spark.line} fill="none" stroke="#3A55E0" strokeWidth={1.6} strokeLinejoin="round" />
                <line x1={nowX} x2={nowX} y1={-4} y2={SPARK_H} stroke="rgba(15,23,42,0.55)" strokeWidth={1} />
                {spark.marks.map((m, i) => (
                  <circle key={i} cx={m.cx} cy={m.cy} r={3} fill="#0f172a" />
                ))}
              </svg>
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>3 AM</span>
                <span>Noon</span>
                <span>Midnight</span>
              </div>
            </div>
          )}

          <ol aria-label="Chapters of the day" className="mb-3">
            {chapters.map((c, i) => {
              const active = i === current;
              return (
                <li key={c.title}>
                  <button
                    onClick={() => onJump(c.at)}
                    aria-current={active ? 'step' : undefined}
                    title={`Jump to ${formatClock(c.at)}`}
                    className={`group w-full grid grid-cols-[64px_1fr] gap-x-3 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                      active ? 'bg-slate-900 text-white' : 'hover:bg-black/5'
                    }`}
                  >
                    <span className={`text-[12px] font-semibold tabular-nums pt-px ${active ? 'text-white/80' : 'text-slate-500'}`}>
                      {formatClock(c.at)}
                    </span>
                    <span>
                      <span className="block text-[13px] font-semibold leading-snug">{c.title}</span>
                      {c.caption && (
                        <span className={`block text-[12px] leading-snug ${active ? 'text-white/75' : 'text-slate-600'}`}>{c.caption}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="text-[13px]">
            {rows.map(r => (
              <div key={r.label} className="flex justify-between items-baseline gap-3 py-1.5 border-t border-black/5">
                <span className="text-slate-500">{r.label}</span>
                <span className="text-right">
                  <span className="font-bold tabular-nums text-slate-900">{r.value}</span>
                  {r.unit && <span className="text-slate-600"> {r.unit}</span>}
                  {r.detail && <span className="text-slate-600"> · {r.detail}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
