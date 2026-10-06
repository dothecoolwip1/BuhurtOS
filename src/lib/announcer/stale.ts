/**
 * "Is this screen still hearing from the server?" Pure. The Announcer keeps showing the last good data when a refresh fails (never a blank screen),
 * and says so, quietly, once it has gone more than STALE_AFTER_MS without a good answer. The heartbeat is the official lyst read, which polls every
 * few seconds whether or not realtime is connected; a healthy screen therefore never says it is stale.
 */
export const STALE_AFTER_MS = 20_000;

export interface Staleness { stale: boolean; /** Seconds since the last good answer (null before the first). */ ageSeconds: number | null; lastGood: string | null }

const pad = (n: number) => String(n).padStart(2, '0');
/** HH:MM:SS in the device's local time. */
export function formatHms(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function staleness(lastGoodAt: number | null, now: number, afterMs = STALE_AFTER_MS): Staleness {
  if (lastGoodAt === null) return { stale: false, ageSeconds: null, lastGood: null };
  const age = Math.max(0, now - lastGoodAt);
  return { stale: age > afterMs, ageSeconds: Math.floor(age / 1000), lastGood: formatHms(lastGoodAt) };
}

/** The banner's words. */
export const staleLine = (s: Staleness): string | null => (s.stale && s.lastGood ? `Not updating, last good ${s.lastGood}` : null);

/** The newest of several "last good" times (ignoring ones that never happened), or null. */
export const latest = (...times: Array<number | null | undefined>): number | null => {
  const t = times.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return t.length ? Math.max(...t) : null;
};
