// Canvas 2D renderer for the lite view. No map library: the day's own routes,
// drawn faintly, are the map, and the moving bikes are drawn on top.
//
// The story is Manhattan only, framed so the island runs the length of the
// frame. Trails accumulate on an offscreen canvas: each frame fades it a
// little and adds what every bike rode since the last frame.

import { toX, toY, type RideSet } from './rides';

export interface StageSize {
  width: number;   // CSS px
  height: number;  // CSS px
  dpr: number;
}

export interface RendererOptions {
  streak?: [number, number, number];
}

const BG = '#0b0c0f';
// Midtown, ~13.7 km along the long side of the frame.
const CENTER_LNG = -73.989;
const CENTER_LAT = 40.748;
const SPAN_M = 13714;
const ANCHOR_Y = 0.54;

export class LiteRenderer {
  readonly size: StageSize;
  private rides: RideSet;
  private rx: Float32Array;  // screen CSS px
  private ry: Float32Array;
  private t0: Float32Array;
  private t1: Float32Array;
  private inFrame: Uint8Array;
  private ghost: HTMLCanvasElement;
  private trailCanvas: HTMLCanvasElement;
  private trail: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D;
  private heads: number[] = [];
  private streakCss: string;
  private streakOp: GlobalCompositeOperation;
  private headCss: string;
  private streakWidth: number;
  private headRadius: number;

  constructor(canvas: HTMLCanvasElement, rides: RideSet, size: StageSize, opts: RendererOptions = {}) {
    this.size = size;
    this.rides = rides;
    const { width: W, height: H, dpr } = size;
    const landscape = W > H * 1.15;
    // Manhattan's grid runs ~29° east of north: stand it up (or lay it flat
    // for landscape frames).
    const bearing = ((landscape ? -61 : 29) * Math.PI) / 180;
    const cb = Math.cos(bearing);
    const sb = Math.sin(bearing);
    // CSS px per metre. A square frame zooms in a little so the island fills it.
    const square = Math.abs(W - H) < 0.15 * Math.max(W, H);
    const k = (Math.max(W, H) / SPAN_M) * (square ? 1.3 : 1);
    const x0 = toX(CENTER_LNG), y0 = toY(CENTER_LAT);
    const cx = x0 * cb - y0 * sb, cy = x0 * sb + y0 * cb;

    // Project once into screen space; the camera never moves (the drift is a
    // CSS transform on the canvas).
    const n = rides.xm.length;
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = rides.xm[i], y = rides.ym[i];
      this.rx[i] = W / 2 + (x * cb - y * sb - cx) * k;
      this.ry[i] = H * ANCHOR_Y - (x * sb + y * cb - cy) * k;
    }
    this.t0 = new Float32Array(rides.count);
    this.t1 = new Float32Array(rides.count);
    for (let r = 0; r < rides.count; r++) {
      this.t0[r] = rides.ts[rides.offsets[r]];
      this.t1[r] = rides.ts[rides.offsets[r + 1] - 1];
    }

    this.inFrame = new Uint8Array(rides.count);
    for (let r = 0; r < rides.count; r++) this.inFrame[r] = this.visible(r) ? 1 : 0;

    const mk = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      return c;
    };
    this.ghost = mk();
    this.trailCanvas = mk();
    this.trail = this.trailCanvas.getContext('2d')!;
    this.trail.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    this.out = canvas.getContext('2d', { alpha: false })!;

    // A full day has ~30x the sample's rides: fainter strokes keep the same
    // overall brightness instead of burning out to white.
    const density = Math.min(1, 6000 / Math.max(1, rides.count));
    const [r, g, b] = opts.streak ?? [255, 166, 72];
    // The sample adds light (busy streets glow white-hot). Every ride would
    // burn the whole island to white that way, so it paints over instead and
    // busy streets settle at the streak colour.
    this.streakOp = density < 1 ? 'source-over' : 'lighter';
    const a = density < 1 ? 0.07 : 0.6;
    this.streakCss = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    this.headCss = density < 1
      ? `rgba(${r},${Math.min(255, g + 40)},${Math.min(255, b + 50)},0.55)`
      : `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 70)},${Math.min(255, b + 90)},0.95)`;
    const scale = Math.max(W, H) / 768;  // sizes were tuned on a 432x768 frame
    this.streakWidth = (density < 1 ? 1.3 : 1.7) * scale;
    this.headRadius = (density < 1 ? 0.9 : 1.5) * scale;

    this.drawGhost(density, scale);
  }

  get rideCount(): number {
    return this.rides.count;
  }

  // Skip rides that start and end well outside the frame.
  private visible(r: number): boolean {
    const { width: W, height: H } = this.size;
    const i = this.rides.offsets[r], j = this.rides.offsets[r + 1] - 1;
    const off = (x: number, y: number) => x < -W * 0.1 || x > W * 1.1 || y < -H * 0.1 || y > H * 1.1;
    return !(off(this.rx[i], this.ry[i]) && off(this.rx[j], this.ry[j]));
  }

  // Every route of the day, faintly: the bike network as a ghost map. The
  // full day is thinned to ~12k rides; more adds nothing but noise.
  private drawGhost(density: number, scale: number) {
    const { dpr } = this.size;
    const g = this.ghost.getContext('2d')!;
    g.fillStyle = BG;
    g.fillRect(0, 0, this.ghost.width, this.ghost.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'lighter';
    const stride = density < 1 ? Math.max(1, Math.floor(this.rides.count / 12000)) : 1;
    const shown = Math.ceil(this.rides.count / stride);
    g.strokeStyle = `rgba(120,138,168,${((density < 1 ? 0.011 : 0.036) * Math.min(1, Math.pow(6000 / shown, 0.6))).toFixed(4)})`;
    g.lineWidth = 0.8 * scale;
    const { offsets } = this.rides;
    for (let r = 0; r < this.rides.count; r += stride) {
      if (!this.inFrame[r]) continue;
      const a = offsets[r], b = offsets[r + 1];
      g.beginPath();
      g.moveTo(this.rx[a], this.ry[a]);
      for (let i = a + 1; i < b; i++) g.lineTo(this.rx[i], this.ry[i]);
      g.stroke();
    }
  }

  clear() {
    this.trail.save();
    this.trail.setTransform(1, 0, 0, 1, 0, 0);
    this.trail.clearRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
    this.trail.restore();
    this.heads = [];
  }

  // Fade by clip time, so trails look the same at any frame rate.
  fade(dtSeconds: number) {
    const g = this.trail;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0,0,0,${(1 - Math.pow(0.93, dtSeconds * 60)).toFixed(4)})`;
    g.fillRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
    g.restore();
  }

  // Draw what every bike rode between two clock times (hours of the day).
  drawWindow(h0: number, h1: number) {
    this.heads = [];
    if (h1 <= h0) return;
    const s0 = h0 * 3600, s1 = h1 * 3600;
    const { offsets, ts } = this.rides;
    const { rx, ry, t0, t1, inFrame } = this;
    const g = this.trail;
    g.globalCompositeOperation = this.streakOp;
    g.strokeStyle = this.streakCss;
    g.lineWidth = this.streakWidth;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let r = 0; r < this.rides.count; r++) {
      if (!inFrame[r] || t0[r] > s1 || t1[r] < s0) continue;
      const first = offsets[r], last = offsets[r + 1] - 1;
      const a = Math.max(s0, t0[r]), b = Math.min(s1, t1[r]);
      let j = first;
      while (j < last - 1 && ts[j + 1] < a) j++;
      let f = ts[j + 1] > ts[j] ? (a - ts[j]) / (ts[j + 1] - ts[j]) : 0;
      g.beginPath();
      g.moveTo(rx[j] + (rx[j + 1] - rx[j]) * f, ry[j] + (ry[j + 1] - ry[j]) * f);
      while (j < last - 1 && ts[j + 1] < b) {
        j++;
        g.lineTo(rx[j], ry[j]);
      }
      f = ts[j + 1] > ts[j] ? Math.min(1, (b - ts[j]) / (ts[j + 1] - ts[j])) : 1;
      const ex = rx[j] + (rx[j + 1] - rx[j]) * f, ey = ry[j] + (ry[j + 1] - ry[j]) * f;
      g.lineTo(ex, ey);
      g.stroke();
      if (t1[r] > s1) this.heads.push(ex, ey);
    }
    g.globalCompositeOperation = 'source-over';
  }

  present() {
    const { dpr } = this.size;
    const o = this.out;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.drawImage(this.ghost, 0, 0);
    o.globalCompositeOperation = 'lighter';
    o.drawImage(this.trailCanvas, 0, 0);
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    o.fillStyle = this.headCss;
    const rad = this.headRadius;
    const h = this.heads;
    o.beginPath();
    for (let i = 0; i < h.length; i += 2) {
      o.moveTo(h[i] + rad, h[i + 1]);
      o.arc(h[i], h[i + 1], rad, 0, Math.PI * 2);
    }
    o.fill();
    o.globalCompositeOperation = 'source-over';
  }
}
