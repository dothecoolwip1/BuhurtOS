// Writes the PWA PNG icons into public/ with no dependencies (a tiny software rasterizer for the favicon shield).
// Run: node scripts/makeIcons.mjs. The matching SVGs (public/icon-any.svg, icon-maskable.svg) are the hand-written source of truth.
import fs from 'node:fs';
import zlib from 'node:zlib';

const bez = (p0, p1, p2, p3, n = 32) => Array.from({ length: n }, (_, i) => {
  const t = (i + 1) / n, u = 1 - t;
  return [0, 1].map(k => u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k]);
});
const SHIELD = [[2, 2], [28, 2], [28, 16], ...bez([28, 16], [28, 24], [22, 29], [15, 32]), ...bez([15, 32], [8, 29], [2, 24], [2, 16]), [2, 16]];
const STOPS = [[0, [0xE3, 0xC7, 0x7A]], [0.35, [0xC9, 0x89, 0x3A]], [0.65, [0x8E, 0x4E, 0x6B]], [1, [0x2C, 0x6B, 0xB0]]];
const BARS = [[[9, 9], [9, 24]], [[21, 9], [21, 24]], [[6, 14], [24, 14]]];
const BG = [0x0F, 0x14, 0x1B];

function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(x, y, [a, b]) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
function gradient(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], k = (t - t0) / (t1 - t0);
      return c0.map((v, n) => v + (c1[n] - v) * k);
    }
  }
  return STOPS[3][1];
}
/** Colour at a point in 30x34 shield space, or null outside the shield. */
function shield(x, y) {
  if (!inPoly(x, y, SHIELD)) return null;
  let c = gradient(((x - 2) / 26 + (y - 2) / 30) / 2);
  if (BARS.some(b => segDist(x, y, b) <= 1.3)) c = c.map(v => v * 0.08 + 255 * 0.92);
  return c;
}

function render(size, { scale, tx, ty, radius }) {
  const px = Buffer.alloc(size * size * 4);
  const S = 3; // 3x3 supersampling
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = ((x + (sx + 0.5) / S) / size) * 512, Y = ((y + (sy + 0.5) / S) / size) * 512;
      let col = null;
      if (radius > 0) { // rounded square, transparent corners
        const cx = Math.min(Math.max(X, radius), 512 - radius), cy = Math.min(Math.max(Y, radius), 512 - radius);
        if (Math.hypot(X - cx, Y - cy) > radius) continue;
      }
      col = shield((X - tx) / scale, (Y - ty) / scale) ?? BG;
      r += col[0]; g += col[1]; b += col[2]; a += 1;
    }
    const o = (y * size + x) * 4, n = S * S;
    px[o] = a ? r / a : 0; px[o + 1] = a ? g / a : 0; px[o + 2] = a ? b / a : 0; px[o + 3] = Math.round((a / n) * 255);
  }
  return px;
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, px) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const any = { scale: 10.67, tx: 96, ty: 74, radius: 96 };
const maskable = { scale: 8, tx: 136, ty: 120, radius: 0 };
const jobs = [['icon-192.png', 192, any], ['icon-512.png', 512, any], ['icon-maskable-512.png', 512, maskable]];
for (const [name, size, opts] of jobs) fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size, render(size, opts)));
console.log('wrote', jobs.map(j => j[0]).join(', '));
