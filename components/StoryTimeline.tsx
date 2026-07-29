import React from 'react';

// Shape of /data/day-stats.json (see MapViewport data fetching).
export interface DayStats {
  date: string;        // ISO date, e.g. "2026-06-10"
  totalTrips: number;
  peakMinute: string;  // e.g. "08:45"
  peakEpochMs: number;
  peakActive: number;
}

interface StoryTimelineProps {
  minTime: number;
  maxTime: number;
  currentTime: number;
  onTimeChange: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  dayStats: DayStats | null;
}

export default function StoryTimeline({
  minTime,
  maxTime,
  currentTime,
  onTimeChange,
  isPlaying,
  onTogglePlay,
  dayStats
}: StoryTimelineProps) {
  // Format timestamps back into a local string for the HUD
  const formatTime = (ms: number) => {
    // If it's pure 0, display a generic label
    if (ms === 0) return "--:--";
    const d = new Date(ms);
    return d.toLocaleTimeString('en-US', { timeStyle: 'short', timeZone: 'America/New_York' });
  };

  // Format day-stats.date into an editorial label, e.g. "Wednesday, June 10, 2026".
  // Anchor at local noon so the weekday/day never rolls across a timezone boundary.
  const formatDate = (dateStr: string) => {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const storyLabel = dayStats
    ? `${formatDate(dayStats.date)} · One day of Citi Bike`
    : 'One day of Citi Bike';

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-3xl z-50 pointer-events-auto">
      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-700/60 p-5 rounded-2xl shadow-2xl flex flex-col gap-3 text-white">
        
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-bold text-slate-100 tabular-nums">
              {formatTime(currentTime)}
            </h2>
            <p className="text-xs text-slate-400 font-medium tracking-wide">
              {storyLabel}
            </p>
            {dayStats && (
              <p className="text-[10px] text-slate-500 font-medium tracking-wide mt-0.5">
                Peak: {dayStats.peakActive} bikes in motion at {formatTime(dayStats.peakEpochMs)}
              </p>
            )}
            <p className="text-[10px] text-slate-500 tracking-wide mt-0.5">
              Routes are OSRM-estimated bicycle paths, not GPS traces
            </p>
          </div>
          
          <button 
            onClick={onTogglePlay}
            className="w-12 h-12 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center border border-slate-600 transition-all shadow-md active:scale-95"
          >
            {isPlaying ? (
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
            ) : (
              <svg className="w-5 h-5 fill-current ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
        </div>
        
        <div className="relative group w-full pt-3">
          <input 
            type="range"
            min={minTime}
            max={maxTime}
            value={currentTime}
            onChange={(e) => onTimeChange(Number(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
          />
        </div>
        
        <div className="flex justify-between text-[10px] text-slate-500 font-mono uppercase tracking-widest mt-1">
          <span>{formatTime(minTime)}</span>
          <span>{formatTime(maxTime)}</span>
        </div>

      </div>

      {/* Keyboard Controls Reference */}
      <div className="absolute right-[-240px] top-0 bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 text-xs text-slate-400 font-mono flex flex-col gap-2 pointer-events-none hidden lg:flex">
        <div className="text-slate-300 font-bold mb-1 uppercase tracking-wider text-[10px]">Camera Controls</div>
        <div className="flex justify-between gap-4"><span>Scroll</span> <span className="text-slate-500">Zoom</span></div>
        <div className="flex justify-between gap-4"><span>Click + Drag</span> <span className="text-slate-500">Pan</span></div>
        <div className="flex justify-between gap-4"><span>Shift + Drag</span> <span className="text-slate-500">Rotate</span></div>
      </div>
      
    </div>
  );
}
