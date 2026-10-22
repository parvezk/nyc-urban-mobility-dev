"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDayStats, resolveDay } from '@/lib/dayData';
import type { DayStats } from '@/lib/clip/story';
import { formatStoryDate } from '@/lib/clip/story';
import { loadAllRides, loadSampleRides, type RideSet } from '@/lib/lite/rides';
import { LiteRenderer } from '@/lib/lite/renderer';
import {
  LITE_FPS,
  LITE_FRAMES,
  LITE_SECONDS,
  activeAtHour,
  clockLabel,
  counterOpacity,
  dayStartMs,
  dimAt,
  driftAt,
  fadeWindow,
  hourAt,
  liteCaptions,
  liteKeyframes,
  scopeToManhattan,
} from '@/lib/lite/timeline';
import LiteStatsCard, { sparkX } from './LiteStatsCard';

// One day of Citi Bike, lite: a 10-second canvas loop plus the day's numbers.
// No map library, no buildings, no scrubber. The animation runs outside React:
// the frame loop paints the canvas and moves text through refs.

export type RidesMode = 'all' | 'sample';

interface Props {
  day?: string;
  record: boolean;
  rides?: RidesMode;
}

interface Loaded {
  stats: DayStats;
  manhattan: boolean;
  rides: RideSet;
  startMs: number;
}

interface ClipApi {
  frames: number;
  fps: number;
  isReady: () => boolean;
  seek: (frame: number) => Promise<void>;
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

export default function LitePlayer({ day, record, rides: ridesParam }: Props) {
  const ridesMode: RidesMode = ridesParam ?? (record ? 'all' : 'sample');
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driftRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const captionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const nowRef = useRef<SVGLineElement>(null);
  const nowRefSide = useRef<SVGLineElement>(null);

  const rendererRef = useRef<LiteRenderer | null>(null);
  const clock = useRef({ t: 0, prevT: -1, prevHour: 0, playing: true, frame: -1 });

  // ---- data -------------------------------------------------------------
  useEffect(() => {
    let dead = false;
    (async () => {
      const sources = await resolveDay(day);
      const { stats, manhattan } = scopeToManhattan(await loadDayStats(sources));
      const startMs = dayStartMs(stats);
      let rides: RideSet | null = null;
      if (ridesMode === 'all' && sources.date) {
        rides = await loadAllRides(sources.date).catch(() => null);
      }
      rides ??= await loadSampleRides(sources.tripsUrl, startMs);
      if (!dead) setData({ stats, manhattan, rides, startMs });
    })().catch(e => !dead && setError(String(e?.message ?? e)));
    return () => { dead = true; };
  }, [day, ridesMode]);

  // ---- stage size -----------------------------------------------------------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      setSize(s => (s && Math.abs(s.w - w) < 2 && Math.abs(s.h - h) < 2 ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const story = useMemo(() => {
    if (!data) return null;
    return {
      keys: liteKeyframes(data.stats, data.startMs),
      captions: liteCaptions(data.stats),
    };
  }, [data]);

  // ---- one frame: advance the trails, then paint canvas and words ---------
  const step = useCallback((t: number, dt: number, paint: boolean) => {
    const r = rendererRef.current;
    if (!r || !story || !data) return;
    const c = clock.current;
    const hour = hourAt(story.keys, t);
    if (c.prevT < 0 || t < c.prevT) {
      r.clear();
      c.prevHour = hour;
    }
    r.fade(dt);
    r.drawWindow(c.prevHour, hour);
    c.prevHour = hour;
    c.prevT = t;
    if (!paint) return;

    r.present();
    const d = driftAt(t);
    if (driftRef.current) driftRef.current.style.transform = `scale(${d.scale.toFixed(4)}) rotate(${d.rotateDeg.toFixed(3)}deg)`;
    if (dimRef.current) dimRef.current.style.opacity = dimAt(t).toFixed(3);
    if (clockRef.current) clockRef.current.textContent = clockLabel(hour);
    const active = activeAtHour(data.stats, data.startMs, hour);
    if (countRef.current && active !== null) countRef.current.textContent = active.toLocaleString('en-US');
    if (counterRef.current) counterRef.current.style.opacity = (active === null ? 0 : counterOpacity(t)).toFixed(3);
    for (const cap of story.captions) {
      const el = captionRefs.current[cap.id];
      if (el) el.style.opacity = fadeWindow(t, cap.from, cap.to, cap.id === 'card' ? 0.3 : 0.2).toFixed(3);
    }
    const x = sparkX(hour).toFixed(1);
    for (const line of [nowRef.current, nowRefSide.current]) {
      line?.setAttribute('x1', x);
      line?.setAttribute('x2', x);
    }
  }, [story, data]);

  // ---- renderer (rebuilt when the stage or the data changes) --------------
  useEffect(() => {
    if (!data || !size || !canvasRef.current || size.w < 10 || size.h < 10) return;
    const dpr = record ? 1 : Math.min(2, window.devicePixelRatio || 1);
    rendererRef.current = new LiteRenderer(canvasRef.current, data.rides, { width: size.w, height: size.h, dpr });
    clock.current.prevT = -1;
    clock.current.frame = -1;
    return () => { rendererRef.current = null; };
  }, [data, size, record]);

  // ---- live playback ------------------------------------------------------------
  useEffect(() => {
    if (record || !story) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const c = clock.current;
      if (c.playing) {
        c.t = (c.t + dt) % LITE_SECONDS;
        step(c.t, dt, true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [record, story, step]);

  // ---- recorder hooks: deterministic frame stepping ---------------------------
  useEffect(() => {
    if (!record) return;
    const dt = 1 / LITE_FPS;
    const api: ClipApi = {
      frames: LITE_FRAMES,
      fps: LITE_FPS,
      isReady: () => rendererRef.current !== null && story !== null,
      seek: async (frame: number) => {
        const c = clock.current;
        const target = ((frame % LITE_FRAMES) + LITE_FRAMES) % LITE_FRAMES;
        if (target !== c.frame + 1) {
          // Replay from the top so the trails are exactly what playback shows.
          c.prevT = -1;
          for (let f = 0; f < target; f++) step(f * dt, dt, false);
        }
        step(target * dt, dt, true);
        c.frame = target;
        await nextFrame();
        await nextFrame();
      },
    };
    (window as unknown as { __clip?: ClipApi }).__clip = api;
    return () => { delete (window as unknown as { __clip?: ClipApi }).__clip; };
  }, [record, story, step]);

  const togglePlay = () => {
    clock.current.playing = !clock.current.playing;
    setPaused(!clock.current.playing);
  };
  const restart = () => {
    clock.current.t = 0;
    clock.current.prevT = -1;
    clock.current.playing = true;
    setPaused(false);
  };

  const stats = data?.stats;
  const caption = (id: string) => story?.captions.find(c => c.id === id);
  const card = caption('card');
  const fine = stats
    ? `${stats.date ? formatStoryDate(stats.date) : ''} · Citi Bike trip data${data && !data.manhattan ? ' (all of NYC)' : ''} · routes are estimated${
        data && data.rides.source === 'sample' ? ` · ${data.rides.count.toLocaleString('en-US')} rides drawn` : ''
      }`
    : '';

  const stage = (
    <div
      ref={stageRef}
      className="relative overflow-hidden bg-[#0b0c0f] text-white"
      style={{
        containerType: 'size',
        ...(record
          ? { position: 'fixed', inset: 0 }
          : { width: '100%', height: '100%' }),
      }}
    >
      <div ref={driftRef} className="absolute inset-0" style={{ transformOrigin: '50% 55%' }}>
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      </div>
      <div ref={dimRef} className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 0 }} />

      <div className="pointer-events-none absolute inset-0" style={{ textShadow: '0 1px 10px rgba(0,0,0,0.8)' }}>
        <div className="absolute flex flex-col" style={{ top: '6cqmin', left: '6cqmin', gap: '1.4cqmin' }}>
          <div className="font-semibold uppercase" style={{ fontSize: '2.55cqmin', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.68)' }}>
            One day of Citi Bike{data?.manhattan ? ' · Manhattan' : ''}
          </div>
          <div ref={clockRef} className="font-extrabold tabular-nums leading-none" style={{ fontSize: '10.6cqmin', letterSpacing: '-0.01em' }}>
            {null}
          </div>
          <div ref={counterRef} className="font-medium" style={{ fontSize: '3.7cqmin', color: 'rgba(255,255,255,0.88)', opacity: 0 }}>
            <span ref={countRef} className="font-bold tabular-nums text-white" /> bikes moving
          </div>
        </div>

        {story?.captions.filter(c => c.id !== 'card').map(c => (
          <div
            key={c.id}
            ref={el => { captionRefs.current[c.id] = el; }}
            className="absolute left-0 right-0 text-center font-semibold"
            style={{ bottom: '16.7cqh', padding: '0 6.5cqmin', fontSize: '5.3cqmin', lineHeight: 1.2, opacity: 0, textShadow: '0 1px 12px rgba(0,0,0,0.85)' }}
          >
            {c.lines[0]}
          </div>
        ))}

        {card && (
          <div
            ref={el => { captionRefs.current.card = el; }}
            className="absolute inset-0 flex flex-col items-center justify-center text-center"
            style={{ padding: '0 6.5cqmin', opacity: 0, textShadow: '0 1px 14px rgba(0,0,0,0.85)' }}
          >
            <div className="font-extrabold tabular-nums" style={{ fontSize: '14.4cqmin', lineHeight: 1, letterSpacing: '-0.02em' }}>{card.lines[0]}</div>
            <div className="font-semibold" style={{ fontSize: '5.3cqmin', marginTop: '1.9cqmin' }}>{card.lines[1]}</div>
            {card.lines[2] && (
              <div className="font-semibold" style={{ fontSize: '5.3cqmin', marginTop: '5cqmin', color: '#FFA648' }}>{card.lines[2]}</div>
            )}
          </div>
        )}

        <div className="absolute left-0 right-0 text-center" style={{ bottom: '3.7cqmin', fontSize: '2.3cqmin', color: 'rgba(255,255,255,0.62)', padding: '0 4cqmin' }}>
          {fine}
        </div>
      </div>

      {!data && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-white/80">
          {error ? 'The trip data could not be loaded.' : 'Loading one day of rides…'}
        </div>
      )}
    </div>
  );

  if (record) return stage;

  const button = 'h-9 min-w-[44px] rounded-full bg-[#1d2026] px-3.5 text-[13px] font-semibold text-white hover:bg-[#2a2e36] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

  return (
    <main className="flex min-h-[100svh] w-full items-center justify-center gap-8 bg-[#050608] text-white lg:p-6">
      {/* Phones: the loop fills the screen. Wider screens: a 9:16 column. */}
      <div className="relative flex h-[100svh] w-full flex-col lg:h-[min(92svh,1100px)] lg:w-auto lg:aspect-[9/16.6]">
        <div className="relative min-h-0 flex-1 lg:overflow-hidden lg:rounded-xl">{stage}</div>
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-3.5">
          <button type="button" className={button} onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
            {paused ? 'Play' : 'Pause'}
          </button>
          <button type="button" className={button} onClick={restart} aria-label="Restart the loop">Restart</button>
          {stats && (
            <button
              type="button"
              className={`${button} ml-auto lg:hidden`}
              onClick={() => setStatsOpen(o => !o)}
              aria-expanded={statsOpen}
              aria-controls="lite-stats-sheet"
            >
              {statsOpen ? 'Close' : 'The day in numbers'}
            </button>
          )}
          <div className="ml-auto hidden text-xs text-white/60 lg:block">10 s loop</div>
        </div>
        {stats && data && statsOpen && (
          <div id="lite-stats-sheet" className="absolute inset-x-3 bottom-16 flex justify-center lg:hidden">
            <LiteStatsCard stats={stats} dayStartMs={data.startMs} nowRef={nowRef} scope={data.manhattan ? 'Manhattan' : undefined} />
          </div>
        )}
      </div>

      {stats && data && (
        <aside className="hidden lg:block">
          <LiteStatsCard stats={stats} dayStartMs={data.startMs} nowRef={nowRefSide} scope={data.manhattan ? 'Manhattan' : undefined} />
        </aside>
      )}
    </main>
  );
}
