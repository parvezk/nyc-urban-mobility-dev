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
import PlacesPanel from './PlacesPanel';
import { hourOf, hourRange, loadPlaces, type Place } from '@/lib/places';
import { DaysIndex, DaySources, loadDaysIndex, resolveDayFrom } from '@/lib/dayData';
import { matchesFilters, useViewStore } from '@/lib/store/viewStore';
import { MAP_STYLE, applySunLook, prepareMap, tripColorsAt } from '@/lib/lighting/mapLook';
import { daylightAt, nyMidnight } from '@/lib/lighting/sun';
import { GROUP_KEYS, loadChunk, loadManifest, loadOrder, type GroupKey, type RideChunk, type RidesManifest } from '@/lib/rides/cbr1';
import { MANHATTAN_FOCUS, MANHATTAN_MIN_ZOOM, MANHATTAN_VIEW_BOUNDS, rideTouchesManhattan } from '@/lib/geo/manhattan';

import 'maplibre-gl/dist/maplibre-gl.css';

// Manhattan laid left to right (bearing -61 turns the street grid level).
const INITIAL_VIEW_STATE = {
  longitude: -73.982,
  latitude: 40.758,
  zoom: 12.2,
  pitch: 45,
  bearing: -61
};

// Keep the camera on Manhattan: no panning off to the other boroughs.
const B = MANHATTAN_VIEW_BOUNDS;
const clampView = <T extends { longitude: number; latitude: number; zoom: number }>(v: T): T => ({
  ...v,
  longitude: Math.min(B.maxLng, Math.max(B.minLng, v.longitude)),
  latitude: Math.min(B.maxLat, Math.max(B.minLat, v.latitude)),
  zoom: Math.max(MANHATTAN_MIN_ZOOM, v.zoom),
});

// The red activity pulses are parked until they get a legend and keep pace
// with the timeline.
const SHOW_HOTSPOTS = false;

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
  // Every ride of the day, streamed in hourly chunks (null = not published; use the sample).
  const [ridesManifest, setRidesManifest] = useState<RidesManifest | null>(null);
  const [rideChunks, setRideChunks] = useState<RideChunk[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

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

    setRidesManifest(null);
    setRideChunks([]);
    setPlaces([]);
    setSelectedPlace(null);
    if (sources.date) loadPlaces(sources.date).then(p => { if (!cancelled) setPlaces(p); });

    const loadSample = () => fetch(sources.tripsUrl)
      .then(res => res.json())
      .then((loaded: TripPath[]) => {
        if (cancelled) return;
        let data = loaded;
        if (!Array.isArray(data) || data.length === 0) {
          console.warn('Trips file returned invalid data or empty set:', data);
          return;
        }
        // Manhattan only: rides that start or end on the island.
        data = data.filter(d => {
          const a = d.path[0];
          const b = d.path[d.path.length - 1];
          return rideTouchesManhattan(a[0], a[1], b[0], b[1]);
        });
        if (data.length === 0) return;

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

    // Prefer every ride when the pipeline has published them; otherwise the sample.
    const date = sources.date;
    (date ? loadManifest(date) : Promise.resolve(null)).then(async manifest => {
      if (cancelled) return;
      if (!manifest || !date) { loadSample(); return; }
      setRidesManifest(manifest);
      setMinTime(manifest.dayStartEpochMs);
      setMaxTime(manifest.dayStartEpochMs + 24.5 * 3_600_000);
      if (!didInitTime.current) setTime(manifest.dayStartEpochMs);
      // Open on 8 AM, so load from 7 AM forward, then wrap around.
      for (const hour of loadOrder(7)) {
        if (cancelled) return;
        if (!manifest.hours.some(h => h.hour === hour && h.rides > 0)) continue;
        try {
          // Files the ETL already scoped to Manhattan need no filtering here.
          const chunk = await loadChunk(date, hour, manifest.scope === 'manhattan' ? undefined : rideTouchesManhattan);
          if (!cancelled) setRideChunks(prev => [...prev, chunk]);
        } catch (err) {
          console.warn(err);
        }
      }
    });

    return () => { cancelled = true; };
  }, [sources]);

  // Rides that pass the bike / rider filters.
  const visibleTrips = useMemo(
    () => (bike === 'all' && rider === 'all' ? trips : trips.filter(t => matchesFilters(t, bike, rider))),
    [trips, bike, rider]
  );
  const hasRiderData = useMemo(
    () => ridesManifest !== null || trips.some(t => typeof t.member === 'boolean'),
    [trips, ridesManifest]
  );
  const groupVisible = useCallback((g: GroupKey) => {
    const [b, r] = g.split('-');
    if (bike === 'electric' && b !== 'ebike') return false;
    if (bike === 'classic' && b !== 'classic') return false;
    if (rider !== 'all' && r !== rider) return false;
    return true;
  }, [bike, rider]);
  const rideCounts = useMemo(() => {
    let shown = 0;
    for (const c of rideChunks) for (const g of GROUP_KEYS) if (groupVisible(g)) shown += c.groups[g].length;
    if (!ridesManifest) return { shown, total: 0 };
    if (ridesManifest.scope === 'manhattan') return { shown, total: ridesManifest.totalRides };
    // Filtered here: the total is what has loaded so far.
    return { shown, total: rideChunks.reduce((n, c) => n + c.rides, 0) };
  }, [rideChunks, groupVisible, ridesManifest]);

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

  const onSelectPlace = useCallback((place: Place) => {
    setSelectedCluster(null);
    setSelectedPlace(place);
    setViewState(vs => ({
      ...vs,
      longitude: place.lng,
      latitude: place.lat,
      zoom: 16,
      pitch: 55,
      bearing: 20,
      transitionDuration: 2200,
      transitionInterpolator: new FlyToInterpolator()
    } as any));
  }, []);

  const onResetView = useCallback(() => {
    setSelectedPlace(null);
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

  // Places: which local hour the clock is in, and whether it is the spot's peak.
  const localHour = dayStart !== null ? Math.floor((time - dayStart) / 3_600_000) : -1;
  const placeIsBusiest = !!selectedPlace && localHour === selectedPlace.busiestHour.hour;
  const placeNow = selectedPlace ? hourOf(selectedPlace, localHour) : null;
  const jumpToHour = (hour: number) => {
    if (dayStart === null) return;
    setTime(Math.max(minTime, Math.min(maxTime, dayStart + (hour + 0.25) * 3_600_000)));
  };
  const shownDateLabel = shownDate
    ? new Date(`${shownDate}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : '';

  // Glow where rides overlap after dark; plain blending on the light day map.
  const tripBlend = useMemo(() => (tripLook.additive
    ? { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false }
    : { depthWriteEnabled: false }), [tripLook.additive]);

  // Binary path data for each chunk and group. Built once per chunk so deck.gl
  // sees the same object every frame and never re-processes the vertices.
  const rideData = useMemo(() => {
    const out = new Map<string, unknown>();
    for (const chunk of rideChunks) {
      for (const g of GROUP_KEYS) {
        const G = chunk.groups[g];
        if (G.length === 0) continue;
        out.set(`${chunk.hour}-${g}`, {
          length: G.length,
          startIndices: G.startIndices,
          attributes: {
            getPath: { value: G.positions, size: 2 },
            getTimestamps: { value: G.timestamps, size: 1 },
          },
        });
      }
    }
    return out;
  }, [rideChunks]);

  // Every ride: one thin layer per (start hour x bike x rider) group. Only
  // chunks whose rides can be on the road right now are drawn.
  const TRAIL_SEC = 480;
  const nowSec = ridesManifest ? (time - ridesManifest.dayStartEpochMs) / 1000 : 0;
  const tripLayers: any[] = ridesManifest
    ? rideChunks.flatMap(chunk => {
        // Only chunks whose rides can be on the road right now get a layer;
        // the rest hold no GPU memory until the clock reaches them.
        const onRoad = nowSec >= chunk.hour * 3600 - 60 && nowSec <= chunk.endSec + TRAIL_SEC;
        if (!onRoad) return [];
        return GROUP_KEYS.filter(g => chunk.groups[g].length > 0 && groupVisible(g)).map(g =>
          new TripsLayer({
            id: `rides-${chunk.hour}-${g}`,
            data: rideData.get(`${chunk.hour}-${g}`) as any,
            _pathType: 'open',
            getColor: g.startsWith('ebike') ? tripLook.ebike : tripLook.classic,
            opacity: tripLook.additive ? 0.55 : 0.6,
            widthUnits: 'pixels',
            getWidth: 1,
            widthMinPixels: 1,
            parameters: tripBlend as any,
            fadeTrail: true,
            trailLength: TRAIL_SEC,
            currentTime: nowSec,
          })
        );
      })
    : [
        new TripsLayer({
          id: 'trips',
          data: visibleTrips,
          // getPath must return [lng, lat] pairs ONLY — no timestamps
          getPath: (d: any) => d.path.map((pt: any) => [pt[0], pt[1]]),
          // getTimestamps returns the 3rd element (the epoch ms) from each waypoint
          getTimestamps: (d: any) => d.path.map((pt: any) => pt[2]),
          getColor: (d: any) => (d.vendor_type === 'electric_bike' ? tripLook.ebike : tripLook.classic),
          opacity: 0.85,
          widthMinPixels: 2.5,
          parameters: tripBlend as any,
          updateTriggers: { getColor: [tripLook.ebike, tripLook.classic] },
          jointRounded: true,
          capRounded: true,
          fadeTrail: true,
          trailLength: 600000, // 10-minute trail in ms
          currentTime: time
        })
      ];

  const layers = [
    ...tripLayers,
    new ScatterplotLayer<Place>({
      id: 'place-ring',
      data: selectedPlace ? [selectedPlace] : [],
      getPosition: (d: Place) => [d.lng, d.lat],
      getRadius: (d: Place) => d.radiusM + (placeIsBusiest ? pingRadius * 0.15 : 0),
      radiusUnits: 'meters',
      stroked: true,
      filled: true,
      getFillColor: placeIsBusiest ? [245, 165, 36, 46] : [15, 23, 42, 18],
      getLineColor: placeIsBusiest ? [245, 165, 36, 230] : tripLook.additive ? [230, 236, 248, 200] : [15, 23, 42, 160],
      lineWidthMinPixels: placeIsBusiest ? 3 : 1.5,
      parameters: { depthWriteEnabled: false } as any,
      updateTriggers: { getRadius: [pingRadius, placeIsBusiest], getFillColor: placeIsBusiest, getLineColor: [placeIsBusiest, tripLook.additive] }
    }),
    SHOW_HOTSPOTS && new ScatterplotLayer<PulseDatum>({
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
        onViewStateChange={e => setViewState(clampView(e.viewState as any))}
        controller={true}
        layers={layers}
        pickingRadius={20}
      >
        <MapGL
          ref={mapRef}
          mapStyle={MAP_STYLE}
          onLoad={e => { prepareMap(e.target, MANHATTAN_FOCUS); setMapReady(true); }}
        >
          {SHOW_HOTSPOTS && selectedCluster && (
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
          {selectedPlace && placeNow && (
            <Popup
              longitude={selectedPlace.lng}
              latitude={selectedPlace.lat}
              anchor="bottom"
              offset={24}
              closeButton={true}
              closeOnClick={false}
              onClose={() => setSelectedPlace(null)}
              className="z-50"
            >
              <div className="text-slate-900 flex flex-col gap-1.5 p-1 min-w-[220px]">
                <h3 className="font-bold text-base leading-tight">{selectedPlace.name}</h3>
                {placeIsBusiest ? (
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                    Busiest hour here · {shownDateLabel}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">Within {selectedPlace.radiusM} m · {hourRange(Math.max(0, localHour))}</p>
                )}
                <p className="text-sm tabular-nums">
                  <span className="font-bold">{placeNow.electric.toLocaleString('en-US')}</span> e-bikes ·{' '}
                  <span className="font-bold">{placeNow.classic.toLocaleString('en-US')}</span> classic
                  {placeIsBusiest && <span className="text-slate-500"> ({hourRange(localHour)})</span>}
                </p>
                {!placeIsBusiest && (
                  <button
                    onClick={() => { jumpToHour(selectedPlace.busiestHour.hour); setIsPlaying(false); }}
                    className="mt-1 w-full py-1.5 bg-slate-900 text-white rounded text-xs hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                  >
                    Jump to busiest hour ({hourRange(selectedPlace.busiestHour.hour)})
                  </button>
                )}
                <button
                  onClick={onResetView}
                  className="w-full py-1.5 bg-black/5 text-slate-700 rounded text-xs hover:bg-black/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  Back to the city
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

      <PlacesPanel places={places} selectedId={selectedPlace?.id ?? null} onSelect={onSelectPlace} />

      <ViewControls
        index={daysIndex ?? null}
        currentDate={sources?.date ?? null}
        stats={dayStats}
        shown={ridesManifest ? rideCounts.shown : visibleTrips.length}
        total={ridesManifest ? rideCounts.total : trips.length}
        allRides={ridesManifest !== null}
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
