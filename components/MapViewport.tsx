"use client";

import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { TripsLayer } from '@deck.gl/geo-layers';
import { PolygonLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';

const INITIAL_VIEW_STATE = {
  longitude: -74.0,
  latitude: 40.72,
  zoom: 12,
  pitch: 60,
  bearing: 0
};

// Style matching the new Carto Dark Matter implementation
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export default function MapViewport() {
  const [time, setTime] = useState(0);
  const [animation] = useState({});
  const [buildings, setBuildings] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);

  // Fetch local static data on mount (emulating the legacy app.js)
  useEffect(() => {
    fetch('/data/buildings.json')
      .then(res => res.json())
      .then(data => setBuildings(data));

    fetch('/data/trips.json')
      .then(res => res.json())
      .then(data => setTrips(data));
  }, []);

  // Animation Loop driving the trips layer (React 18 compatible via requestAnimationFrame inside useEffect, 
  // though Zustand is planned for rigorous state management later)
  useEffect(() => {
    let animationFrame: number;
    const animate = () => {
      setTime(t => (t + 1) % 1800);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animate();
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

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
      getPath: (d: any) => d.segments,
      getTimestamps: (d: any) => d.segments.map((s: any) => s[2]),
      getColor: (d: any) => (d.vendor === 0 ? [253, 128, 93] : [23, 184, 190]),
      opacity: 0.3,
      widthMinPixels: 2,
      rounded: true,
      fadeTrail: true,
      trailLength: 180,
      currentTime: time
    })
  ];

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
    >
      <Map mapStyle={MAP_STYLE} />
    </DeckGL>
  );
}
