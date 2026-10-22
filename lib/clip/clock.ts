import { create } from 'zustand';
import { CLIP_FRAMES } from './story';

// The clip's single source of time: a frame number. Preview playback advances
// it from the wall clock; the recorder sets it directly, one frame at a time,
// so every export is identical.
interface ClipClock {
  frame: number;
  setFrame: (frame: number) => void;
}

export const useClipClock = create<ClipClock>(set => ({
  frame: 0,
  setFrame: frame => set({ frame: ((Math.floor(frame) % CLIP_FRAMES) + CLIP_FRAMES) % CLIP_FRAMES }),
}));
