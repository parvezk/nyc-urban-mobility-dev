"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { TripsLayer } from '@deck.gl/geo-layers';
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import MapGL, { Popup } from 'react-map-gl/maplibre';
import { FlyToInterpolator } from '@deck.gl/core';
import StoryTimeline, { DayStats } from './StoryTimeline';

import 'maplibre-gl/dist/maplibre-gl.css';

const INITIAL_VIEW_STATE = {
  longitude: -74.0,
  latitude: 40.72,
  zoom: 12,
  pitch: 60,
  bearing: 0
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// A single animated trip path: [lng, lat, epochMs] waypoints.
interface TripPath {
  vendor_type: string;
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

  const [buildings, setBuildings] = useState<any[]>([]);
  const [trips, setTrips] = useState<TripPath[]>([]);
  const [hotspots, setHotspots] = useState<HotspotsData | null>(null);
  const [dayStats, setDayStats] = useState<DayStats | null>(null);

  // Ensure we only auto-jump to the mid-rush opening time once.
  const didInitTime = useRef(false);

  // 1. Data Fetching
  useEffect(() => {
    fetch('/data/buildings.json')
      .then(res => res.json())
      .then(data => setBuildings(data));

    fetch('/data/hotspots.json')
      .then(res => res.json())
      .then((data: HotspotsData) => setHotspots(data));

    fetch('/data/day-stats.json')
      .then(res => res.json())
      .then((data: DayStats) => setDayStats(data));

    fetch('/api/trips')
      .then(res => res.json())
      .then((data: TripPath[]) => {
        if (!Array.isArray(data) || data.length === 0) {
          console.warn('Trips API returned invalid data or empty set:', data);
          return;
        }

        // Find the absolute authentic min and max timestamps
        const absoluteMin = Math.min(...data.map(d => d.path[0][2]));
        const absoluteMax = Math.max(...data.map(d => d.path[d.path.length-1][2]));

        setMinTime(absoluteMin);
        setMaxTime(absoluteMax);
        // Initialize scrubber to start — but never clobber the mid-rush jump (1b).
        // In dev, StrictMode double-runs this effect; the second response can land
        // AFTER the 8 AM jump and would otherwise reset the clock to midnight.
        if (!didInitTime.current) setTime(absoluteMin);

        // Keep timestamps strictly untouched as absolute Epochs for geographic reality
        setTrips(data);
      });
  }, []);

  // 1b. Open mid-rush: once both trips and day-stats have loaded, jump the clock
  // to 08:00 AM (America/New_York) of the story's date, clamped to the trip range.
  // DST caveat: the -04:00 offset is EDT (summer), which is correct for the real
  // June-2026 dataset. For the Dec mock, 8 AM EDT lands before minTime and simply
  // clamps to minTime — the intended behavior.
  useEffect(() => {
    if (didInitTime.current) return;
    if (!dayStats || maxTime === 1) return; // wait for both trips + day-stats

    const eightAm = new Date(`${dayStats.date}T08:00:00-04:00`).getTime();
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

  const layers = [
    new PolygonLayer({
      id: 'buildings',
      data: buildings,
      extruded: true,
      wireframe: false,
      opacity: 0.5,
      getPolygon: (f: any) => f.polygon,
      getElevation: (f: any) => f.height,
      getFillColor: [74, 80, 87]
    }),
    new TripsLayer({
      id: 'trips',
      data: trips,
      // getPath must return [lng, lat] pairs ONLY — no timestamps
      getPath: (d: any) => d.path.map((pt: any) => [pt[0], pt[1]]),
      // getTimestamps returns the 3rd element (the epoch ms) from each waypoint
      getTimestamps: (d: any) => d.path.map((pt: any) => pt[2]),
      // electric_bike -> teal; classic_bike (and any other value) -> orange
      getColor: (d: any) => (d.vendor_type === 'electric_bike' ? [23, 184, 190] : [253, 128, 93]),
      opacity: 0.8,
      widthMinPixels: 3,
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
        <MapGL mapStyle={MAP_STYLE}>
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
                  className="w-full py-1.5 bg-slate-900 text-white rounded text-xs hover:bg-slate-800 transition-colors"
                >
                  Reset View
                </button>
              </div>
            </Popup>
          )}
        </MapGL>
      </DeckGL>

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
