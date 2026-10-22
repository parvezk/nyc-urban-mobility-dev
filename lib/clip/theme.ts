// All of the clip's look in one place: basemap, data color, text styling.
// The day/night lighting work can swap themes by clock time (and by the
// selected date's sunrise/sunset) without touching the clip's layout code.

export type RGB = [number, number, number];

export interface ClipTheme {
  mapStyle: string;
  background: string;      // shown before tiles load and around the stage
  tripColor: RGB;
  buildingColor: RGB;
  buildingOpacity: number;
  text: string;            // caption and clock color
  textMuted: string;       // kicker and fine print
  textShadow: string;
  accent: string;          // the end card's second line
  dimColor: string;        // overlay under the end card
}

export const NIGHT_THEME: ClipTheme = {
  // Labels off: the captions are the only words on screen.
  mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
  background: '#0b0c0f',
  tripColor: [255, 166, 72],
  buildingColor: [38, 42, 50],
  buildingOpacity: 0.55,
  text: '#ffffff',
  textMuted: 'rgba(255,255,255,0.62)',
  textShadow: '0 0.3cqmin 2.2cqmin rgba(0,0,0,0.75)',
  accent: 'rgb(255,166,72)',
  dimColor: '#000000',
};

// Single theme for now. `hour` is the story clock (0-24+, local time) so a
// lighting model can blend dawn, day, dusk and night here later.
export function clipThemeAt(_hour: number): ClipTheme {
  return NIGHT_THEME;
}
