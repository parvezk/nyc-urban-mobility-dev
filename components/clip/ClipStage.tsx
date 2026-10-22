"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { TripsLayer } from '@deck.gl/geo-layers';
import { PolygonLayer } from '@deck.gl/layers';
import MapGL, { MapRef } from 'react-map-gl/maplibre';
import { useClipClock } from '@/lib/clip/clock';
import {
  CLIP_FPS, CLIP_FRAMES, ClipFormat, DayStats, FORMATS,
  activeAt, buildCaptions, buildKeyframes, cameraAt, dimAmount,
  interpolateMonotone, nyMidnightEpochMs,
} from '@/lib/clip/story';
import { clipThemeAt } from '@/lib/clip/theme';
import ClipOverlay from './ClipOverlay';
import { loadDayStats, resolveDay } from '@/lib/dayData';

import 'maplibre-gl/dist/maplibre-gl.css';

const HOUR_MS = 3600000;

interface TripPath {
  vendor_type: string;
  path: [number, number, number][];
}

interface Building {
  polygon: number[][];
  height: number;
}

// Hook the recorder (scripts/record-clip.mjs) drives through Playwright.
declare global {
  interface Window {
    __clip?: {
      frames: number;
      fps: number;
      isReady: () => boolean;
      seek: (frame: number) => Promise<void>;
    };
  }
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

interface ClipStageProps {
  format: ClipFormat;
  record: boolean;
  day?: string;   // a date or a preset name ("busiest"); empty = the default day
}

export default function ClipStage({ format, record, day }: ClipStageProps) {
  const spec = FORMATS[format];
  const frame = useClipClock(s => s.frame);
  const setFrame = useClipClock(s => s.setFrame);
  const [playing, setPlaying] = useState(!record);

  const [trips, setTrips] = useState<TripPath[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [stats, setStats] = useState<DayStats | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef>(null);
  const [stageHeight, setStageHeight] = useState(spec.height);
  const renderWaiters = useRef<Array<() => void>>([]);

  // 1. Data
  useEffect(() => {
    fetch('/data/buildings.json').then(r => r.json()).then((d: Building[]) => setBuildings(d));
    resolveDay(day).then(sources => {
      loadDayStats(sources).then(setStats);
      fetch(sources.tripsUrl).then(r => r.json()).then((d: TripPath[]) => {
        if (Array.isArray(d)) setTrips(d);
      });
    });
  }, [day]);

  // 2. Keep framing identical at any preview size.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStageHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 3. Preview playback (the recorder steps frames itself).
  useEffect(() => {
    if (!playing || record) return;
    let raf = 0;
    const start = performance.now() - (useClipClock.getState().frame / CLIP_FPS) * 1000;
    const tick = (now: number) => {
      setFrame(((now - start) / 1000) * CLIP_FPS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, record, setFrame]);

  const ready = Boolean(stats && trips.length && mapLoaded);

  // 4. Recorder hook: seek resolves once deck has drawn the frame and the
  // basemap has its tiles, so a screenshot never catches a half-drawn map.
  const onAfterRender = useCallback(() => {
    const waiters = renderWaiters.current;
    renderWaiters.current = [];
    waiters.forEach(w => w());
  }, []);

  useEffect(() => {
    window.__clip = {
      frames: CLIP_FRAMES,
      fps: CLIP_FPS,
      isReady: () => ready,
      seek: async (f: number) => {
        const drawn = new Promise<void>(r => renderWaiters.current.push(r));
        setFrame(f);
        await Promise.race([drawn, new Promise(r => setTimeout(r, 2000))]);
        const map = mapRef.current?.getMap();
        const deadline = performance.now() + 5000;
        while (map && !(map.loaded() && map.areTilesLoaded()) && performance.now() < deadline) {
          await nextFrame();
        }
        await nextFrame();
        await nextFrame();
      },
    };
    return () => { delete window.__clip; };
  }, [ready, setFrame]);

  // 5. Story time for this frame
  const t = frame / CLIP_FPS;
  const dayStartMs = useMemo(() => (stats ? nyMidnightEpochMs(stats.date) : 0), [stats]);
  const keyframes = useMemo(() => (stats ? buildKeyframes(stats, dayStartMs) : null), [stats, dayStartMs]);
  const captions = useMemo(() => (stats ? buildCaptions(stats) : []), [stats]);

  const hour = keyframes ? interpolateMonotone(keyframes, t) : 0;
  const currentTime = dayStartMs + hour * HOUR_MS;

  // Longer trails when the clock races, so fast stretches don't look empty.
  const msPerFrame = keyframes
    ? (interpolateMonotone(keyframes, t + 1 / CLIP_FPS) - hour) * HOUR_MS
    : 0;
  const trailLength = Math.min(45 * 60000, Math.max(15 * 60000, msPerFrame * 4));

  const viewState = cameraAt(format, t, stageHeight);
  const scale = stageHeight / spec.height;
  const active = stats ? activeAt(stats, currentTime) : null;
  const theme = clipThemeAt(hour);

  const layers = [
    new PolygonLayer<Building>({
      id: 'buildings',
      data: buildings,
      extruded: true,
      opacity: theme.buildingOpacity,
      getPolygon: d => d.polygon,
      getElevation: d => d.height,
      getFillColor: theme.buildingColor,
    }),
    new TripsLayer<TripPath>({
      id: 'trips',
      data: trips,
      getPath: d => d.path.map(p => [p[0], p[1]] as [number, number]),
      getTimestamps: d => d.path.map(p => p[2]),
      getColor: theme.tripColor,
      opacity: 0.7,
      widthMinPixels: Math.max(2, 4 * scale),
      jointRounded: true,
      capRounded: true,
      fadeTrail: true,
      trailLength,
      currentTime,
      // Additive light: overlapping streaks burn toward white.
      parameters: {
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'one',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one-minus-src-alpha',
      },
    }),
  ];

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#07080a]">
      <div
        ref={stageRef}
        className="relative overflow-hidden"
        style={{
          background: theme.background,
          aspectRatio: `${spec.width} / ${spec.height}`,
          width: `min(100vw, calc(100vh * ${spec.width / spec.height}))`,
          containerType: 'size',
          fontFamily: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
      >
        <DeckGL
          viewState={viewState}
          controller={false}
          layers={layers}
          onAfterRender={onAfterRender}
          useDevicePixels={record ? 1 : true}
        >
          <MapGL
            ref={mapRef}
            mapStyle={theme.mapStyle}
            onLoad={() => setMapLoaded(true)}
            onError={() => setMapLoaded(true)}
            attributionControl={false}
          />
        </DeckGL>

        {/* Dim under the end card */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: theme.dimColor, opacity: dimAmount(t) }} />

        {stats && (
          <ClipOverlay t={t} currentTime={currentTime} active={active} captions={captions} date={stats.date} theme={theme} />
        )}
      </div>

      {!record && (
        <div className="fixed bottom-3 right-3 flex gap-2 text-xs text-white/70 font-mono">
          {(Object.keys(FORMATS) as ClipFormat[]).map(f => (
            <a key={f} href={`/clip?format=${f}${day ? `&day=${encodeURIComponent(day)}` : ''}`} className={`px-2 py-1 rounded ${f === format ? 'bg-white/20 text-white' : 'hover:bg-white/10'}`}>
              {f.replace('x', ':')}
            </a>
          ))}
          <button onClick={() => setPlaying(p => !p)} className="px-2 py-1 rounded hover:bg-white/10" aria-label={playing ? 'Pause clip' : 'Play clip'}>
            {playing ? 'pause' : 'play'}
          </button>
        </div>
      )}
    </div>
  );
}
