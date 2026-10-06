/**
 * The announcer microphone as a quiet / speaking summary. OBS sends level meters many times a second (only when this program subscribes to them);
 * they are reduced HERE to one word about once a second. The raw levels are never stored, logged, shown or sent anywhere.
 */
export type MicLevel = 'speaking' | 'quiet' | 'unknown';

export const toDb = (mul: number): number => (mul > 0 ? 20 * Math.log10(mul) : -100);

/** The loudest sample in one InputVolumeMeters entry (inputLevelsMul: per channel [magnitude, peak, input peak]), as a multiplier. */
export function loudestMul(levels: unknown): number {
  let best = 0;
  if (!Array.isArray(levels)) return 0;
  for (const ch of levels) {
    if (!Array.isArray(ch)) continue;
    for (const v of ch) if (typeof v === 'number' && Number.isFinite(v) && v > best) best = v;
  }
  return best;
}

export class MicSummary {
  private lastLoudAt = -Infinity;
  private lastEventAt = -Infinity;
  /** `holdMs`: stay "speaking" this long after the last loud sample (a breath between words is not silence). */
  constructor(private readonly thresholdDb: () => number, private readonly holdMs = 1000, private readonly unknownAfterMs = 3000) {}
  /** Feed the level of one meter event for the microphone input. */
  push(mul: number, nowMs: number): void {
    this.lastEventAt = nowMs;
    const db = toDb(mul);
    if (db > this.thresholdDb()) this.lastLoudAt = nowMs;
  }
  /** One word for the status report. Call about once a second. */
  summary(nowMs: number): MicLevel {
    if (nowMs - this.lastEventAt > this.unknownAfterMs) return 'unknown';
    return nowMs - this.lastLoudAt <= this.holdMs ? 'speaking' : 'quiet';
  }
  reset(): void { this.lastLoudAt = -Infinity; this.lastEventAt = -Infinity; }
}
