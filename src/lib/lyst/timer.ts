/**
 * The lyst clock. The SERVER owns the timer (public.lyst_timer): a device never counts time by itself, it only DISPLAYS
 * remaining = remaining_ms - (server now - started_at). Two things make that safe on a phone or a tablet:
 *   - the server clock offset is measured on every answer (the sample with the shortest round trip wins), so a wrong device clock cannot show a wrong time
 *   - the display is derived from state on every frame, so a refresh, a sleeping tab or a reconnect shows the true time at once
 * Pure: no timers, no network. The hook that polls lives in useLystState.
 */
export type TimerMode = 'fight' | 'break' | 'extended_break' | 'dq' | 'equipment' | 'custom';
export type TimerStatus = 'idle' | 'running' | 'paused';

export interface LystTimer {
  event_id: string; field_key: string; match_id: string | null; round_no: number; mode: TimerMode; status: TimerStatus;
  duration_ms: number; remaining_ms: number; started_at: string | null; rev: number; can_restore?: boolean;
}

export interface TimerPreset { key: string; label: string; seconds: number; kind: TimerMode }

export const MODE_LABEL: Record<TimerMode, string> = { fight: 'Round', break: 'Break', extended_break: 'Long break', dq: 'DQ countdown', equipment: 'Equipment', custom: 'Custom' };

/** Starting values only: the event's own settings (event_lyst_settings) replace them. */
export const DEFAULT_PRESETS: readonly TimerPreset[] = [
  { key: 'fight', label: 'Round', seconds: 60, kind: 'fight' },
  { key: 'break', label: 'Break', seconds: 30, kind: 'break' },
  { key: 'long_break', label: 'Long break', seconds: 180, kind: 'extended_break' },
  { key: 'dq', label: 'DQ countdown', seconds: 60, kind: 'dq' },
  { key: 'equipment', label: 'Equipment', seconds: 60, kind: 'equipment' }
];

/** The first preset of a kind, or a sensible fallback so a button never has nothing to start. */
export function presetOf(presets: readonly TimerPreset[] | undefined, kind: TimerMode): TimerPreset {
  const hit = (presets ?? DEFAULT_PRESETS).find(p => p.kind === kind) ?? DEFAULT_PRESETS.find(p => p.kind === kind);
  return hit ?? { key: kind, label: MODE_LABEL[kind], seconds: 60, kind };
}

/** Best estimate of (server clock - this device's clock), refined by every answer. Smaller round trip = better sample. */
export class ServerClock {
  private best: { offset: number; rtt: number } | null = null;
  /** Feed one answer: the server's `server_now`, and the device times just before sending and just after receiving. */
  sample(serverNowMs: number, sentAt: number, receivedAt: number): void {
    if (!Number.isFinite(serverNowMs)) return;
    const rtt = Math.max(0, receivedAt - sentAt);
    const offset = serverNowMs - (sentAt + receivedAt) / 2;
    // keep the sharpest sample, but let an old one age out so a device clock that drifts is not trusted forever
    if (!this.best || rtt <= this.best.rtt + 25 || Math.abs(offset - this.best.offset) > 1500) this.best = { offset, rtt };
  }
  get known(): boolean { return this.best !== null; }
  get offset(): number { return this.best?.offset ?? 0; }
  now(deviceNow: number = Date.now()): number { return deviceNow + this.offset; }
}

/** Milliseconds left to show, from server state. Never negative; a running timer past zero shows 0. */
export function remainingMs(t: Pick<LystTimer, 'status' | 'remaining_ms' | 'started_at'>, serverNow: number): number {
  if (t.status !== 'running' || !t.started_at) return Math.max(0, t.remaining_ms);
  const started = Date.parse(t.started_at);
  if (!Number.isFinite(started)) return Math.max(0, t.remaining_ms);
  return Math.max(0, t.remaining_ms - Math.max(0, serverNow - started));
}

/** M:SS, rounding UP so the clock shows 0:01 until the last millisecond (a referee never sees 0:00 while time remains). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A word for what the clock is doing, for people who do not look at colours. */
export function timerWord(t: Pick<LystTimer, 'status' | 'mode'>, left: number): string {
  if (t.status === 'idle') return `${MODE_LABEL[t.mode]} ready`;
  if (t.status === 'paused') return `${MODE_LABEL[t.mode]} paused`;
  return left <= 0 ? `${MODE_LABEL[t.mode]} time` : `${MODE_LABEL[t.mode]} running`;
}

/** Visual urgency: only the last 10 seconds of a running clock. */
export const timerTone = (t: Pick<LystTimer, 'status'>, left: number): 'calm' | 'low' | 'zero' => (t.status === 'running' ? (left <= 0 ? 'zero' : left <= 10_000 ? 'low' : 'calm') : 'calm');

/** The timer as the screen should treat it for one match: another match on the same field has the clock, or there is none yet. */
export function timerFor(t: LystTimer | null | undefined, matchId: string): LystTimer | null {
  return t && t.match_id === matchId ? t : null;
}

/** What "NEXT" should be once the clock for the current mode is done. Fights end in a break; a break leads into the next round. */
export function nextMode(mode: TimerMode): TimerMode { return mode === 'fight' ? 'break' : mode === 'break' || mode === 'extended_break' ? 'fight' : mode; }

/** A timer command can only be sent while there is signal: the timer is never "started offline" and fixed up later. */
export const TIMER_ACTIONS = ['set', 'start', 'pause', 'resume', 'reset', 'adjust', 'restore'] as const;
export type TimerAction = (typeof TIMER_ACTIONS)[number];
