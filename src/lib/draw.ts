/** Reproducible random draw: the same seed always gives the same pools, so a draw can be shown, checked and re-run. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deal shuffled entrants into pools of the given sizes (sizes must add up to the entrant count). */
export function drawPools<T>(entrants: readonly T[], sizes: readonly number[], seed: number): T[][] {
  if (sizes.reduce((x, y) => x + y, 0) !== entrants.length) throw new Error('pool sizes must add up to the number of entrants');
  const shuffled = seededShuffle(entrants, seed);
  const pools: T[][] = [];
  let at = 0;
  for (const size of sizes) { pools.push(shuffled.slice(at, at + size)); at += size; }
  return pools;
}
