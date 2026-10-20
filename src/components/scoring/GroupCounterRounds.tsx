import { useEffect, useRef, useState } from 'react';
import { confirmRound, openLyst, returnRound, timerCommand } from '../../data/lyst';
import { TimerBar, type TimerSend } from '../lyst/TimerBar';
import { DisciplineSheet, type DisciplineDraft } from '../lyst/DisciplineSheet';
import { useOutbox } from '../../lib/useOutbox';
import { pendingGroupWinner } from '../../lib/lyst/groupRound';
import type { LystRound } from '../../lib/lyst/rounds';
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
export function GroupCounterRounds({ matchId, eventId, fieldName, board, secretary = false, names = { a: 'Red', b: 'Blue' }, onRounds, onStanding }: { matchId: string; eventId: string; fieldName: string; board: GroupState; secretary?: boolean; names?: { a: string; b: string }; onRounds: (rounds: readonly LystRound[]) => void; onStanding: (side: 'a' | 'b', count: number) => void }) {
  const lyst = useLystState(matchId, eventId);
  const st = lyst.state;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const { record, drain } = useOutbox({ eventId });
  const returnCommand = useRef<{ key: string; id: string } | null>(null);
  const opened = useRef(false);
  useEffect(() => { if (st) onRounds(st.rounds); }, [st, onRounds]);
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

  // the board's round was confirmed (one side's rounds won moved up): write the same call to the Lyst round, once, so counters can move to the next round
  const syncing = useRef(false);
  useEffect(() => {
    if (!st || syncing.current || boardRounds <= confirmedOnLyst || !cur || cur.status === 'running') return;
    const winner = pendingGroupWinner(board.rounds, rounds);
    if (!winner) { setNote('Several board rounds disagree with the recorded rounds. Ask the head marshal or organizer to enter the official result from the paper sheet.'); return; }
    syncing.current = true;
    // A stored/manual board may have confirmed the next round without running its clock. Recover exactly one known winner.
    void confirmRound({ command: crypto.randomUUID(), matchId, round: cur.status === 'confirmed' ? cur.round_no + 1 : cur.round_no, a: winner === 'a' ? 1 : 0, b: winner === 'b' ? 1 : 0, expectedRev: cur.status === 'confirmed' ? 0 : cur.rev })
      .then(() => lyst.refresh()).catch(e => setNote(friendlyError(e, 'Could not confirm the round for the counter phones.'))).finally(() => { syncing.current = false; });
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
  const clockCommand: TimerSend = (action, o = {}) => {
    if (busy) return;
    setBusy(true); setNote(null);
    void timerCommand({ eventId, field: fieldName, matchId, expectedRev: st.timer?.rev ?? 0, command: crypto.randomUUID(), action, ...o })
      .then(({ answer }) => { if (answer.status === 'stale') setNote('The clock changed on another device. Check it before trying again.'); return lyst.refresh(); })
      .catch(e => setNote(friendlyError(e))).finally(() => setBusy(false));
  };
  const recordCall = async (d: DisciplineDraft) => {
    if (busy || !cur) return;
    setBusy(true); setNote(null);
    try {
      const id = await record('lyst.discipline', matchId, { matchId, round: cur.round_no, side: d.side, kind: d.kind, label: d.label, amount: d.amount, reason: d.reason, calledBy: d.calledBy, related: null });
      if (!id) throw new Error('Sign in again to record the call.');
      if (d.ruleId) await record('lyst.cite_rule', matchId, { disciplineId: id, provisionId: d.ruleId });
      if (d.kind === 'card' && d.alsoDeduct > 0) await record('lyst.discipline', matchId, { matchId, round: cur.round_no, side: d.side, kind: 'deduction', label: null, amount: d.alsoDeduct, reason: d.reason ?? 'With the card', calledBy: d.calledBy, related: id });
      setCallOpen(false);
      const sent = await drain(matchId);
      if (!sent.clear || sent.rejected.length > 0) setNote('The marshal’s call is saved on this device and is not yet official. Keep the paper record and check the connection.');
      await lyst.refresh();
    } catch (e) { setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const live = cur?.status === 'running';
  const activeSeats = st.seats.filter(s => s.status === 'active');
  const submitted = st.seats.flatMap(seat => {
    const tally = seat.tallies.find(t => t.round_no === cur?.round_no && t.submitted);
    if (seat.role !== 'official' || !seat.side || !tally) return [];
    const size = st.per_side ?? board.down[seat.side].length;
    return [{ seat, standing: Math.max(0, Math.min(size, size - tally.total)) }];
  });
  return (
    <section className="panel info gc-rounds" aria-label={secretary ? 'Clock and marshal calls' : 'Counters for this fight'} data-testid="group-counter-rounds">
      <div className="gc-head">
        <b>{secretary ? 'Clock & marshal calls' : 'Counters'}</b>
        {!secretary && <span className="src">{activeSeats.length === 0 ? 'No counter phone on this Lyst yet. They scan the event\'s Counter QR and pick this Lyst.' : `${activeSeats.length} counting fighters standing per side`}</span>}
      </div>
      {secretary && <>
        <TimerBar timer={timer} leftMs={leftMs} roundNo={cur?.round_no ?? 1} presets={presets} busy={busy} offline={lyst.offline} note={null} onSend={clockCommand} startHere={false} />
        <button type="button" className="btn btn-line" disabled={busy || !cur} onClick={() => setCallOpen(true)}>Marshal's call</button>
      </>}
      <div className="gc-clock-row">
        <span className="gc-round">{cur ? `Round ${cur.round_no}` : 'Round not started'}{cur ? ` · ${live ? 'live' : cur.status === 'confirming' ? 'ended' : 'confirmed'}` : ''}</span>
        {timer && !secretary && <output className="mono gc-clock" aria-label={`Clock ${formatClock(leftMs)}`}>{formatClock(leftMs)}</output>}
        {live
          ? <button type="button" className="btn btn-line" disabled={busy || lyst.offline} onClick={() => void send('break')}>End round {cur?.round_no}{secretary ? '' : ' for counters'}</button>
          : <button type="button" className="btn btn-ink" disabled={busy || lyst.offline || !!board.winner || (!!cur && cur.status === 'confirming' && boardRounds <= confirmedOnLyst)} onClick={() => void send('start')}>
              {cur && cur.status === 'confirming' ? `Round ${cur.round_no}: confirm on the board first` : `Start round ${cur && cur.status !== 'confirmed' ? cur.round_no : (cur?.round_no ?? 0) + 1}${secretary ? '' : ' for counters'}`}
            </button>}
      </div>
      {note && <p className="src" role="status">{note}</p>}
      {secretary && <section className="gc-submitted" aria-label="Submitted standing counts">
        <b>Submitted standing counts</b>
        {submitted.length === 0 ? <p className="src">None submitted yet. You can enter the marshal's count.</p> : <ul className="ly-list">{submitted.map(({ seat, standing }) => <li key={seat.id}>
          <span>{names[seat.side!]} · {seat.name}: <b>{standing} standing</b> · submitted</span>
          <button type="button" className="btn btn-line" disabled={busy || !!board.winner || cur?.status !== 'confirming' || board.round !== cur.round_no} onClick={() => onStanding(seat.side!, standing)}>Use {standing} standing for {names[seat.side!]}</button>
        </li>)}</ul>}
      </section>}
      {!secretary && activeSeats.length > 0 && <CounterEvidence seats={st.seats} names={names} round={cur?.round_no ?? 1} compact />}
      {secretary && cur?.status === 'confirming' && <details><summary className="btn btn-line">Return for recount</summary><label>Reason<input value={returnReason} onChange={e => setReturnReason(e.target.value)} maxLength={200} /></label><button type="button" className="btn btn-line" disabled={busy || lyst.offline || returnReason.trim().length < 3} onClick={() => {
        const key = `${matchId}:${cur.round_no}:${cur.rev}:${returnReason.trim()}`;
        if (returnCommand.current?.key !== key) returnCommand.current = { key, id: crypto.randomUUID() };
        setBusy(true); void returnRound({ command: returnCommand.current.id, matchId, round: cur.round_no, expectedRev: cur.rev, reason: returnReason })
          .then(r => { if (r.status === 'stale') setNote('The round changed on another device. Check its latest state.'); return lyst.refresh(); }).catch(e => setNote(friendlyError(e))).finally(() => setBusy(false));
      }}>Return scores to counters</button></details>}
      {callOpen && cur && <DisciplineSheet names={names} round={cur.round_no} settings={st.settings} calledByDefault="" busy={busy} onClose={() => setCallOpen(false)} onRecord={d => void recordCall(d)} />}
    </section>
  );
}
