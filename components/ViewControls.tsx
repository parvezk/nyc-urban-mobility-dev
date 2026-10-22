"use client";

import React from 'react';
import type { DaysIndex, DayEntry } from '@/lib/dayData';
import type { DayStats } from '@/lib/clip/story';
import { useViewStore, BikeFilter, RiderFilter } from '@/lib/store/viewStore';

// Data colors, shared with the TripsLayer in MapViewport.
export const EBIKE_RGB: [number, number, number] = [23, 184, 190];
export const CLASSIC_RGB: [number, number, number] = [253, 128, 93];
const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

interface Option<T extends string> {
  value: T;
  label: string;
  sub?: string;
  dot?: string;
}

function Segmented<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl bg-black/5 p-1">
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-black/5'
            }`}
          >
            <span className="flex items-center gap-1.5 font-medium">
              {o.dot && <span className="inline-block h-2 w-2 rounded-full" style={{ background: o.dot }} />}
              {o.label}
            </span>
            {o.sub && (
              <span className={`block text-[10px] ${active ? 'text-slate-600' : 'text-slate-500'}`}>{o.sub}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const pct = (x?: number) => (x == null ? null : `${Math.round(x * 100)}%`);

function shortDate(date: string) {
  // Noon anchor so the weekday never rolls across a timezone boundary.
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

interface ViewControlsProps {
  index: DaysIndex | null;
  currentDate: string | null;   // the day actually loaded
  stats: DayStats | null;
  shown: number;                // rides drawn after filters
  total: number;                // rides in the loaded sample
  hasRiderData: boolean;        // older trip files lack member/casual
  allRides?: boolean;           // true when every ride is drawn, not a sample
}

export default function ViewControls({ index, currentDate, stats, shown, total, hasRiderData, allRides = false }: ViewControlsProps) {
  const { bike, rider, setDay, setBike, setRider } = useViewStore();

  const entries: DayEntry[] = (index?.days ?? []).map(d => (typeof d === 'string' ? { date: d } : d));
  const presets = index?.presets ?? {};
  const dayOptions: Option<string>[] = [];
  if (presets.default) dayOptions.push({ value: presets.default, label: 'Typical weekday', sub: shortDate(presets.default) });
  if (presets.busiest && presets.busiest !== presets.default) {
    dayOptions.push({ value: presets.busiest, label: 'Busiest day', sub: shortDate(presets.busiest) });
  }
  const busiest = entries.find(e => e.date === presets.busiest);

  const bikeOptions: Option<BikeFilter>[] = [
    { value: 'all', label: 'All bikes' },
    { value: 'electric', label: 'E-bike', dot: rgb(EBIKE_RGB) },
    { value: 'classic', label: 'Classic', dot: rgb(CLASSIC_RGB) },
  ];
  const riderOptions: Option<RiderFilter>[] = [
    { value: 'all', label: 'All riders' },
    { value: 'member', label: 'Members' },
    { value: 'casual', label: 'Casual' },
  ];

  const ebike = pct(stats?.ebikeShare);
  const members = pct(stats?.memberShare);

  return (
    <div className="absolute top-4 right-4 z-50 w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl border border-black/5 bg-[#FAFAF8]/90 p-4 text-slate-900 shadow-[0_10px_40px_rgba(20,22,30,0.14)] backdrop-blur-xl flex flex-col gap-4">
      {dayOptions.length > 1 && currentDate && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Day{index?.monthLabel ? ` · ${index.monthLabel}` : ''}
          </h3>
          <Segmented label="Day" value={currentDate} options={dayOptions} onChange={setDay} />
          {busiest?.totalTrips != null && currentDate === presets.busiest && (
            <p className="text-[10px] text-slate-500">
              {busiest.totalTrips.toLocaleString('en-US')} rides, the most of any day this month
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Bike type</h3>
        <Segmented label="Bike type" value={bike} options={bikeOptions} onChange={setBike} />
        {ebike && <p className="text-[10px] text-slate-500">E-bikes carried {ebike} of the day&apos;s rides</p>}
      </section>

      {hasRiderData && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Rider</h3>
          <Segmented label="Rider" value={rider} options={riderOptions} onChange={setRider} />
          {members && <p className="text-[10px] text-slate-500">Annual members took {members} of rides</p>}
        </section>
      )}

      {total > 0 && (
        <p className="text-[10px] text-slate-500" aria-live="polite">
          {allRides
            ? `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rides`
            : `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} sampled rides`}
        </p>
      )}
    </div>
  );
}
