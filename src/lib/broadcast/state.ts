import type { ArenaFight, ArenaView } from '../arena';

/**
 * What the broadcast shows right now. A pure function of the SAME state the venue display already reads (matches, queue, Pack 13's official lyst state):
 * nobody operates the broadcast, and nothing here is stored. The scene is recomputed from server state on every update, so a reconnect or a refresh can
 * never leave it believing something the server does not.
 *
 *   idle          nothing to show: no fights posted, or the field is complete
 *   upcoming      the event has not started, or nothing has been fought on this field yet: the next fight is coming
 *   intro         a fight has been called to the field; no round has started and no clock is armed (fighters entering)
 *   ready         the clock is armed (set to the round length) but no round has started
 *   live          a round is being fought and the clock is running (or no clock is used)
 *   paused        a round is in progress and the clock is paused or not running
 *   break         the break clock is running, or the round has ended and the score is being confirmed, or between rounds
 *   equipment     an equipment timeout is on the clock
 *   dq_clock      a disqualification countdown is on the clock
 *   disqualified  a disqualification is on the record for this fight (until the result is official)
 *   complete      the result just became official (first seconds)
 *   winner        the result stays on screen (the display's result hold)
 *   between       the field's next fight is called; the last result has left the screen
 */
export type SceneMode = 'idle' | 'upcoming' | 'intro' | 'ready' | 'live' | 'paused' | 'break' | 'equipment' | 'dq_clock' | 'disqualified' | 'complete' | 'winner' | 'between';

/** A result is shown as "match complete" for this long, then as the winner card until the display's hold ends. */
export const COMPLETE_MS = 6_000;

export interface SceneClock { mode: string; status: 'idle' | 'running' | 'paused'; remainingMs: number; startedAt: string | null; round: number | null }
export interface Scene {
  mode: SceneMode;
  /** The fight on screen: the one being fought, or the one whose result is showing. */
  fight: ArenaFight | null;
  /** The fight to announce next (called to the field, on deck or in the hole). */
  next: ArenaFight | null;
  following: ArenaFight[];
  clock: SceneClock | null;
  round: number | null;
  /** Words for the lower third. */
  label: string;
  /** The side with a disqualification on record, if any. */
  disqualified: 'a' | 'b' | null;
  winner: { side: 'a' | 'b' | 'draw'; name: string | null } | null;
  done: number; total: number; field: string;
}

export const SCENE_LABEL: Record<SceneMode, string> = {
  idle: 'Stand by', upcoming: 'Next fight coming up', intro: 'Now on the field', ready: 'Get ready', live: 'Live', paused: 'Clock paused', break: 'Break',
  equipment: 'Equipment timeout', dq_clock: 'Disqualification countdown', disqualified: 'Disqualification', complete: 'Match complete', winner: 'Winner', between: 'Up next'
};

export function broadcastScene(view: ArenaView, ctx: { phase: 'past' | 'upcoming' | 'current'; nowMs: number }): Scene {
  const base = { following: view.upNext, done: view.done, total: view.total, field: view.field };
  const empty = (mode: SceneMode, next: ArenaFight | null): Scene => ({ mode, fight: null, next, clock: null, round: null, label: SCENE_LABEL[mode], disqualified: null, winner: null, ...base });
  const s = view.state;

  if (s.kind === 'no_matches' || s.kind === 'finished') return empty('idle', null);
  if (s.kind === 'waiting') {
    const next = s.next ?? view.onDeck ?? view.inTheHole ?? view.upNext[0] ?? null;
    if (!next) return empty('idle', null);
    // before the event, or before this field has fought anything, the next fight is "coming up"; afterwards it is the fight "up next"
    return empty(ctx.phase === 'upcoming' || view.done === 0 ? 'upcoming' : 'between', next);
  }

  if (s.kind === 'result') {
    const age = s.result.finalizedAt ? ctx.nowMs - new Date(s.result.finalizedAt).getTime() : Number.POSITIVE_INFINITY;
    const mode: SceneMode = age < COMPLETE_MS ? 'complete' : 'winner';
    const side: 'a' | 'b' | 'draw' = s.drawn ? 'draw' : s.result.a.winner ? 'a' : 'b';
    return {
      mode, fight: s.result, next: s.next ?? view.onDeck ?? view.inTheHole ?? view.upNext[0] ?? null, clock: null, round: null, label: SCENE_LABEL[mode],
      disqualified: null, winner: { side, name: s.winnerName }, ...base
    };
  }

  // a fight is on the field
  const fight = s.now;
  const l = fight.lyst;
  const next = view.onDeck ?? view.inTheHole ?? view.upNext[0] ?? null;
  const dq = l?.marks.find(m => m.kind === 'dq')?.side ?? null;
  const t = l?.timer ?? null;
  let mode: SceneMode;
  if (!l) {
    // the classic scoring board reports a running score; before that the fight has only been called
    mode = fight.live ? 'live' : 'intro';
  } else if (dq) mode = 'disqualified';
  else if (t && t.mode === 'dq' && t.status !== 'idle') mode = 'dq_clock';
  else if (t && t.mode === 'equipment' && t.status !== 'idle') mode = 'equipment';
  else if (l.roundStatus === 'confirming' || l.roundStatus === 'confirmed' || (t && (t.mode === 'break' || t.mode === 'extended_break') && t.status !== 'idle')) mode = 'break';
  else if (l.roundStatus === 'running') mode = !t || t.status === 'running' ? 'live' : 'paused';
  else mode = t && t.status === 'idle' ? 'ready' : 'intro';   // no round yet
  return {
    mode, fight, next, clock: t, round: l?.round ?? null, label: SCENE_LABEL[mode], disqualified: dq, winner: null, ...base
  };
}
