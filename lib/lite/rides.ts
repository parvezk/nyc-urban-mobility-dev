// Ride paths for the lite view, packed into flat typed arrays so a day of
// 200k rides fits in memory and draws without per-ride objects.
//
// Two sources:
//   rides/manifest.json + HH.bin.gz  every ride of the day ("cbr1", written by
//                                    scripts/etl/6-route-all-rides.mjs)
//   trips.json / /api/trips          the routed 6,000-ride sample

export const ORIGIN_LNG = -73.97;
export const ORIGIN_LAT = 40.73;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

export interface RideSet {
  count: number;
  // Point i of ride r is offsets[r] <= i < offsets[r + 1].
  offsets: Uint32Array;
  // Metres east / north of ORIGIN, seconds since local midnight.
  xm: Float32Array;
  ym: Float32Array;
  ts: Float32Array;
  electric: Uint8Array;
  source: 'all' | 'sample';
}

export const toX = (lng: number) => (lng - ORIGIN_LNG) * M_PER_DEG_LNG;
export const toY = (lat: number) => (lat - ORIGIN_LAT) * M_PER_DEG_LAT;

interface Builder {
  offsets: number[];
  xm: number[];
  ym: number[];
  ts: number[];
  electric: number[];
}

function finish(b: Builder, source: RideSet['source']): RideSet {
  return {
    count: b.offsets.length - 1,
    offsets: Uint32Array.from(b.offsets),
    xm: Float32Array.from(b.xm),
    ym: Float32Array.from(b.ym),
    ts: Float32Array.from(b.ts),
    electric: Uint8Array.from(b.electric),
    source,
  };
}

interface JsonTrip {
  vendor_type?: string;
  path: Array<[number, number, number]>;
}

export function packJsonTrips(trips: JsonTrip[], dayStartMs: number): RideSet {
  const b: Builder = { offsets: [0], xm: [], ym: [], ts: [], electric: [] };
  for (const trip of trips) {
    const p = trip.path;
    if (!p || p.length < 2) continue;
    for (const [lng, lat, ms] of p) {
      b.xm.push(toX(lng));
      b.ym.push(toY(lat));
      b.ts.push((ms - dayStartMs) / 1000);
    }
    b.offsets.push(b.xm.length);
    b.electric.push(trip.vendor_type === 'electric_bike' ? 1 : 0);
  }
  return finish(b, 'sample');
}

// cbr1, little-endian:
//   "CBR1", uint32 rideCount, then per ride:
//   uint8 flags, uint8 n, uint32 startSec, int32 lng0, int32 lat0 (1e-5 deg),
//   (n-1) x { int16 dLng, int16 dLat, uint16 dtSec }
export function decodeCbr1(buf: ArrayBuffer, into: Builder): void {
  const v = new DataView(buf);
  const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (magic !== 'CBR1') throw new Error(`Not a cbr1 file (${magic})`);
  const rides = v.getUint32(4, true);
  let o = 8;
  for (let r = 0; r < rides; r++) {
    const flags = v.getUint8(o);
    const n = v.getUint8(o + 1);
    let sec = v.getUint32(o + 2, true);
    let lng = v.getInt32(o + 6, true);
    let lat = v.getInt32(o + 10, true);
    o += 14;
    into.xm.push(toX(lng / 1e5));
    into.ym.push(toY(lat / 1e5));
    into.ts.push(sec);
    for (let i = 1; i < n; i++) {
      lng += v.getInt16(o, true);
      lat += v.getInt16(o + 2, true);
      sec += v.getUint16(o + 4, true);
      o += 6;
      into.xm.push(toX(lng / 1e5));
      into.ym.push(toY(lat / 1e5));
      into.ts.push(sec);
    }
    into.offsets.push(into.xm.length);
    into.electric.push(flags & 1);
  }
}

// Static hosts may or may not decode .gz for us; check the bytes.
async function gunzipIfNeeded(res: Response): Promise<ArrayBuffer> {
  const raw = await res.arrayBuffer();
  const head = new Uint8Array(raw, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return raw;
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

interface Manifest {
  format: string;
  dayStartEpochMs: number;
  totalRides: number;
  hours: Array<{ hour: number; rides: number; bytes: number }>;
}

export async function loadAllRides(date: string): Promise<RideSet | null> {
  const base = `/data/days/${date}/rides`;
  const res = await fetch(`${base}/manifest.json`);
  if (!res.ok) return null;
  const manifest = (await res.json()) as Manifest;
  if (manifest.format !== 'cbr1') return null;
  const buffers = await Promise.all(
    manifest.hours.map(async h => {
      const r = await fetch(`${base}/${String(h.hour).padStart(2, '0')}.bin.gz`);
      if (!r.ok) throw new Error(`rides hour ${h.hour}: ${r.status}`);
      return gunzipIfNeeded(r);
    }),
  );
  const b: Builder = { offsets: [0], xm: [], ym: [], ts: [], electric: [] };
  for (const buf of buffers) decodeCbr1(buf, b);
  return finish(b, 'all');
}

export async function loadSampleRides(url: string, dayStartMs: number): Promise<RideSet> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`trips: ${res.status}`);
  return packJsonTrips((await res.json()) as JsonTrip[], dayStartMs);
}
