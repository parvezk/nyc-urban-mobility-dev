// Decoder for the all-rides "cbr1" chunks written by ETL (one file per start hour).
//
// HH.bin(.gz), little-endian:
//   "CBR1" magic, uint32 rideCount, then per ride:
//   uint8 flags (bit0 electric, bit1 member), uint8 n (points),
//   uint32 startSec (since local midnight), int32 lng0, int32 lat0 (1e-5 deg),
//   then (n-1) x [int16 dLng, int16 dLat (1e-5 deg), uint16 dtSec].
//
// Rides are split into four groups (bike type x rider type) so the map can
// colour and filter each group without touching per-vertex data.

export interface RidesManifest {
  format: 'cbr1';
  date: string;
  dayStartEpochMs: number;
  totalRides: number;
  scope?: string;              // "manhattan" when the ETL already kept only Manhattan rides
  hours: { hour: number; rides: number; bytes: number }[];
}

export type GroupKey = 'ebike-member' | 'ebike-casual' | 'classic-member' | 'classic-casual';
export const GROUP_KEYS: GroupKey[] = ['ebike-member', 'ebike-casual', 'classic-member', 'classic-casual'];

// deck.gl binary path data: flat positions + per-vertex timestamps.
export interface RideGroup {
  length: number;              // rides
  startIndices: Uint32Array;   // vertex index where each ride starts (+ total at the end)
  positions: Float32Array;     // [lng, lat, ...]
  timestamps: Float32Array;    // seconds since local midnight, per vertex
}

export interface RideChunk {
  hour: number;
  rides: number;
  endSec: number;              // last timestamp in the chunk
  groups: Record<GroupKey, RideGroup>;
}

const groupOf = (flags: number): GroupKey =>
  (flags & 1 ? 'ebike' : 'classic') + (flags & 2 ? '-member' : '-casual') as GroupKey;

// Optional filter on a ride's first and last point (lng, lat).
export type RideFilter = (x0: number, y0: number, x1: number, y1: number) => boolean;

export function decodeChunk(buf: ArrayBuffer, hour: number, keep?: RideFilter): RideChunk {
  const v = new DataView(buf);
  const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (magic !== 'CBR1') throw new Error(`Bad ride chunk for hour ${hour}: magic ${magic}`);
  const count = v.getUint32(4, true);

  // Pass 1: decide which rides to keep; count rides and vertices per group.
  const rides: Record<string, number> = {};
  const verts: Record<string, number> = {};
  for (const k of GROUP_KEYS) { rides[k] = 0; verts[k] = 0; }
  const kept = new Uint8Array(count);
  let keptCount = 0;
  let o = 8;
  for (let i = 0; i < count; i++) {
    const g = groupOf(v.getUint8(o));
    const n = v.getUint8(o + 1);
    let ok = true;
    if (keep) {
      const x0 = v.getInt32(o + 6, true);
      const y0 = v.getInt32(o + 10, true);
      let x = x0, y = y0;
      for (let j = 0, p = o + 14; j < n - 1; j++, p += 6) { x += v.getInt16(p, true); y += v.getInt16(p + 2, true); }
      ok = keep(x0 / 1e5, y0 / 1e5, x / 1e5, y / 1e5);
    }
    if (ok) { kept[i] = 1; keptCount++; rides[g]++; verts[g] += n; }
    o += 14 + (n - 1) * 6;
  }

  const groups = {} as Record<GroupKey, RideGroup>;
  const cursor: Record<string, { r: number; p: number }> = {};
  for (const k of GROUP_KEYS) {
    groups[k] = {
      length: rides[k],
      startIndices: new Uint32Array(rides[k] + 1),
      positions: new Float32Array(verts[k] * 2),
      timestamps: new Float32Array(verts[k]),
    };
    groups[k].startIndices[rides[k]] = verts[k];
    cursor[k] = { r: 0, p: 0 };
  }

  // Pass 2: fill.
  let endSec = 0;
  o = 8;
  for (let i = 0; i < count; i++) {
    const k = groupOf(v.getUint8(o));
    const n = v.getUint8(o + 1);
    if (!kept[i]) { o += 14 + (n - 1) * 6; continue; }
    let t = v.getUint32(o + 2, true);
    let x = v.getInt32(o + 6, true);
    let y = v.getInt32(o + 10, true);
    o += 14;
    const G = groups[k];
    const c = cursor[k];
    G.startIndices[c.r++] = c.p;
    G.positions[c.p * 2] = x / 1e5; G.positions[c.p * 2 + 1] = y / 1e5; G.timestamps[c.p] = t; c.p++;
    for (let j = 1; j < n; j++) {
      x += v.getInt16(o, true); y += v.getInt16(o + 2, true); t += v.getUint16(o + 4, true);
      o += 6;
      G.positions[c.p * 2] = x / 1e5; G.positions[c.p * 2 + 1] = y / 1e5; G.timestamps[c.p] = t; c.p++;
    }
    if (t > endSec) endSec = t;
  }
  return { hour, rides: keptCount, endSec, groups };
}

async function gunzipIfNeeded(res: Response): Promise<ArrayBuffer> {
  const buf = await res.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  // The host may already have decoded Content-Encoding: gzip.
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export function ridesBase(date: string) {
  return `/data/days/${date}/rides`;
}

export async function loadManifest(date: string): Promise<RidesManifest | null> {
  try {
    const res = await fetch(`${ridesBase(date)}/manifest.json`);
    if (!res.ok) return null;
    const m = (await res.json()) as RidesManifest;
    return m.format === 'cbr1' ? m : null;
  } catch {
    return null;
  }
}

export async function loadChunk(date: string, hour: number, keep?: RideFilter): Promise<RideChunk> {
  const res = await fetch(`${ridesBase(date)}/${String(hour).padStart(2, '0')}.bin.gz`);
  if (!res.ok) throw new Error(`Ride chunk ${hour} failed: ${res.status}`);
  return decodeChunk(await gunzipIfNeeded(res), hour, keep);
}

// Hours ordered for progressive loading: the one on screen first, then forward.
export function loadOrder(firstHour: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 24; i++) out.push((firstHour + i) % 24);
  return out;
}
