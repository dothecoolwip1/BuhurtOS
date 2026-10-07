import { useEffect, useRef, useState } from 'react';
import { confirmRound, openLyst, timerCommand } from '../../data/lyst';
import type { GroupState } from '../../lib/scoring';
import { friendlyError } from '../../lib/friendlyError';
import { isNoSignalError } from '../../lib/fieldScoring';
import { CounterEvidence } from '../lyst/CountersPanel';
import { currentRound } from '../../lib/lyst/rounds';
import { presetOf, remainingMs, timerFor } from '../../lib/lyst/timer';
import { formatClock } from '../../lib/lyst/timer';
import { useLystState, useNow } from '../../lib/lyst/useLystState';

/**
 * Team fights (Pack 25): the group board keeps the marshal's call exactly as before (fighters down, rounds won, the result). This strip adds what the
 * counter phones need, through the SAME Lyst primitives as a duel: the match becomes the field's current fight (`lyst_open`, input 'standing', so the
 * phones on this Lyst bind to it), and a round is started and ended with the field clock (`lyst_timer_command`), which is what lets a phone count
 * "fighter down" only while a round is live. When the board's round is confirmed, the same call is written to the Lyst round (1 to the side that won it)
 * so the next round can open. The phones' numbers are evidence beside the board: nothing here reads them into the result.
 */
export function GroupCounterRounds({ matchId, eventId, fieldName, board }: { matchId: string; eventId: string; fieldName: string; board: GroupState }) {
  const lyst = useLystState(matchId, eventId);
  const st = lyst.state;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (!st || st.lyst || opened.current) return;
    opened.current = true;
    void openLyst(matchId, 'standing').then(() => lyst.refresh()).catch(e => setNote(friendlyError(e)));
  }, [st, matchId, lyst]);

  const rounds = st?.rounds ?? [];
  const cur = currentRound(rounds);
  const timer = timerFor(st?.timer, matchId);
  const running = timer?.status === 'running';
  const now = useNow(running);
  const leftMs = timer ? remainingMs(timer, lyst.clock.now(now)) : 0;
  const presets = st?.settings.presets ?? [];
  const confirmedOnLyst = rounds.filter(r => r.status === 'confirmed').length;
  const boardRounds = board.rounds.a + board.rounds.b;
  const names = { a: 'Red', b: 'Blue' };

  // the board's round was confirmed (one side's rounds won moved up): write the same call to the Lyst round, once, so counters can move to the next round
  const syncing = useRef(false);
  const prev = useRef(board.rounds);
  const lastWinner = useRef<'a' | 'b' | null>(null);
  useEffect(() => {
    if (board.rounds.a > prev.current.a) lastWinner.current = 'a'; else if (board.rounds.b > prev.current.b) lastWinner.current = 'b';
    prev.current = board.rounds;
  }, [board.rounds]);
  useEffect(() => {
    if (!st || syncing.current || boardRounds <= confirmedOnLyst || !cur || cur.status === 'confirmed') return;
    const winner: 'a' | 'b' = lastWinner.current ?? (board.rounds.a >= board.rounds.b ? 'a' : 'b');
    syncing.current = true;
    void confirmRound({ command: crypto.randomUUID(), matchId, round: cur.round_no, a: winner === 'a' ? 1 : 0, b: winner === 'b' ? 1 : 0, expectedRev: cur.rev })
      .then(() => lyst.refresh()).catch(() => undefined).finally(() => { syncing.current = false; });
  }, [st, boardRounds, confirmedOnLyst, cur, board.rounds.a, board.rounds.b, matchId, lyst]);

  const send = async (action: 'start' | 'break') => {
    if (!st) return;
    setBusy(true); setNote(null);
    try {
      const roundNo = action === 'start' ? (cur && cur.status !== 'confirmed' ? cur.round_no : (cur?.round_no ?? 0) + 1) : (cur?.round_no ?? 1);
      const mode = action === 'start' ? 'fight' : 'break';
      const r = await timerCommand({ eventId, field: fieldName, matchId, expectedRev: st.timer?.rev ?? 0, command: crypto.randomUUID(), action: 'start', mode, durationMs: presetOf(presets, mode).seconds * 1000, round: roundNo });
      if (r.answer.status === 'stale') setNote('Another device changed the clock. Showing the latest.');
      lyst.applyTimer(r.answer.timer, r.answer.server_now, r.sentAt, r.receivedAt);
    } catch (e) { setNote(isNoSignalError(e) ? 'No signal. The round clock was not changed.' : friendlyError(e)); void lyst.refresh(); }
    finally { setBusy(false); }
  };

  if (!st) return null;
  const live = cur?.status === 'running';
  const activeSeats = st.seats.filter(s => s.status === 'active');
  return (
    <section className="panel info gc-rounds" aria-label="Counters for this fight" data-testid="group-counter-rounds">
      <div className="gc-head">
        <b>Counters</b>
        <span className="src">{activeSeats.length === 0 ? 'No counter phone on this Lyst yet. They scan the event\'s Counter QR and pick this Lyst.' : `${activeSeats.length} counting fighters standing per side`}</span>
      </div>
      <div className="gc-clock-row">
        <span className="gc-round">{cur ? `Round ${cur.round_no}` : 'Round not started'}{cur ? ` · ${live ? 'live' : cur.status === 'confirming' ? 'ended' : 'confirmed'}` : ''}</span>
        {timer && <output className="mono gc-clock" aria-label={`Clock ${formatClock(leftMs)}`}>{formatClock(leftMs)}</output>}
        {live
          ? <button type="button" className="btn btn-line" disabled={busy || lyst.offline} onClick={() => void send('break')}>End round {cur?.round_no} for counters</button>
          : <button type="button" className="btn btn-ink" disabled={busy || lyst.offline || !!board.winner || (!!cur && cur.status === 'confirming' && boardRounds <= confirmedOnLyst)} onClick={() => void send('start')}>
              {cur && cur.status === 'confirming' ? `Round ${cur.round_no}: confirm on the board first` : `Start round ${cur && cur.status !== 'confirmed' ? cur.round_no : (cur?.round_no ?? 0) + 1} for counters`}
            </button>}
      </div>
      {note && <p className="src" role="status">{note}</p>}
      {activeSeats.length > 0 && <CounterEvidence seats={st.seats} names={names} round={cur?.round_no ?? 1} compact />}
    </section>
  );
}
