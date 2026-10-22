"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import MapGL, { Popup, type MapRef } from 'react-map-gl/maplibre';
import { FlyToInterpolator } from '@deck.gl/core';
import StoryTimeline, { DayStats } from './StoryTimeline';
import DayStatsPanel from './DayStatsPanel';
import ViewControls from './ViewControls';
import { DaysIndex, DaySources, loadDaysIndex, resolveDayFrom } from '@/lib/dayData';
import { matchesFilters, useViewStore } from '@/lib/store/viewStore';
import { MAP_STYLE, applySunLook, prepareMap, tripColorsAt } from '@/lib/lighting/mapLook';
import { daylightAt, nyMidnight } from '@/lib/lighting/sun';

import 'maplibre-gl/dist/maplibre-gl.css';

const INITIAL_VIEW_STATE = {
  longitude: -74.0,
  latitude: 40.72,
  zoom: 12,
  pitch: 60,
  bearing: 0
};

// A single animated trip path: [lng, lat, epochMs] waypoints.
interface TripPath {
  vendor_type: string;
  member?: boolean; // annual member vs casual rider (missing in older files)
  path: [number, number, number][];
}

// Shape of /data/hotspots.json — activity counts bucketed over time per cluster.
interface HotspotCluster {
  lng: number;
  lat: number;
  name: string;
  counts: [number, number][]; // [bucketEpochMs, activeCount]
}

interface HotspotsData {
  bucketMs: number;
  clusters: HotspotCluster[];
}

// Preprocessed cluster: bucketEpoch -> count lookup for O(1) per-frame reads.
interface ClusterLookup {
  lng: number;
  lat: number;
  name: string;
  counts: Map<number, number>;
}

interface HotspotLookup {
  bucketMs: number;
  firstBucket: number;
  maxCount: number;
  clusters: ClusterLookup[];
}

// A cluster rendered as a pulse at the current animation bucket.
interface PulseDatum {
  lng: number;
  lat: number;
  name: string;
  count: number;
  baseRadius: number;
}

export default function MapViewport() {
  const [time, setTime] = useState(0);
  const [minTime, setMinTime] = useState(0);
  const [maxTime, setMaxTime] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  // The hotspot cluster the user has clicked into (drives Popup + fly-to).
  const [selectedCluster, setSelectedCluster] = useState<PulseDatum | null>(null);

  const [trips, setTrips] = useState<TripPath[]>([]);
  const [hotspots, setHotspots] = useState<HotspotsData | null>(null);
  const [dayStats, setDayStats] = useState<DayStats | null>(null);

  // Ensure we only auto-jump to the mid-rush opening time once.
  const didInitTime = useRef(false);

  // Which day and which rides to show (Zustand, shared with ViewControls).
  const day = useViewStore(st => st.day);
  const bike = useViewStore(st => st.bike);
  const rider = useViewStore(st => st.rider);
  const setDay = useViewStore(st => st.setDay);

  // undefined = still loading; null = no per-day index (legacy single-day files)
  const [daysIndex, setDaysIndex] = useState<DaysIndex | null | undefined>(undefined);
  const [sources, setSources] = useState<DaySources | null>(null);

  // 1. Static data + the list of available days. `?day=` (a date, or a preset
  // such as "busiest") picks the opening day so a shared link opens on it.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('day');
    if (requested) setDay(requested);

    loadDaysIndex().then(setDaysIndex);
  }, [setDay]);

  // 1a. Resolve the requested day to file URLs, and mirror it in the URL.
  useEffect(() => {
    if (daysIndex === undefined) return;
    const next = resolveDayFrom(daysIndex, day);
    setSources(prev => (prev?.tripsUrl === next.tripsUrl ? prev : next));

    if (next.date) {
      const url = new URL(window.location.href);
      if (next.date === daysIndex?.presets?.default) url.searchParams.delete('day');
      else url.searchParams.set('day', next.date);
      window.history.replaceState(null, '', url);
    }
  }, [daysIndex, day]);

  // 1b. Load the selected day's trips, stats and hotspots. Switching days
  // clears the old day first so the 8 AM jump below waits for the new one.
  useEffect(() => {
    if (!sources) return;
    let cancelled = false;
    didInitTime.current = false;
    setTrips([]);
    setDayStats(null);
    setHotspots(null);
    setSelectedCluster(null);
    setMaxTime(1);

    fetch(sources.hotspotsUrl)
      .then(res => res.json())
      .then((data: HotspotsData) => { if (!cancelled) setHotspots(data); });

    fetch(sources.statsUrl)
      .then(res => res.json())
      .then((data: DayStats) => { if (!cancelled) setDayStats(data); });

    fetch(sources.tripsUrl)
      .then(res => res.json())
      .then((data: TripPath[]) => {
        if (cancelled) return;
        if (!Array.isArray(data) || data.length === 0) {
          console.warn('Trips file returned invalid data or empty set:', data);
          return;
        }

        // Find the absolute authentic min and max timestamps
        let absoluteMin = Infinity;
        let absoluteMax = -Infinity;
        for (const d of data) {
          if (d.path[0][2] < absoluteMin) absoluteMin = d.path[0][2];
          if (d.path[d.path.length - 1][2] > absoluteMax) absoluteMax = d.path[d.path.length - 1][2];
        }

        setMinTime(absoluteMin);
        setMaxTime(absoluteMax);
        // Initialize scrubber to start, but never clobber the mid-rush jump (1c).
        if (!didInitTime.current) setTime(absoluteMin);

        // Keep timestamps strictly untouched as absolute Epochs for geographic reality
        setTrips(data);
      });

    return () => { cancelled = true; };
  }, [sources]);

  // Rides that pass the bike / rider filters.
  const visibleTrips = useMemo(
    () => (bike === 'all' && rider === 'all' ? trips : trips.filter(t => matchesFilters(t, bike, rider))),
    [trips, bike, rider]
  );
  const hasRiderData = useMemo(() => trips.some(t => typeof t.member === 'boolean'), [trips]);

  // 1c. Open mid-rush: once both trips and day-stats have loaded, jump the clock
  // to 08:00 AM (America/New_York) of the story's date, clamped to the trip range.
  // The offset is derived per-date via Intl, so summer (EDT) and winter (EST)
  // datasets both open at true 8 AM local.
  useEffect(() => {
    if (didInitTime.current) return;
    if (!dayStats || maxTime === 1) return; // wait for both trips + day-stats

    // Resolve the NY UTC offset for this specific date (EDT -04:00 vs EST -05:00)
    // so the 8 AM jump stays correct if the ETL is ever re-pointed at a winter day.
    const offsetName = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', timeZoneName: 'longOffset'
    }).formatToParts(new Date(`${dayStats.date}T12:00:00Z`))
      .find(p => p.type === 'timeZoneName')?.value ?? 'GMT-05:00';
    const nyOffset = offsetName.replace('GMT', '') || '-05:00';
    const eightAm = new Date(`${dayStats.date}T08:00:00${nyOffset}`).getTime();
    const clamped = Math.max(minTime, Math.min(maxTime, eightAm));
    setTime(clamped);
    didInitTime.current = true;
  }, [dayStats, minTime, maxTime]);

  // 2. Playback / Animation Engine
  useEffect(() => {
    if (!isPlaying || maxTime === 1) return;

    let animationFrame: number;
    let lastUpdate = performance.now();
    
    // We want the simulation to progress significantly faster than real time.
    // At 1150x, 24h of epochs (86,400,000ms) elapses in ~75s of wall clock —
    // one full "watch New York wake up" day loop.
    const TIME_MULTIPLIER = 1150;

    const animate = (now: number) => {
      const delta = now - lastUpdate;
      lastUpdate = now;

      setTime(t => {
        let newTime = t + (delta * TIME_MULTIPLIER);
        if (newTime >= maxTime) newTime = minTime; // Loop back
        return newTime;
      });

      animationFrame = window.requestAnimationFrame(animate);
    };
    
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isPlaying, minTime, maxTime]);

  // 3. Kinetic Camera Fly-To function — flies to whichever cluster was clicked.
  const onFlyToCluster = useCallback((cluster: PulseDatum) => {
    setViewState(vs => ({
      ...vs,
      longitude: cluster.lng,
      latitude: cluster.lat,
      zoom: 15.5,
      pitch: 75,
      bearing: 15,
      transitionDuration: 2000,
      transitionInterpolator: new FlyToInterpolator()
    } as any));
    setSelectedCluster(cluster);
  }, []);

  const onResetView = useCallback(() => {
    setViewState({
      ...INITIAL_VIEW_STATE,
      transitionDuration: 2000,
      transitionInterpolator: new FlyToInterpolator()
    } as any);
    setSelectedCluster(null);
  }, []);

  // 4. Compute Hotspot Radar Ping Scale (Pulsing Effect natively via DeckGL math)
  // Radius expands out rapidly, resets, simulating a radar
  const pingRadius = useMemo(() => {
    const cycle = (time % 1000000) / 100000;
    return (cycle % 1) * 600; // max radius 600 meters
  }, [time]);

  // 4a. Build the per-cluster bucketEpoch -> count lookup ONCE (no per-frame scans).
  // firstBucket is the global earliest bucket; all buckets are assumed to sit on a
  // single shared grid aligned to it (true for the mock — see final report).
  const hotspotLookup = useMemo<HotspotLookup | null>(() => {
    if (!hotspots) return null;
    let firstBucket = Infinity;
    let maxCount = 0;
    const clusters: ClusterLookup[] = hotspots.clusters.map(c => {
      const counts = new Map<number, number>();
      for (const [epoch, count] of c.counts) {
        counts.set(epoch, count);
        if (epoch < firstBucket) firstBucket = epoch;
        if (count > maxCount) maxCount = count;
      }
      return { lng: c.lng, lat: c.lat, name: c.name, counts };
    });
    return { bucketMs: hotspots.bucketMs, firstBucket, maxCount, clusters };
  }, [hotspots]);

  // 4b. Derive the bucket epoch for the current animation time.
  const currentBucketEpoch = useMemo(() => {
    if (!hotspotLookup || !isFinite(hotspotLookup.firstBucket)) return null;
    const { bucketMs, firstBucket } = hotspotLookup;
    const bucketIndex = Math.floor((time - firstBucket) / bucketMs);
    return firstBucket + bucketIndex * bucketMs;
  }, [hotspotLookup, time]);

  // 4c. Top 8 clusters by activity at the current bucket, sized by count.
  const activePulses = useMemo<PulseDatum[]>(() => {
    if (!hotspotLookup || currentBucketEpoch === null || hotspotLookup.maxCount === 0) return [];
    const { maxCount, clusters } = hotspotLookup;
    return clusters
      .map(c => {
        const count = c.counts.get(currentBucketEpoch) ?? 0;
        return {
          lng: c.lng,
          lat: c.lat,
          name: c.name,
          count,
          baseRadius: 120 + (count / maxCount) * 500 // 120m base + up to ~500m by count
        };
      })
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [hotspotLookup, currentBucketEpoch]);

  // Live count for the selected cluster at the current bucket (drives the Popup).
  const selectedCount = useMemo(() => {
    if (!selectedCluster || !hotspotLookup || currentBucketEpoch === null) return 0;
    const cluster = hotspotLookup.clusters.find(
      c => c.lng === selectedCluster.lng && c.lat === selectedCluster.lat
    );
    return cluster?.counts.get(currentBucketEpoch) ?? 0;
  }, [selectedCluster, hotspotLookup, currentBucketEpoch]);

  // 5. Sun-driven look: the basemap, 3D buildings and trip colours follow the
  // real sun for the shown date. Lit windows switch on after dark.
  const mapRef = useRef<MapRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const shownDate = sources?.date ?? dayStats?.date ?? null;
  const dayStart = useMemo(() => (shownDate ? nyMidnight(shownDate) : null), [shownDate]);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!mapReady || !map || dayStart === null || time === 0) return;
    applySunLook(map, time, (time - dayStart) / 3_600_000);
  }, [mapReady, time, dayStart]);
  // Quantised so trip colours only re-upload when the light visibly changes.
  const lightStep = Math.round(time / 300_000);
  const tripLook = useMemo(() => tripColorsAt(daylightAt(lightStep * 300_000)), [lightStep]);

  const layers = [
    new TripsLayer({
      id: 'trips',
      data: visibleTrips,
      // getPath must return [lng, lat] pairs ONLY — no timestamps
      getPath: (d: any) => d.path.map((pt: any) => [pt[0], pt[1]]),
      // getTimestamps returns the 3rd element (the epoch ms) from each waypoint
      getTimestamps: (d: any) => d.path.map((pt: any) => pt[2]),
      // electric_bike -> teal; classic_bike (and any other value) -> orange
      getColor: (d: any) => (d.vendor_type === 'electric_bike' ? tripLook.ebike : tripLook.classic),
      opacity: 0.85,
      widthMinPixels: 2.5,
      // Glow where rides overlap after dark; plain blending on the light day map.
      parameters: tripLook.additive
        ? { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false }
        : { depthWriteEnabled: false },
      updateTriggers: { getColor: [tripLook.ebike, tripLook.classic] },
      jointRounded: true,
      capRounded: true,
      fadeTrail: true,
      trailLength: 600000, // 10-minute trail in ms
      currentTime: time
    }),
    new ScatterplotLayer<PulseDatum>({
      id: 'hotspot-pulses',
      data: activePulses,
      getPosition: (d: PulseDatum) => [d.lng, d.lat],
      // Radius ∝ count (baseRadius), blooming/fading with the radar ping cycle.
      getRadius: (d: PulseDatum) => d.baseRadius + pingRadius * 0.5,
      radiusUnits: 'meters',
      getFillColor: [255, 60, 60, 70],
      getLineColor: [255, 90, 90, 200],
      lineWidthMinPixels: 1.5,
      stroked: true,
      filled: true,
      pickable: true,
      onClick: info => {
        if (info.object) onFlyToCluster(info.object);
      },
      // Radius depends on the animation clock, so re-evaluate it every frame.
      updateTriggers: {
        getRadius: pingRadius
      }
    })
  ];

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <DeckGL
        viewState={viewState}
        onViewStateChange={e => setViewState(e.viewState as any)}
        controller={true}
        layers={layers}
        pickingRadius={20}
      >
        <MapGL
          ref={mapRef}
          mapStyle={MAP_STYLE}
          onLoad={e => { prepareMap(e.target); setMapReady(true); }}
        >
          {selectedCluster && (
            <Popup
              longitude={selectedCluster.lng}
              latitude={selectedCluster.lat}
              anchor="bottom"
              closeButton={true}
              closeOnClick={false}
              onClose={() => setSelectedCluster(null)}
              className="z-50"
            >
              <div className="text-slate-900 flex flex-col gap-1 p-1 min-w-[200px]">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse"></span>
                  {selectedCluster.name}
                </h3>
                <p className="text-xs text-slate-600 mb-2">{selectedCount} bikes in motion</p>
                <button
                  onClick={onResetView}
                  className="w-full py-1.5 bg-slate-900 text-white rounded text-xs hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                >
                  Reset View
                </button>
              </div>
            </Popup>
          )}
        </MapGL>
      </DeckGL>

      {dayStats && (
        <DayStatsPanel
          stats={dayStats}
          currentTime={time}
          onJump={(epochMs) => {
            setTime(Math.max(minTime, Math.min(maxTime, epochMs)));
            setIsPlaying(false);
          }}
        />
      )}

      <ViewControls
        index={daysIndex ?? null}
        currentDate={sources?.date ?? null}
        stats={dayStats}
        shown={visibleTrips.length}
        total={trips.length}
        hasRiderData={hasRiderData}
      />

      <StoryTimeline
        minTime={minTime}
        maxTime={maxTime}
        currentTime={time}
        onTimeChange={(val) => {
          setTime(val);
          setIsPlaying(false); // Pause if user scrubs manually
        }}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        dayStats={dayStats}
      />
    </div>
  );
}
