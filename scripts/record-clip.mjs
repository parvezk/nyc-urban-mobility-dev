#!/usr/bin/env node
/**
 * record-clip.mjs — render the /clip loop to MP4, frame by frame.
 *
 * The page exposes window.__clip.seek(frame); we step through every frame,
 * screenshot it at the exact export size and pipe the PNGs into ffmpeg. The
 * output is identical on every run and never drops frames, however slow the
 * machine is.
 *
 * Needs: the app running (npm run build && npm start, or npm run dev),
 *        Playwright (npm i --no-save playwright && npx playwright install chromium)
 *        ffmpeg on PATH (brew install ffmpeg)
 *
 * Usage:
 *   node scripts/record-clip.mjs                       # 9x16, 1x1 and 16x9
 *   node scripts/record-clip.mjs --format 9x16
 *   node scripts/record-clip.mjs --url http://localhost:3000 --out out/clips
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIZES = { '9x16': [1080, 1920], '1x1': [1080, 1080], '16x9': [1920, 1080] };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = arg('url', 'http://localhost:3000');
const outDir = arg('out', path.join('out', 'clips'));
const formatArg = arg('format', 'all');
const formats = formatArg === 'all' ? Object.keys(SIZES) : [formatArg];
for (const f of formats) {
  if (!SIZES[f]) throw new Error(`Unknown format "${f}". Use 9x16, 1x1, 16x9 or all.`);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is missing. Run: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

// Use the GPU where there is one (macOS: Metal through ANGLE).
const gpuArgs = process.platform === 'darwin'
  ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: gpuArgs });

try {
  for (const format of formats) {
    const [width, height] = SIZES[format];
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.warn(`  page error: ${e.message}`));

    await page.goto(`${baseUrl}/clip?format=${format}&record=1`);
    await page.waitForFunction(() => window.__clip?.isReady(), null, { timeout: 120000 });
    // Hide the Next.js dev badge if this is a dev server.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

    const { frames, fps } = await page.evaluate(() => ({ frames: window.__clip.frames, fps: window.__clip.fps }));
    const outFile = path.join(outDir, `wake-up-${format}.mp4`);
    console.log(`🎬 ${format}: ${frames} frames at ${fps} fps -> ${outFile}`);

    const ffmpeg = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'slow',
      '-movflags', '+faststart', outFile,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => {
      ffmpeg.on('error', err => reject(new Error(`ffmpeg failed to start (${err.message}). Is it installed?`)));
      ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
    });

    // CDP screenshots skip Playwright's font/animation waits, which can stall
    // on a busy WebGL page; seek() has already waited for the frame.
    const cdp = await page.context().newCDPSession(page);
    const started = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate(n => window.__clip.seek(n), f);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) {
        await new Promise(r => ffmpeg.stdin.once('drain', r));
      }
      if (f % 30 === 29) process.stdout.write(`  ${f + 1}/${frames}\r`);
    }
    ffmpeg.stdin.end();
    await done;
    console.log(`  ✅ done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    await page.close();
  }
} finally {
  await browser.close();
}
