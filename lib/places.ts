// Popular places and their hourly Citi Bike activity (ETL: landmarks.json).

export interface PlaceHour { hour: number; electric: number; classic: number }

export interface Place {
  id: string;
  name: string;
  lng: number;
  lat: number;
  radiusM: number;
  hourly: PlaceHour[];
  busiestHour: { hour: number; electric: number; classic: number; total: number };
}

export async function loadPlaces(date: string): Promise<Place[]> {
  try {
    const res = await fetch(`/data/days/${date}/landmarks.json`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as Place[]) : [];
  } catch {
    return [];
  }
}

// "5–6 PM", "11 PM–12 AM"
export function hourRange(hour: number): string {
  const label = (h: number) => {
    const hh = ((h % 24) + 24) % 24;
    return { n: hh % 12 === 0 ? 12 : hh % 12, ap: hh < 12 ? 'AM' : 'PM' };
  };
  const a = label(hour);
  const b = label(hour + 1);
  return a.ap === b.ap ? `${a.n}–${b.n} ${b.ap}` : `${a.n} ${a.ap}–${b.n} ${b.ap}`;
}

export function hourOf(place: Place, hour: number): PlaceHour {
  return place.hourly.find(h => h.hour === hour) ?? { hour, electric: 0, classic: 0 };
}
