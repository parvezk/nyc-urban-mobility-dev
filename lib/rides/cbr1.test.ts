import { decodeChunk, loadOrder } from './cbr1';

// Build a tiny chunk: one e-bike member ride (3 points), one classic casual ride (2 points).
function fixture(): ArrayBuffer {
  const bytes = 8 + (14 + 2 * 6) + (14 + 1 * 6);
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  'CBR1'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 2, true);
  let o = 8;
  v.setUint8(o, 0b11); v.setUint8(o + 1, 3); v.setUint32(o + 2, 28_800, true);
  v.setInt32(o + 6, -7_398_000, true); v.setInt32(o + 10, 4_075_000, true); o += 14;
  v.setInt16(o, 10, true); v.setInt16(o + 2, -20, true); v.setUint16(o + 4, 30, true); o += 6;
  v.setInt16(o, 5, true); v.setInt16(o + 2, 5, true); v.setUint16(o + 4, 60, true); o += 6;
  v.setUint8(o, 0); v.setUint8(o + 1, 2); v.setUint32(o + 2, 29_000, true);
  v.setInt32(o + 6, -7_400_000, true); v.setInt32(o + 10, 4_070_000, true); o += 14;
  v.setInt16(o, -100, true); v.setInt16(o + 2, 100, true); v.setUint16(o + 4, 600, true);
  return buf;
}

describe('cbr1 decoder', () => {
  it('splits rides into groups with cumulative points and times', () => {
    const c = decodeChunk(fixture(), 8);
    expect(c.rides).toBe(2);
    expect(c.endSec).toBe(29_600);
    const e = c.groups['ebike-member'];
    expect(e.length).toBe(1);
    expect(Array.from(e.startIndices)).toEqual([0, 3]);
    expect(Array.from(e.timestamps)).toEqual([28_800, 28_830, 28_890]);
    expect(e.positions[2]).toBeCloseTo(-73.9799, 4);
    expect(e.positions[5]).toBeCloseTo(40.74985, 4);
    const k = c.groups['classic-casual'];
    expect(k.length).toBe(1);
    expect(Array.from(k.timestamps)).toEqual([29_000, 29_600]);
    expect(c.groups['ebike-casual'].length).toBe(0);
  });

  it('rejects files with the wrong magic', () => {
    const buf = fixture();
    new DataView(buf).setUint8(0, 0);
    expect(() => decodeChunk(buf, 8)).toThrow(/magic/);
  });

  it('loads from the current hour forward', () => {
    expect(loadOrder(22).slice(0, 4)).toEqual([22, 23, 0, 1]);
  });
});
