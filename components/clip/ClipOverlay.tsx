import React from 'react';
import type { Caption } from '@/lib/clip/story';
import { captionOpacity, counterOpacity, formatClock, formatStoryDate } from '@/lib/clip/story';
import type { ClipTheme } from '@/lib/clip/theme';

// Every word drawn over the clip: kicker, clock, live counter, beat captions,
// end card and fine print. Sizes use container units (cqmin) so they read the
// same at 1080px exports and small previews.
interface ClipOverlayProps {
  t: number;              // clip seconds
  currentTime: number;    // story epoch ms
  active: number | null;  // bikes in motion now
  captions: Caption[];
  date: string;
  theme: ClipTheme;
}

export default function ClipOverlay({ t, currentTime, active, captions, date, theme }: ClipOverlayProps) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ color: theme.text, textShadow: theme.textShadow }}>
      <div className="absolute" style={{ top: '6cqmin', left: '6cqmin' }}>
        <div className="uppercase font-semibold" style={{ fontSize: '2.5cqmin', letterSpacing: '0.18em', color: theme.textMuted }}>
          One day of Citi Bike in New York
        </div>
        <div className="font-bold tabular-nums leading-none" style={{ fontSize: '10cqmin', marginTop: '1.2cqmin' }}>
          {formatClock(currentTime)}
        </div>
        {active !== null && (
          <div className="font-medium" style={{ fontSize: '3.6cqmin', marginTop: '1.4cqmin', opacity: counterOpacity(captions, t) }}>
            <span className="font-bold tabular-nums">{active.toLocaleString('en-US')}</span> bikes moving
          </div>
        )}
      </div>

      {captions.filter(c => c.kind === 'caption').map(c => (
        <div
          key={c.id}
          className="absolute left-0 right-0 text-center font-semibold"
          style={{ bottom: '17cqh', padding: '0 7cqmin', fontSize: '5.4cqmin', lineHeight: 1.15, opacity: captionOpacity(c, t) }}
        >
          {c.lines[0]}
        </div>
      ))}

      {captions.filter(c => c.kind === 'card').map(c => (
        <div
          key={c.id}
          className="absolute inset-0 flex flex-col items-center justify-center text-center"
          style={{ padding: '0 7cqmin', opacity: captionOpacity(c, t, 0.3) }}
        >
          <div className="font-bold tabular-nums" style={{ fontSize: '14cqmin', lineHeight: 1 }}>{c.lines[0]}</div>
          {c.lines[1] && (
            <div className="font-semibold" style={{ fontSize: '5.6cqmin', marginTop: '1.2cqmin' }}>{c.lines[1]}</div>
          )}
          {c.lines[2] && (
            <div className="font-semibold" style={{ fontSize: '5.6cqmin', marginTop: '3cqmin', color: theme.accent }}>
              {c.lines[2]}
            </div>
          )}
        </div>
      ))}

      <div className="absolute left-0 right-0 text-center" style={{ bottom: '4cqmin', fontSize: '2cqmin', color: theme.textMuted }}>
        {formatStoryDate(date)} · Citi Bike trip data · routes are estimated
      </div>
    </div>
  );
}
