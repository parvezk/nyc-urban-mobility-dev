"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { TripsLayer } from '@deck.gl/geo-layers';
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import Map, { Popup } from 'react-map-gl/maplibre';
import { FlyToInterpolator } from '@deck.gl/core';
import StoryTimeline from './StoryTimeline';

import 'maplibre-gl/dist/maplibre-gl.css';

const INITIAL_VIEW_STATE = {
  longitude: -74.0,
  latitude: 40.72,
  zoom: 12,
  pitch: 60,
  bearing: 0
};

// Target "Hotspot" coordinate to simulate an evening rush bottleneck
const HOTSPOT_COORDS = { longitude: -74.004, latitude: 40.71 };

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export default function MapViewport() {
  const [time, setTime] = useState(0);
  const [minTime, setMinTime] = useState(0);
  const [maxTime, setMaxTime] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [showPopup, setShowPopup] = useState(false);

  const [buildings, setBuildings] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);

  // 1. Data Fetching
  useEffect(() => {
    fetch('/data/buildings.json')
      .then(res => res.json())
      .then(data => setBuildings(data));

    fetch('/api/trips')
      .then(res => res.json())
      .then((data: any[]) => {
        if (!data || data.length === 0) return;
        
        // Find the absolute authentic min and max timestamps
        const absoluteMin = Math.min(...data.map(d => d.path[0][2]));
        const absoluteMax = Math.max(...data.map(d => d.path[d.path.length-1][2]));
        
        setMinTime(absoluteMin);
        setMaxTime(absoluteMax);
        setTime(absoluteMin); // Initialize scrubber to start

        // Keep timestamps strictly untouched as absolute Epochs for geographic reality
        setTrips(data);
      });
  }, []);

  // 2. Playback / Animation Engine
  useEffect(() => {
    if (!isPlaying || maxTime === 1) return;

    let animationFrame: number;
    let lastUpdate = performance.now();
    
    // We want the simulation to progress significantly faster than real time.
    // 60 frames/sec * 10,000 multiplier = 600,000ms (10 minutes) passing per second
    const TIME_MULTIPLIER = 10000; 

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

  // 3. Kinetic Camera Fly-To function
  const onFlyToHotspot = useCallback(() => {
    setViewState({
      ...viewState,
      longitude: HOTSPOT_COORDS.longitude,
      latitude: HOTSPOT_COORDS.latitude,
      zoom: 15.5,
      pitch: 75,
      bearing: 15,
      transitionDuration: 2000,
      transitionInterpolator: new FlyToInterpolator()
    } as any);
    setShowPopup(true);
  }, [viewState]);

  const onResetView = useCallback(() => {
    setViewState({
      ...INITIAL_VIEW_STATE,
      transitionDuration: 2000,
      transitionInterpolator: new FlyToInterpolator()
    } as any);
    setShowPopup(false);
  }, []);

  // 4. Compute Hotspot Radar Ping Scale (Pulsing Effect natively via DeckGL math)
  // Radius expands out rapidly, resets, simulating a radar
  const pingRadius = useMemo(() => {
    const cycle = (time % 1000000) / 100000; 
    return (cycle % 1) * 600; // max radius 600 meters
  }, [time]);

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
      getColor: (d: any) => (d.vendor_type === 'yellow' ? [253, 128, 93] : [23, 184, 190]),
      opacity: 0.8,
      widthMinPixels: 3,
      jointRounded: true,
      capRounded: true,
      fadeTrail: true,
      trailLength: 600000, // 10-minute trail in ms
      currentTime: time
    }),
    new ScatterplotLayer({
      id: 'hotspot-radar',
      data: [HOTSPOT_COORDS],
      getPosition: d => [d.longitude, d.latitude],
      getFillColor: [255, 60, 60, 100],
      getLineColor: [255, 100, 100, 200],
      lineWidthMinPixels: 2,
      getRadius: pingRadius,
      stroked: true,
      pickable: true,
      onClick: onFlyToHotspot,
      // Subtle pulse alpha effect
      updateTriggers: {
        getRadius: pingRadius
      }
    })
  ];

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <DeckGL
        viewState={viewState}
        onViewStateChange={e => setViewState(e.viewState)}
        controller={true}
        layers={layers}
        pickingRadius={20}
      >
        <Map mapStyle={MAP_STYLE}>
          {showPopup && (
            <Popup
              longitude={HOTSPOT_COORDS.longitude}
              latitude={HOTSPOT_COORDS.latitude}
              anchor="bottom"
              closeButton={true}
              closeOnClick={false}
              onClose={() => setShowPopup(false)}
              className="z-50"
            >
              <div className="text-slate-900 flex flex-col gap-1 p-1 min-w-[200px]">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse"></span>
                  Financial District
                </h3>
                <p className="text-xs text-slate-600 mb-2">High Outbound Taxi Demand</p>
                <button
                  onClick={onResetView}
                  className="w-full py-1.5 bg-slate-900 text-white rounded text-xs hover:bg-slate-800 transition-colors"
                >
                  Reset View
                </button>
              </div>
            </Popup>
          )}
        </Map>
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
      />
    </div>
  );
}
