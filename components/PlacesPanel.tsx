"use client";

import React, { useState } from 'react';
import { MapPin, ChevronUp } from 'lucide-react';
import { hourRange, type Place } from '@/lib/places';

interface PlacesPanelProps {
  places: Place[];
  selectedId: string | null;
  onSelect: (place: Place) => void;
}

// A collapsed list of popular spots. Picking one flies the camera there; the
// map then calls out that spot's busiest hour when the clock reaches it.
export default function PlacesPanel({ places, selectedId, onSelect }: PlacesPanelProps) {
  const [open, setOpen] = useState(false);
  if (places.length === 0) return null;

  return (
    <div className="absolute left-4 bottom-44 lg:bottom-10 z-50 w-[260px] max-w-[calc(100vw-2rem)]">
      {open && (
        <ul
          id="places-list"
          className="mb-2 rounded-2xl border border-black/5 bg-[#FAFAF8]/90 p-1.5 shadow-[0_10px_40px_rgba(20,22,30,0.14)] backdrop-blur-xl"
        >
          {places.map(p => {
            const active = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p)}
                  aria-current={active}
                  className={`w-full rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                    active ? 'bg-slate-900 text-white' : 'text-slate-900 hover:bg-black/5'
                  }`}
                >
                  <span className="block text-[13px] font-semibold">{p.name}</span>
                  <span className={`block text-[11px] ${active ? 'text-white/70' : 'text-slate-500'}`}>
                    Busiest {hourRange(p.busiestHour.hour)} · {p.busiestHour.total.toLocaleString('en-US')} rides
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="places-list"
        className="flex h-11 items-center gap-2 rounded-full border border-black/5 bg-[#FAFAF8]/90 px-4 text-[13px] font-semibold text-slate-900 shadow-[0_10px_40px_rgba(20,22,30,0.14)] backdrop-blur-xl hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        <MapPin className="h-4 w-4" aria-hidden="true" />
        Places
        <ChevronUp className={`h-4 w-4 transition-transform ${open ? '' : 'rotate-180'}`} aria-hidden="true" />
      </button>
    </div>
  );
}
