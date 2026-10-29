import { useEffect, useRef, useState } from 'react';
import { openLyst, returnRound } from '../../data/lyst';
import { TimerBar } from '../lyst/TimerBar';
import { DisciplineSheet, type DisciplineDraft } from '../lyst/DisciplineSheet';
import { ClockRecovery } from '../lyst/ClockRecovery';
import { CounterDeliveryPanel } from '../lyst/CounterDeliveryPanel';
import { useOutbox } from '../../lib/useOutbox';
import { pendingGroupWinner } from '../../lib/lyst/groupRound';
import type { LystRound } from '../../lib/lyst/rounds';
import type { GroupState } from '../../lib/scoring';
import { friendlyError } from '../../lib/friendlyError';
import { CounterEvidence } from '../lyst/CountersPanel';
import { Dialog } from '../Dialog';
import { currentRound } from '../../lib/lyst/rounds';
import { presetOf, remainingMs, timerFor } from '../../lib/lyst/timer';
import { formatClock } from '../../lib/lyst/timer';
import { useLystState, useNow } from '../../lib/lyst/useLystState';
import { useReliableTimer } from '../../lib/lyst/useReliableTimer';
import { counterReviewReason } from '../../lib/lyst/delivery';
import { mergeSides } from '../../lib/lyst/counters';

/** Which board round this device already queued for the Lyst, so a reload or a poll never queues a second confirmation with a new id. */
type QueuedConfirm = { key: string; id: string };
const queuedKey = (user: string, match: string) => `bos-group-lyst-confirm:v1:${user}:${match}`;
function readQueued(user: string, match: string): QueuedConfirm | null {
  try { const v = JSON.parse(localStorage.getItem(queuedKey(user, match)) ?? 'null') as QueuedConfirm | null; return v && typeof v.key === 'string' && typeof v.id === 'string' ? v : null; } catch { return null; }
}
function writeQueued(user: string, match: string, v: QueuedConfirm) {
  try { localStorage.setItem(queuedKey(user, match), JSON.stringify(v)); } catch { /* the in-memory copy still prevents repeats on this screen */ }
}

/**
 * Team fights (Pack 25): the group board keeps the marshal's call exactly as before (fighters down, rounds won, the result). This strip adds what the
 * counter phones need, through the SAME Lyst primitives as a duel: the match becomes the field's current fight (`lyst_open`, input 'standing', so the
 * phones on this Lyst bind to it), and a round is started and ended with the field clock through the shared reliable clock controller (one saved
 * command per action, retried with the same id). When the board's round is confirmed, the same call is written to the Lyst round (1 to the side that
 * won it) through the scoring outbox so the next round can open; if the counter evidence is not confirmed the marshal records a reason first.
 * The phones' numbers are evidence beside the board: nothing here reads them into the result.
 */
export function GroupCounterRounds({ matchId, eventId, fieldName, userKey, board, secretary = false, names = { a: 'Red', b: 'Blue' }, onRounds, onStanding }: { matchId: string; eventId: string; fieldName: string; userKey: string; board: GroupState; secretary?: boolean; names?: { a: string; b: string }; onRounds: (rounds: readonly LystRound[]) => void; onStanding: (side: 'a' | 'b', count: number) => void }) {
  const lyst = useLystState(matchId, eventId);
  const st = lyst.state;
  const clock = useReliableTimer({ lyst, eventId, fieldName, matchId, userKey });
  const [dismissedReason,setDismissedReason]=useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const { record, drain, rejected } = useOutbox({ eventId });
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

  // ---------------------------------------------------------------- board round -> Lyst round
  // The board's round was confirmed (one side's rounds won moved up). A stored/manual board may have confirmed the next round without running its
  // clock: recover exactly one known winner. Never while the Lyst round is still running.
  const syncNeeded = !!st && !!cur && cur.status !== 'running' && boardRounds > confirmedOnLyst;
  const winner = syncNeeded ? pendingGroupWinner(board.rounds, rounds) : null;
  const target = syncNeeded && winner && cur
    ? { round: cur.status === 'confirmed' ? cur.round_no + 1 : cur.round_no, expectedRev: cur.status === 'confirmed' ? 0 : cur.rev, winner }
    : null;
  const targetKey = target ? `${matchId}:${target.round}` : null;
  const reviewMessage = st && target ? counterReviewReason(st, target.round) : null;
  const [queued, setQueued] = useState<QueuedConfirm | null>(() => readQueued(userKey, matchId));
  useEffect(() => { setQueued(readQueued(userKey, matchId)); }, [userKey, matchId]);
  const queuedRefused = queued ? rejected.find(e => e.id === queued.id) : undefined;
  // The marshal's reason is tied to this exact match and round: typing is a draft; only the explicit button makes it the reason that is sent.
  const [reasonDraft, setReasonDraft] = useState('');
  const [reasonOk, setReasonOk] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => { setReasonDraft(''); setReasonOk(null); }, [targetKey]);
  const confirmedReason = reasonOk && reasonOk.key === targetKey ? reasonOk.text : null;
  const sendKey = target ? `${targetKey}:${target.expectedRev}:${target.winner}:${confirmedReason ?? ''}` : null;
  const alreadyQueued = !!queued && queued.key === sendKey && !queuedRefused;
  const needReason = !!target && !confirmedReason && (!!reviewMessage || (!!queuedRefused && queued?.key.startsWith(`${targetKey}:`)));
  const syncing = useRef(false);
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (syncNeeded && !winner) setNote('Several board rounds disagree with the recorded rounds. Ask the head marshal or organizer to enter the official result from the paper sheet.');
  }, [syncNeeded, winner]);
  useEffect(() => {
    if (!target || !sendKey || needReason || attempted.current.has(sendKey) || syncing.current) return;
    syncing.current = true;
    attempted.current.add(sendKey);
    const t = target; const key = sendKey; const reason = confirmedReason;
    void (async () => {
      try {
        // Save the ID before enqueueing. Reloads on either side of the await
        // reuse it, including if enqueue saved but its acknowledgement was lost.
        const q=queued?.key===key?queued:{key,id:crypto.randomUUID()};
        writeQueued(userKey,matchId,q);setQueued(q);
        const id = await record('lyst.confirm_round', matchId, { matchId, round: t.round, a: t.winner === 'a' ? 1 : 0, b: t.winner === 'b' ? 1 : 0, expectedRev: t.expectedRev, recommendedA: null, recommendedB: null, reason },q.id);
        if (!id) { setNote('Sign in again to confirm the round for the counter phones.'); return; }
        const r = await drain(matchId);
        const refused = r.rejected.find(e => e.id === id);
        if (refused) { setReasonOk(null); setNote(`The round was not confirmed for the counter phones: ${refused.error ?? 'refused'}`); }
        else if (!r.clear) setNote('The round confirmation is saved on this device and is sent when the connection is back.');
        await lyst.refresh();
      } catch (e) { attempted.current.delete(key);setNote(friendlyError(e, 'Could not confirm the round for the counter phones. Keep the paper record and retry.')); }
      finally { syncing.current = false; }
    })();
  }, [target, sendKey, needReason, alreadyQueued, confirmedReason, record, drain, matchId, userKey, lyst]);

  // ---------------------------------------------------------------- the clock: the shared reliable controller only
  const clockBusy = busy || clock.timerBusy || !!clock.pendingTimer;
  const send = (action: 'start' | 'break') => {
    if (!st) return;
    setNote(null);
    const roundNo = action === 'start' ? (cur && cur.status !== 'confirmed' ? cur.round_no : (cur?.round_no ?? 0) + 1) : (cur?.round_no ?? 1);
    const mode = action === 'start' ? 'fight' : 'break';
    clock.sendTimer('start', { mode, durationMs: presetOf(presets, mode).seconds * 1000, round: roundNo });
  };

  if (!st) return null;
  const sides = mergeSides(st.settings.sides);
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
    if (seat.role !== 'official' || (seat.side !== 'a' && seat.side !== 'b') || !tally) return [];
    const size = st.per_side ?? board.down[seat.side].length;
    return [{ seat, side: seat.side, standing: Math.max(0, Math.min(size, size - tally.total)) }];
  });
  const shownNote = note ?? clock.timerNote;
  return (
    <section className="panel info gc-rounds" aria-label={secretary ? 'Clock and marshal calls' : 'Counters for this fight'} data-testid="group-counter-rounds">
      <div className="gc-head">
        <b>{secretary ? 'Clock & marshal calls' : 'Counters'}</b>
        {!secretary && <span className="src">{activeSeats.length === 0 ? 'No counter phone on this Lyst yet. They scan the event\'s Counter QR and pick this Lyst.' : `${activeSeats.length} counting fighters standing per side`}</span>}
      </div>
      {secretary && <>
        <TimerBar timer={timer} leftMs={leftMs} roundNo={cur?.round_no ?? 1} presets={presets} busy={clockBusy} offline={lyst.offline} note={null} onSend={clock.sendTimer} startHere={false} />
        <button type="button" className="btn btn-line" disabled={busy || !cur} onClick={() => setCallOpen(true)}>Marshal's call</button>
      </>}
      <ClockRecovery clock={clock} suspended={callOpen} />
      <div className="gc-clock-row">
        <span className="gc-round">{cur ? `Round ${cur.round_no}` : 'Round not started'}{cur ? ` · ${live ? 'live' : cur.status === 'confirming' ? 'ended' : 'confirmed'}` : ''}</span>
        {timer && !secretary && <output className="mono gc-clock" aria-label={`Clock ${formatClock(leftMs)}`}>{formatClock(leftMs)}</output>}
        {live
          ? <button type="button" className="btn btn-line" disabled={clockBusy || lyst.offline} onClick={() => send('break')}>End round {cur?.round_no}{secretary ? '' : ' for counters'}</button>
          : <button type="button" className="btn btn-ink" disabled={clockBusy || lyst.offline || !!board.winner || (!!cur && cur.status === 'confirming' && boardRounds <= confirmedOnLyst) || !!target} onClick={() => send('start')}>
              {target ? `Round ${target.round}: ${needReason ? 'reason needed below' : 'sending the board call'}` : cur && cur.status === 'confirming' ? `Round ${cur.round_no}: confirm on the board first` : `Start round ${cur && cur.status !== 'confirmed' ? cur.round_no : (cur?.round_no ?? 0) + 1}${secretary ? '' : ' for counters'}`}
            </button>}
      </div>
      {target && needReason && (
        dismissedReason!==targetKey&&!clock.clockFailure&&!clock.clockOverride&&!clock.pendingTimer&&!clock.requiresClockCheck&&clock.restoreRound===null?<Dialog title={`Round ${target.round} · confirm the marshal’s reason`} onClose={()=>setDismissedReason(targetKey)}>
          <b>Round {target.round}: the marshal’s reason is needed</b>
          <p>{reviewMessage ?? queuedRefused?.error ?? 'The round was not confirmed for the counter phones.'} The board call ({names[target.winner]} wins round {target.round}) is sent only after you confirm the reason.</p>
          <label className="field-in">Marshal’s reason
            <input value={reasonDraft} maxLength={1000} onChange={e => setReasonDraft(e.target.value)} />
          </label>
          <button type="button" className="btn btn-ink" disabled={reasonDraft.trim().length < 3 || lyst.offline} onClick={() => { if (targetKey) setReasonOk({ key: targetKey, text: reasonDraft.trim() }); }}>
            Confirm reason and send round {target.round}
          </button>
          <button type="button" className="btn btn-line" onClick={()=>setDismissedReason(targetKey)}>Back to the board</button>
        </Dialog>:<button type="button" className="btn btn-win" onClick={()=>setDismissedReason(null)}>Round {target.round} · enter marshal’s reason</button>
      )}
      {target && alreadyQueued && <p className="src" role="status">Round {target.round} is saved on this device for the counter phones and is being sent.</p>}
      {shownNote && <p className="src" role="status">{shownNote}</p>}
      <CounterDeliveryPanel state={st} sides={sides} onChanged={() => void lyst.refresh()} />
      {secretary && <section className="gc-submitted" aria-label="Submitted standing counts">
        <b>Submitted standing counts</b>
        {submitted.length === 0 ? <p className="src">None submitted yet. You can enter the marshal's count.</p> : <ul className="ly-list">{submitted.map(({ seat, side, standing }) => <li key={seat.id}>
          <span>{names[side]} · {seat.name}: <b>{standing} standing</b> · submitted</span>
          <button type="button" className="btn btn-line" disabled={busy || !!board.winner || cur?.status !== 'confirming' || board.round !== cur.round_no} onClick={() => onStanding(side, standing)}>Use {standing} standing for {names[side]}</button>
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
