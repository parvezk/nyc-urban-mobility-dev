// Sun position and day/night factors for New York, from date + clock time.
// Formulas follow suncalc (Vladimir Agafonkin, BSD-2), trimmed to what the map needs.

export const NYC = { lat: 40.725, lng: -73.99 };

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

function toDays(ms: number): number {
  return ms / DAY_MS - 0.5 + J1970 - J2000;
}

function sunCoords(d: number) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return {
    dec: Math.asin(Math.sin(OBLIQUITY) * Math.sin(L)),
    ra: Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L)),
  };
}

export interface SunPosition {
  altitude: number; // degrees above the horizon (negative = below)
  azimuth: number;  // degrees clockwise from north
}

export function sunPosition(epochMs: number, lat = NYC.lat, lng = NYC.lng): SunPosition {
  const d = toDays(epochMs);
  const { dec, ra } = sunCoords(d);
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lng - ra;
  const phi = RAD * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // suncalc azimuth is measured from south; shift to compass bearing from north.
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude: alt / RAD, azimuth: ((az / RAD + 180) % 360 + 360) % 360 };
}

// Epoch ms of local midnight in New York for an ISO date (handles EDT/EST).
export function nyMidnight(date: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find(p => p.type === 'timeZoneName')?.value ?? 'GMT-05:00';
  const offset = name.replace('GMT', '') || '-05:00';
  return new Date(`${date}T00:00:00${offset}`).getTime();
}

export interface SunTimes {
  midnight: number;
  dawn: number | null;    // civil dawn, hours after local midnight
  sunrise: number | null;
  sunset: number | null;
  dusk: number | null;    // civil dusk
}

function crossings(midnight: number, threshold: number): [number | null, number | null] {
  let rise: number | null = null;
  let set: number | null = null;
  let prev = sunPosition(midnight).altitude;
  for (let m = 1; m <= 1440; m++) {
    const a = sunPosition(midnight + m * 60_000).altitude;
    if (prev < threshold && a >= threshold && rise === null) rise = m / 60;
    if (prev >= threshold && a < threshold) set = m / 60;
    prev = a;
  }
  return [rise, set];
}

const cache = new Map<string, SunTimes>();

export function sunTimes(date: string): SunTimes {
  const hit = cache.get(date);
  if (hit) return hit;
  const midnight = nyMidnight(date);
  const [sunrise, sunset] = crossings(midnight, -0.833);
  const [dawn, dusk] = crossings(midnight, -6);
  const t = { midnight, dawn, sunrise, sunset, dusk };
  cache.set(date, t);
  return t;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface Daylight {
  altitude: number;
  azimuth: number;
  day: number;   // 0 = full night, 1 = full day
  gold: number;  // peaks when the sun is near the horizon
  night: number; // 1 once it is properly dark
}

export function daylightAt(epochMs: number): Daylight {
  const { altitude, azimuth } = sunPosition(epochMs);
  return {
    altitude,
    azimuth,
    day: smooth(-7, 7, altitude),
    gold: smooth(-5, 1, altitude) * (1 - smooth(5, 16, altitude)),
    night: 1 - smooth(-9, -1, altitude),
  };
}

// Share of windows lit at a local hour: homes light up in the evening,
// offices empty out late at night.
export function litShare(localHour: number): number {
  const h = ((localHour % 24) + 24) % 24;
  const T: [number, number][] = [[0, .42], [2, .26], [4, .16], [6, .28], [8, .45], [12, .5], [17, .62], [19, .82], [21, .8], [23, .6], [24, .42]];
  for (let i = 0; i < T.length - 1; i++) {
    const [h0, v0] = T[i];
    const [h1, v1] = T[i + 1];
    if (h >= h0 && h <= h1) return v0 + (v1 - v0) * (h - h0) / (h1 - h0);
  }
  return 0.4;
}
