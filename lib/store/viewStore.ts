import { create } from 'zustand';

// Which rides are drawn. Changes rarely (on click), so plain Zustand state.
export type BikeFilter = 'all' | 'electric' | 'classic';
export type RiderFilter = 'all' | 'member' | 'casual';

interface ViewState {
  // A date ("2026-09-23") or a preset name ("default", "busiest").
  day: string;
  bike: BikeFilter;
  rider: RiderFilter;
  setDay: (day: string) => void;
  setBike: (bike: BikeFilter) => void;
  setRider: (rider: RiderFilter) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  day: 'default',
  bike: 'all',
  rider: 'all',
  setDay: (day) => set({ day }),
  setBike: (bike) => set({ bike }),
  setRider: (rider) => set({ rider }),
}));

// A trip as served by /data/days/<date>/trips.json. `member` is missing in
// older files, which then only support the bike filter.
export interface FilterableTrip {
  vendor_type: string;
  member?: boolean;
}

export function matchesFilters(t: FilterableTrip, bike: BikeFilter, rider: RiderFilter): boolean {
  if (bike === 'electric' && t.vendor_type !== 'electric_bike') return false;
  if (bike === 'classic' && t.vendor_type === 'electric_bike') return false;
  if (rider === 'member' && t.member !== true) return false;
  if (rider === 'casual' && t.member !== false) return false;
  return true;
}
