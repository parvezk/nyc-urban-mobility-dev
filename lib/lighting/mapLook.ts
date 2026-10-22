// Map look that follows the sun: basemap colours, 3D buildings and the
// light on them blend from night to golden hour to day, and after sunset
// buildings switch to lit-window facades.
//
// Works on any OpenMapTiles-schema style (OpenFreeMap positron/liberty) by
// matching layers on their source-layer, so it survives style updates.

import type { Map as MLMap, LayerSpecification } from 'maplibre-gl';
import { daylightAt, litShare, type Daylight } from './sun';

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export type RGB = [number, number, number];

interface Swatch {
  land: RGB; water: RGB; park: RGB; road: RGB; roadMajor: RGB;
  building: RGB; label: RGB; halo: RGB;
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sw = (o: Record<keyof Swatch, string>): Swatch =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hex(v)])) as unknown as Swatch;

// Muted editorial palette: soft grey roads, pale slate-blue water by day;
// navy (never black) at night.
const DAY = sw({ land: '#EEEDE9', water: '#BFD3E1', park: '#DDE6D6', road: '#FFFFFF', roadMajor: '#F7F3EA', building: '#E9E4DA', label: '#5F6368', halo: '#F6F5F2' });
const GOLD = sw({ land: '#F1E1CC', water: '#C9C7D1', park: '#E3DCC3', road: '#FBEBD8', roadMajor: '#FBE2C4', building: '#F4CFA4', label: '#6E5E52', halo: '#F8EAD9' });
const NIGHT = sw({ land: '#1B2336', water: '#0F1727', park: '#1D2A34', road: '#2A3550', roadMajor: '#36425F', building: '#283149', label: '#9AA6C2', halo: '#141B2B' });

export const TRIP_COLORS = {
  day: { ebike: hex('#3A55E0'), classic: hex('#E2541B') },
  night: { ebike: hex('#62D0FF'), classic: hex('#FFA15A') },
};

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

export function swatchAt(l: Daylight): Swatch {
  const out = {} as Swatch;
  for (const k of Object.keys(DAY) as (keyof Swatch)[]) {
    out[k] = mix(mix(NIGHT[k], DAY[k], l.day), GOLD[k], l.gold * 0.75);
  }
  return out;
}

export function tripColorsAt(l: Daylight) {
  return {
    ebike: mix(TRIP_COLORS.night.ebike, TRIP_COLORS.day.ebike, l.day),
    classic: mix(TRIP_COLORS.night.classic, TRIP_COLORS.day.classic, l.day),
    additive: l.day < 0.5,
  };
}

// ---------- 3D buildings + window patterns ----------

const BUILDINGS_ID = 'sun-3d-buildings';
const WINDOW_IMAGES = [
  { id: 'win-off', lit: 0.06 },
  { id: 'win-low', lit: 0.3 },
  { id: 'win-high', lit: 0.72 },
];

// A tiling facade texture: dark wall with a grid of windows, some lit.
function windowImage(litShareOfWindows: number, seed: number) {
  const size = 32;
  const data = new Uint8ClampedArray(size * size * 4);
  const wall: RGB = [30, 37, 56];
  const warm: RGB[] = [[255, 200, 120], [255, 222, 160], [214, 228, 255]];
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    data[i] = wall[0]; data[i + 1] = wall[1]; data[i + 2] = wall[2]; data[i + 3] = 255;
  }
  // 4 x 4 windows per tile, each 5 x 4 px.
  for (let wy = 0; wy < 4; wy++) for (let wx = 0; wx < 4; wx++) {
    const on = rnd() < litShareOfWindows;
    const c = on ? warm[Math.floor(rnd() * warm.length)] : mix(wall, [0, 0, 0], 0.35);
    for (let y = wy * 8 + 2; y < wy * 8 + 6; y++) for (let x = wx * 8 + 1; x < wx * 8 + 6; x++) {
      const i = (y * size + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
    }
  }
  return { width: size, height: size, data };
}

function vectorSourceId(map: MLMap): string | null {
  const sources = map.getStyle()?.sources ?? {};
  if (sources.openmaptiles) return 'openmaptiles';
  return Object.keys(sources).find(k => (sources[k] as { type?: string }).type === 'vector') ?? null;
}

// Pseudo-random 0..99 per building, stable across frames.
const BUILDING_HASH = ['%', ['abs', ['round', ['+',
  ['*', ['to-number', ['coalesce', ['id'], 0], 0], 7919],
  ['*', ['coalesce', ['get', 'render_height'], 0], 131],
]]], 100];

interface Registry { fills: string[]; water: string[]; waterLines: string[]; parks: string[]; roads: string[]; majorRoads: string[]; labels: string[]; background: string[] }

const registries = new WeakMap<MLMap, Registry>();

// Call once per style load: hides flat buildings, adds 3D ones, indexes layers.
export function prepareMap(map: MLMap): void {
  const style = map.getStyle();
  if (!style) return;
  const reg: Registry = { fills: [], water: [], waterLines: [], parks: [], roads: [], majorRoads: [], labels: [], background: [] };
  for (const layer of style.layers as (LayerSpecification & { 'source-layer'?: string })[]) {
    const sl = layer['source-layer'];
    if (layer.type === 'background') reg.background.push(layer.id);
    else if (layer.type === 'symbol') reg.labels.push(layer.id);
    else if (sl === 'building' && layer.type === 'fill') map.setLayoutProperty(layer.id, 'visibility', 'none');
    else if (sl === 'water' && layer.type === 'fill') reg.water.push(layer.id);
    else if (sl === 'waterway' && layer.type === 'line') reg.waterLines.push(layer.id);
    else if ((sl === 'park' || sl === 'landcover' || sl === 'landuse') && layer.type === 'fill') reg.parks.push(layer.id);
    else if (sl === 'transportation' && layer.type === 'line') {
      (/motorway|trunk|primary|major/.test(layer.id) ? reg.majorRoads : reg.roads).push(layer.id);
    }
  }
  registries.set(map, reg);

  WINDOW_IMAGES.forEach((w, i) => {
    if (!map.hasImage(w.id)) map.addImage(w.id, windowImage(w.lit, 11 + i * 97), { pixelRatio: 2 });
  });

  const source = vectorSourceId(map);
  if (source && !map.getLayer(BUILDINGS_ID)) {
    const firstLabel = reg.labels[0];
    map.addLayer({
      id: BUILDINGS_ID,
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: 12.5,
      paint: {
        'fill-extrusion-color': css(DAY.building),
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 1,
      },
    } as LayerSpecification, firstLabel);
  }
}

const lastKey = new WeakMap<MLMap, string>();

// Re-colour the map for a moment in time. Cheap to call every frame: it only
// touches the style when the lighting has changed enough to see.
export function applySunLook(map: MLMap, epochMs: number, localHour: number): Daylight {
  const l = daylightAt(epochMs);
  const reg = registries.get(map);
  if (!reg) return l;
  const lit = litShare(localHour);
  const nightMode = l.day < 0.28;
  const key = [Math.round(l.day * 50), Math.round(l.gold * 30), Math.round(lit * 10), nightMode].join('|');
  if (lastKey.get(map) === key) return l;
  lastKey.set(map, key);

  const s = swatchAt(l);
  const set = (ids: string[], prop: string, value: unknown) => {
    for (const id of ids) {
      try { map.setPaintProperty(id, prop, value); } catch { /* layer type mismatch */ }
    }
  };
  set(reg.background, 'background-color', css(s.land));
  set(reg.water, 'fill-color', css(s.water));
  set(reg.waterLines, 'line-color', css(s.water));
  set(reg.parks, 'fill-color', css(mix(s.land, s.park, 0.8)));
  set(reg.roads, 'line-color', css(s.road));
  set(reg.majorRoads, 'line-color', css(s.roadMajor));
  set(reg.labels, 'text-color', css(s.label));
  set(reg.labels, 'text-halo-color', css(s.halo));

  if (map.getLayer(BUILDINGS_ID)) {
    map.setPaintProperty(BUILDINGS_ID, 'fill-extrusion-color', css(s.building));
    // After dark, facades switch to lit windows. More buildings go dark late at night.
    const high = Math.round(lit * 55);
    const low = Math.round(lit * 100);
    map.setPaintProperty(BUILDINGS_ID, 'fill-extrusion-pattern', nightMode
      ? ['case', ['<', BUILDING_HASH, high], 'win-high', ['<', BUILDING_HASH, low], 'win-low', 'win-off']
      : undefined);
  }

  // Light the extrusions from where the sun actually is.
  const sunUp = l.altitude > -2;
  map.setLight({
    anchor: 'map',
    position: sunUp
      ? [1.15, l.azimuth, Math.min(88, Math.max(8, 90 - l.altitude))]
      : [1.15, 210, 45],
    color: sunUp ? css(mix([255, 255, 255], [255, 178, 112], l.gold)) : 'rgb(150,170,220)',
    intensity: sunUp ? 0.35 + 0.25 * l.day : 0.25,
  });
  return l;
}
