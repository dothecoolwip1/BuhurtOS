/** Small deterministic helpers shared by the NACL-test generator. Nothing here is random without a seed. */
import { createHash } from 'node:crypto';
import { mulberry32, seededShuffle } from '../../src/lib/draw';

/** Fixed id derived from a name (UUID v5 layout over SHA-1), so every load of the dataset uses the same ids. */
export function uid(name: string): string {
  const h = createHash('sha1').update(`buhurtos-nacl-test|${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export function hash32(s: string): number {
  return createHash('sha1').update(s).digest().readUInt32BE(0);
}

export type Rand = () => number;
/** A random stream that depends only on the label. */
export const rngFor = (label: string): Rand => mulberry32(hash32(`nacl-test|${label}`));

export const shuffle = <T>(items: readonly T[], label: string): T[] => seededShuffle(items, hash32(`nacl-test|${label}`));

export function gauss(r: Rand): number {
  const u = Math.max(r(), 1e-9), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function poisson(r: Rand, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= r(); } while (p > l && k < 30);
  return k - 1;
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Weighted sampling without replacement (Efraimidis-Spirakis). Returns the chosen indices. */
export function weightedSample(weights: readonly number[], k: number, r: Rand): number[] {
  const keyed = weights.map((w, i) => ({ i, key: w > 0 ? Math.log(Math.max(r(), 1e-12)) / w : -Infinity }));
  keyed.sort((a, b) => b.key - a.key || a.i - b.i);
  return keyed.filter(x => x.key > -Infinity).slice(0, k).map(x => x.i);
}

/** SQL text literal. */
export const q = (s: string | null | undefined): string => (s === null || s === undefined ? 'null' : `'${s.replace(/'/g, "''")}'`);
export const qArr = (a: readonly string[]): string => (a.length === 0 ? `'{}'::text[]` : `array[${a.map(q).join(', ')}]::text[]`);
export const qJson = (o: unknown): string => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

export function haversineKm(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const yearOf = (iso: string): number => Number(iso.slice(0, 4));
