/**
 * How the public event screens stay current, without a refetch storm. Pure coordination logic (timers and fetches are injected), so it can be tested.
 *
 *  - A realtime change for competition X refetches X only (never every competition of the event).
 *  - Many changes inside the debounce window cost one refetch per competition that changed.
 *  - A change for a competition we are not showing is ignored.
 *  - "live" is only claimed after the realtime channel is subscribed AND a full authoritative fetch finished after that. A dropped channel falls back
 *    to polling and the screen stops saying live until it has re-fetched everything again (a phone coming out of a dead zone shows what is true).
 */
export type Connection = 'connecting' | 'live' | 'polling';
export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

export interface LiveSyncOptions<T> {
  ids: readonly string[];
  fetchOne: (id: string) => Promise<T>;
  /** `full` is true when every competition was re-read (initial load, reconnect, poll), false for a targeted patch. */
  onData: (patch: Record<string, T>, full: boolean) => void;
  onConnection: (c: Connection) => void;
  onError?: (e: unknown) => void;
  debounceMs?: number;
  pollMs?: number;
  /** While live, a slow full refresh covers anything realtime cannot deliver (for example deletes). */
  safetyMs?: number;
}

export const LIVE_DEBOUNCE_MS = 400;
export const LIVE_POLL_MS = 15_000;
export const LIVE_SAFETY_MS = 120_000;

/** The server-side realtime filter for a table that has a competition_id column. Realtime accepts at most 100 values in an `in` filter. */
export function realtimeFilter(ids: readonly string[]): string | undefined {
  if (ids.length === 0 || ids.length > 100) return undefined;
  return ids.length === 1 ? `competition_id=eq.${ids[0]}` : `competition_id=in.(${ids.join(',')})`;
}

export class LiveSync<T> {
  fetches = 0;                     // how many per-competition reads this instance has made (for measurement and tests)
  private ids: Set<string>;
  private dirty = new Set<string>();
  private dirtyAll = false;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;
  private safety: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private again = false;
  private alive = false;
  private subscribed = false;
  private epoch = 0;
  connection: Connection = 'connecting';

  constructor(private o: LiveSyncOptions<T>) { this.ids = new Set(o.ids); }

  private setConnection(c: Connection) { if (c !== this.connection) { this.connection = c; this.o.onConnection(c); } }

  start(): void {
    this.alive = true;
    this.setConnection('connecting');
    void this.fullLoad();
    this.startPolling();   // until realtime reports it is connected
  }

  stop(): void {
    this.alive = false;
    clearTimeout(this.debounce); this.stopPolling(); clearInterval(this.safety); this.safety = undefined;
  }

  private startPolling() { if (this.alive && !this.poll) this.poll = setInterval(() => { void this.fullLoad(); }, this.o.pollMs ?? LIVE_POLL_MS); }
  private stopPolling() { if (this.poll) { clearInterval(this.poll); this.poll = undefined; } }

  /** Re-read every competition. Resolves true when it succeeded. */
  async fullLoad(): Promise<boolean> {
    const epoch = this.epoch;
    try {
      const entries = await Promise.all([...this.ids].map(async id => [id, await this.read(id)] as const));
      if (!this.alive || epoch !== this.epoch) return false;
      this.o.onData(Object.fromEntries(entries), true);
      return true;
    } catch (e) { if (this.alive) this.o.onError?.(e); return false; }
  }

  private async read(id: string): Promise<T> { this.fetches += 1; return this.o.fetchOne(id); }

  /** A realtime row event. Pass the row's competition id; without one (a delete that did not carry it) everything is refreshed. */
  change(competitionId?: string): void {
    if (!this.alive) return;
    if (competitionId === undefined) this.dirtyAll = true;
    else if (this.ids.has(competitionId)) this.dirty.add(competitionId);
    else return;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.refreshDirty(); }, this.o.debounceMs ?? LIVE_DEBOUNCE_MS);
  }

  private async refreshDirty(): Promise<void> {
    if (!this.alive) return;
    if (this.inFlight) { this.again = true; return; }
    this.inFlight = true;
    try {
      if (this.dirtyAll) { this.dirtyAll = false; this.dirty.clear(); await this.fullLoad(); }
      else {
        const batch = [...this.dirty]; this.dirty.clear();
        const results = await Promise.all(batch.map(async id => [id, await this.read(id)] as const));
        if (this.alive) this.o.onData(Object.fromEntries(results), false);
      }
    } catch (e) { if (this.alive) this.o.onError?.(e); }
    finally {
      this.inFlight = false;
      if (this.again && this.alive) { this.again = false; void this.refreshDirty(); }
    }
  }

  /** The realtime channel's status. */
  async status(s: ChannelStatus): Promise<void> {
    if (!this.alive) return;
    if (s === 'SUBSCRIBED') {
      this.subscribed = true;
      this.stopPolling();
      const ok = await this.fullLoad();   // authoritative state first
      if (!this.alive) return;
      if (ok && this.subscribed) {
        this.setConnection('live');
        if (!this.safety) this.safety = setInterval(() => { void this.fullLoad(); }, this.o.safetyMs ?? LIVE_SAFETY_MS);
      } else { this.setConnection('polling'); this.startPolling(); }
    } else {
      this.subscribed = false;
      clearInterval(this.safety); this.safety = undefined;
      this.setConnection('polling');
      this.startPolling();
    }
  }
}
