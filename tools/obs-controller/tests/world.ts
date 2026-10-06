import type { LiveCompetition, LiveEvent } from '../../../src/data/api';
import type { CompetitionMatch } from '../../../src/data/matches';
import type { LiveScore } from '../../../src/data/liveScores';
import type { LystPublic } from '../../../src/data/lyst';
import type { SceneMode } from '../../../src/lib/broadcast/state';
import type { ControlSource, ControllerState, PublicDataSource } from '../src/datasource';

/**
 * A fake BuhurtOS for tests: public data shaped exactly like the app's data modules return it, so the REAL buildArena / broadcastScene derive the scene modes.
 * `setField('field 1', 'live')` makes that field show the Pack 14 scene mode `live`, etc.
 */
export const EVENT_ID = 'e0000000-0000-4000-8000-000000000001';
export type FightKind = SceneMode;

export class FakeWorld implements PublicDataSource {
  online = true;
  calls = { event: 0, competition: 0, lyst: 0, firstRounds: 0 };
  fields = new Map<string, { kind: FightKind; matchId: string; round: number; scoreA: number; scoreB: number; remainingMs: number; finalizedAgoMs: number; startedAt: string }>();
  firstRounds = new Map<string, string>();
  fieldCount = 3;
  private n = 0;
  failFirstRounds = false;
  constructor(public nowMs: () => number = Date.now) {}

  setField(field: string, kind: FightKind, o: { matchId?: string; startedAt?: string } = {}): string {
    const key = field.toLowerCase();
    const prev = this.fields.get(key);
    const matchId = o.matchId ?? prev?.matchId ?? `m0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
    this.fields.set(key, { kind, matchId, round: prev?.round ?? 1, scoreA: prev?.scoreA ?? 0, scoreB: prev?.scoreB ?? 0, remainingMs: prev?.remainingMs ?? 60_000, finalizedAgoMs: kind === 'complete' ? 1000 : kind === 'winner' ? 12_000 : 90_000, startedAt: o.startedAt ?? prev?.startedAt ?? new Date(this.nowMs()).toISOString() });
    return matchId;
  }
  /** Score / clock / penalty changes: they change data but never the scene mode. */
  bump(field: string, o: { scoreA?: number; scoreB?: number; remainingMs?: number }): void { const f = this.fields.get(field.toLowerCase()); if (f) Object.assign(f, o); }
  setFirstLive(matchId: string, iso: string): void { this.firstRounds.set(matchId, iso); }

  async fetchEvent(slug: string) {
    this.calls.event++;
    if (!this.online) throw new Error('network down');
    if (slug !== 'rumble') return null;
    const event = { id: EVENT_ID, slug: 'rumble', name: 'Rumble Rehearsal', startsOn: '2000-01-01', endsOn: '2999-12-31', fieldCount: this.fieldCount, status: 'published' } as unknown as LiveEvent;
    return { event, competitions: [{ id: 'c1', name: 'Longsword', sort: 1 } as unknown as LiveCompetition] };
  }

  private match(id: string, field: string, queueState: CompetitionMatch['queueState'], position: number, extra: Partial<CompetitionMatch> = {}): CompetitionMatch {
    return {
      id, competitionId: 'c1', stage: 'round_robin', roundLabel: `Round ${position + 1}`, position, pool: null, field, scheduledAt: null, queueState,
      entryA: `${id}-a`, entryB: `${id}-b`, nameA: `Fighter ${position}A`, nameB: `Fighter ${position}B`, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null,
      scoreA: null, scoreB: null, detail: {}, version: 1, finalizedAt: null, ...extra
    };
  }

  async fetchCompetition(_id: string): Promise<{ matches: CompetitionMatch[]; scores: LiveScore[] }> {
    this.calls.competition++;
    if (!this.online) throw new Error('network down');
    const matches: CompetitionMatch[] = [];
    for (const [key, f] of this.fields) {
      const field = key.replace(/\b\w/g, c => c.toUpperCase());
      const nextId = `${f.matchId}-next`;
      const finalAt = new Date(this.nowMs() - f.finalizedAgoMs).toISOString();
      switch (f.kind) {
        case 'idle': break;
        case 'upcoming': matches.push(this.match(f.matchId, field, 'scheduled', 0)); break;
        case 'between':
          matches.push(this.match(`${f.matchId}-old`, field, 'final', 0, { result: 'a', winnerEntryId: `${f.matchId}-old-a`, scoreA: 5, scoreB: 2, finalizedAt: finalAt }), this.match(f.matchId, field, 'on_deck', 1));
          break;
        case 'complete': case 'winner':
          matches.push(this.match(f.matchId, field, 'final', 0, { result: 'a', winnerEntryId: `${f.matchId}-a`, scoreA: 5, scoreB: 3, finalizedAt: finalAt }), this.match(nextId, field, 'on_deck', 1));
          break;
        default: matches.push(this.match(f.matchId, field, 'active', 0));
      }
    }
    return { matches, scores: [] };
  }

  async fetchLyst(_eventId: string) {
    this.calls.lyst++;
    if (!this.online) throw new Error('network down');
    const rows: LystPublic[] = [];
    const now = this.nowMs();
    for (const [key, f] of this.fields) {
      if (!['intro', 'ready', 'live', 'paused', 'break', 'equipment', 'dq_clock', 'disqualified'].includes(f.kind)) continue;
      if (f.kind === 'intro') continue;                                      // called to the field, no lyst state yet
      const timer = (mode: string, status: 'idle' | 'running' | 'paused') => ({ timer_mode: mode as LystPublic['timer_mode'], timer_status: status, timer_duration_ms: 60_000, timer_remaining_ms: f.remainingMs, timer_started_at: status === 'running' ? new Date(now - 2000).toISOString() : null, timer_rev: 1, timer_round: f.round });
      const base = { match_id: f.matchId, event_id: EVENT_ID, field_key: key, queue_state: 'active', round_no: f.round, round_status: 'running' as LystPublic['round_status'], official_a: f.scoreA, official_b: f.scoreB, rounds_confirmed: 0, discipline: [] as LystPublic['discipline'], server_now: new Date(now).toISOString() };
      switch (f.kind) {
        case 'ready': rows.push({ ...base, round_no: null, round_status: null, ...timer('fight', 'idle') }); break;
        case 'live': rows.push({ ...base, ...timer('fight', 'running') }); break;
        case 'paused': rows.push({ ...base, ...timer('fight', 'paused') }); break;
        case 'break': rows.push({ ...base, round_status: 'confirmed', rounds_confirmed: 1, ...timer('break', 'running') }); break;
        case 'equipment': rows.push({ ...base, ...timer('equipment', 'running') }); break;
        case 'dq_clock': rows.push({ ...base, ...timer('dq', 'running') }); break;
        case 'disqualified': rows.push({ ...base, ...timer('fight', 'running'), discipline: [{ round: 1, side: 'a', kind: 'dq', label: null, amount: 0 }] }); break;
        default: break;
      }
    }
    const at = this.nowMs();
    return { rows, sentAt: at, receivedAt: at };
  }

  async fetchFirstRounds(matchIds: string[]) {
    this.calls.firstRounds++;
    if (!this.online || this.failFirstRounds) throw new Error('network down');
    return matchIds.filter(id => this.firstRounds.has(id)).map(id => ({ match_id: id, created_at: this.firstRounds.get(id) as string }));
  }
}

export class FakeControl implements ControlSource {
  online = true;
  sessionOk = true;
  state: ControllerState = {
    event: { id: EVENT_ID, slug: 'rumble', name: 'Rumble Rehearsal', timezone: 'America/Edmonton', status: 'published' },
    control: { mode: 'auto', target_kind: null, target_field: null, music_mode: 'auto', auto_duck: true, priority_fields: [], rev: 0, updated_at: null, updated_by_label: null },
    camera: { active: false, reason: null, rev: 0 }, server_now: new Date().toISOString()
  };
  heartbeats: Array<Record<string, unknown>> = [];
  async controllerState(): Promise<ControllerState> {
    if (!this.online) throw new Error('network down');
    if (!this.sessionOk) throw Object.assign(new Error('this is not a stream controller session'), { code: '42501' });
    return JSON.parse(JSON.stringify(this.state)) as ControllerState;
  }
  async heartbeat(status: Record<string, unknown>): Promise<void> {
    if (!this.online) throw new Error('network down');
    this.heartbeats.push(status);
  }
  setCamera(active: boolean, reason: string | null = null): void { this.state.camera = { active, reason: active ? reason : null, rev: (this.state.camera.rev ?? 0) + 1 }; }
  patch(p: Partial<ControllerState['control']>): void { this.state.control = { ...this.state.control, ...p, rev: this.state.control.rev + 1 }; }
}
