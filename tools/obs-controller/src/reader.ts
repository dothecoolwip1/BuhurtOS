import { eventPhase, todayIso } from '../../../src/lib/careerView';
import { ServerClock } from '../../../src/lib/lyst/timer';
import type { ControlInput } from '../../../src/lib/broadcast/decide';
import type { LocalFiles } from './config';
import type { ControlSource, ControllerState, PublicDataSource } from './datasource';
import type { Logger } from './log';
import type { ControllerSession } from './session';
import { buildFields, fightsNeedingFirstLive, newFieldMemory, type BuiltField, type RawPublic } from './scenes';

/**
 * Reads BuhurtOS: the same public data the Pack 14 overlay uses, plus controller_state() when this laptop has a controller session.
 * Polling, never overlapping, with backoff (2.5 s normally, doubling to at most 10 s while failing). A failed read keeps the last good data:
 * the Companion never changes scene because it could not reach BuhurtOS.
 */
export const STALE_AFTER_MS = 20_000;

export interface ServerControl { control: ControlInput & { musicMode: 'auto' | 'muted' | 'paused'; autoDuck: boolean; rev: number; updatedByLabel: string | null }; known: boolean }
export interface ReaderStatus {
  /** Last time the public data was read successfully (epoch ms), or null. */
  dataOkAt: number | null;
  /** Last time controller_state() answered. */
  controllerOkAt: number | null;
  controllerError: string | null;
  dataError: string | null;
  failures: number;
  eventName: string | null;
  eventSlug: string | null;
  eventId: string | null;
  notFound: boolean;
}

export interface ReaderOptions {
  data: PublicDataSource;
  control: ControlSource | null;
  files: LocalFiles;
  session: ControllerSession;
  logger: Logger;
  pollMs?: number;
  now?: () => number;
  /** Re-read the event and its competitions this often (a new competition or field appears without a restart). */
  eventRefreshMs?: number;
}

const DEFAULT_CONTROL: ServerControl['control'] = { mode: 'auto', targetKind: null, targetField: null, priorityFields: [], musicMode: 'auto', autoDuck: true, rev: 0, updatedByLabel: null };

export class StateReader {
  private raw: RawPublic | null = null;
  private eventLoadedAt = 0;
  private clock = new ServerClock();
  private memory = newFieldMemory();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inflight = false;
  private fails = 0;
  serverControl: ServerControl = { control: DEFAULT_CONTROL, known: false };
  /** The server's Camera Off answer: null = not known right now (no controller session, or BuhurtOS unreachable). */
  serverCamera: { active: boolean; reason: string | null; rev: number | null } | null = null;
  status: ReaderStatus = { dataOkAt: null, controllerOkAt: null, controllerError: null, dataError: null, failures: 0, eventName: null, eventSlug: null, eventId: null, notFound: false };
  private readonly now: () => number;
  private readonly pollMs: number;

  constructor(private readonly o: ReaderOptions) {
    this.now = o.now ?? Date.now; this.pollMs = o.pollMs ?? 2500;
    // fights' first-live times from before a restart (so a restart lands on the same fight even if the database is unreachable at that moment)
    for (const [id, ms] of Object.entries(o.files.state.firstLive)) this.memory.durableFirstLive.set(id, ms);
  }

  start(): void { if (this.running) return; this.running = true; void this.loop(); }
  stop(): void { this.running = false; if (this.timer) clearTimeout(this.timer); }
  /** Read now (and reschedule). Used by tests and after a setting changes. */
  async pollNow(): Promise<void> { await this.poll(); }

  private async loop(): Promise<void> {
    while (this.running) {
      await this.poll();
      const delay = Math.min(this.pollMs * 2 ** Math.min(this.fails, 4), 10_000);          // 2.5, 5, 10 s ... never more than 10 s, so recovery is quick
      await new Promise<void>(res => { this.timer = setTimeout(res, delay); });
    }
  }

  private slug(): string | null { return this.o.session.whoami?.event.slug ?? this.status.eventSlug ?? this.o.files.config.eventSlug; }

  async poll(): Promise<void> {
    if (this.inflight) return;                        // never overlap
    this.inflight = true;
    try {
      await this.o.session.ensure();
      await this.readController();
      await this.readPublic();
    } catch (e) {
      this.o.logger.warn('reading BuhurtOS failed unexpectedly', { message: (e as Error).message });
    } finally { this.inflight = false; }
  }

  private async readController(): Promise<void> {
    if (this.o.session.status === 'no_code') {
      // no controller code: BuhurtOS is not asked about Camera Off at all, so an old answer must not keep the cameras off for ever (the local latch still works)
      this.serverCamera = null; this.serverControl = { control: DEFAULT_CONTROL, known: false }; this.status.controllerError = null;
      if (this.o.files.state.lastServerCamera) this.o.files.updateState(st => { st.lastServerCamera = null; });
      return;
    }
    if (!this.o.control || !this.o.session.hasToken) { this.serverCamera = null; this.serverControl = { ...this.serverControl, known: false }; return; }
    try {
      const s: ControllerState = await this.o.control.controllerState();
      const c = s.control;
      this.serverControl = { known: true, control: { mode: c.mode === 'manual' ? 'manual' : 'auto', targetKind: c.target_kind, targetField: c.target_field, priorityFields: c.priority_fields ?? [], musicMode: c.music_mode ?? 'auto', autoDuck: c.auto_duck !== false, rev: c.rev ?? 0, updatedByLabel: c.updated_by_label } };
      this.serverCamera = { active: s.camera?.active === true, reason: s.camera?.active ? s.camera.reason ?? null : null, rev: s.camera?.rev ?? null };
      this.status.controllerOkAt = this.now(); this.status.controllerError = null;
      this.status.eventSlug = s.event.slug; this.status.eventName = s.event.name; this.status.eventId = s.event.id;
      // remember what BuhurtOS last said about Camera Off: an unreachable server keeps a latched Off
      const prev = this.o.files.state.lastServerCamera;
      if (!prev || prev.active !== this.serverCamera.active || prev.rev !== this.serverCamera.rev) {
        this.o.files.updateState(st => { st.lastServerCamera = { active: this.serverCamera!.active, reason: this.serverCamera!.reason, rev: this.serverCamera!.rev, at: new Date(this.now()).toISOString() }; });
      }
    } catch (e) {
      this.serverCamera = null;                        // unknown, NOT "off": the decision keeps a latched Off
      const code = (e as { code?: string }).code;
      this.status.controllerError = code === '42501' ? 'BuhurtOS does not accept this controller session' : `cannot read BuhurtOS controller state (${String((e as Error).message).slice(0, 80)})`;
      if (code === '42501') this.o.session.invalidate();
    }
  }

  private async readPublic(): Promise<void> {
    const slug = this.slug();
    if (!slug) { this.status.dataError = 'No event set: enter the controller code or an event address'; return; }
    const t = this.now();
    try {
      if (!this.raw || this.raw.event.slug !== slug || t - this.eventLoadedAt > (this.o.eventRefreshMs ?? 30_000)) {
        const e = await this.o.data.fetchEvent(slug);
        if (!e) { this.status.notFound = true; this.status.dataError = `The event "${slug}" is not public (or does not exist)`; this.status.eventSlug = slug; return; }
        this.status.notFound = false;
        this.status.eventName ??= e.event.name; this.status.eventSlug = e.event.slug; this.status.eventId = e.event.id;
        this.eventLoadedAt = t;
        this.raw = { event: { id: e.event.id, slug: e.event.slug, name: e.event.name, startsOn: e.event.startsOn, endsOn: e.event.endsOn, fieldCount: e.event.fieldCount ?? null }, competitions: e.competitions.map(c => ({ id: c.id, name: c.name, sort: c.sort })), matches: this.raw?.matches ?? [], scores: this.raw?.scores ?? [], lyst: this.raw?.lyst ?? [] };
      }
      const raw = this.raw as RawPublic;
      const [comps, lyst] = await Promise.all([
        Promise.all(raw.competitions.map(c => this.o.data.fetchCompetition(c.id))),
        this.o.data.fetchLyst(raw.event.id)
      ]);
      const at = lyst.rows[0]?.server_now ? Date.parse(lyst.rows[0].server_now) : NaN;
      if (Number.isFinite(at)) this.clock.sample(at, lyst.sentAt, lyst.receivedAt);
      this.raw = { ...raw, matches: comps.flatMap(c => c.matches), scores: comps.flatMap(c => c.scores), lyst: lyst.rows };
      this.status.dataOkAt = this.now(); this.status.dataError = null; this.fails = 0; this.status.failures = 0;
      await this.learnFirstLive();
    } catch (e) {
      this.fails++; this.status.failures = this.fails;
      this.status.dataError = `cannot read BuhurtOS (${String((e as Error).message ?? e).slice(0, 100)})`;
    }
  }

  /** Ask the database when the fights now in progress first went live (durable); keep the answer, in memory and in the local file. */
  private async learnFirstLive(): Promise<void> {
    if (!this.raw) return;
    const built = this.fields(this.now());
    const need = fightsNeedingFirstLive(built, this.memory);
    if (need.length === 0) return;
    try {
      const rows = await this.o.data.fetchFirstRounds(need);
      let changed = false;
      for (const r of rows) { const ms = Date.parse(r.created_at); if (Number.isFinite(ms)) { this.memory.durableFirstLive.set(r.match_id, ms); this.o.files.state.firstLive[r.match_id] = ms; changed = true; } }
      if (changed) {
        const keys = Object.keys(this.o.files.state.firstLive);
        if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete this.o.files.state.firstLive[k];
        this.o.files.saveState();
      }
    } catch (e) { this.o.logger.debug('could not read when fights went live; using what was seen', { message: (e as Error).message }); }
  }

  /** The per-field scenes for `nowMs`, rebuilt from the last good data every time (a result's 8 s / 25 s windows keep counting while offline). */
  fields(nowMs: number): BuiltField[] {
    if (!this.raw) return [];
    const r = this.raw;
    return buildFields(r, {
      nowMs, serverNowMs: this.clock.known ? this.clock.now(nowMs) : nowMs, memory: this.memory,
      mappedKeys: Object.keys(this.o.files.config.mapping.lysts),
      phase: eventPhase(r.event.startsOn, r.event.endsOn, todayIso(new Date(nowMs)))
    });
  }

  get stale(): boolean { return this.status.dataOkAt === null ? false : this.now() - this.status.dataOkAt > STALE_AFTER_MS; }
  get hasData(): boolean { return this.raw !== null; }
}
