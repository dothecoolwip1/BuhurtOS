import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../Dialog';
import { StatusBanner } from '../scoring/ScoringScreen';
import { TimerBar } from './TimerBar';
import { ClockRecovery } from './ClockRecovery';
import { CounterDeliveryPanel } from './CounterDeliveryPanel';
import { LogPanel } from './LogPanel';
import { RulesSheet } from '../rules/RulesSheet';
import { counterReviewReason } from '../../lib/lyst/delivery';
import { useReliableTimer } from '../../lib/lyst/useReliableTimer';
import { useLystState, useNow } from '../../lib/lyst/useLystState';
import { openLyst, outranceAppeal, outranceAppealDecide, outranceClearHold, outranceFinish, returnRound, setProfightFormat,
  type LystState, type OutranceCall, type OutranceFinishBasis, type OutranceSheet, type OutranceState } from '../../data/lyst';
import { sideLabel } from '../../lib/entryLabel';
import { isNoSignalError } from '../../lib/fieldScoring';
import { fieldLabel } from '../../lib/eventDay';
import { friendlyError } from '../../lib/friendlyError';
import { scoringGuard } from '../../lib/swUpdate';
import { useOutbox } from '../../lib/useOutbox';
import { trackEvent } from '../../lib/analytics';
import { mergeSides, sideVars } from '../../lib/lyst/counters';
import { clearFinalCommand, loadFinalCommand, saveFinalCommand } from '../../lib/lyst/finalizeStore';
import { activeDiscipline, currentRound, describeDiscipline, type LystDiscipline, type LystRound } from '../../lib/lyst/rounds';
import { presetOf, remainingMs, timerFor } from '../../lib/lyst/timer';
import { BAND_LABEL, CRITERION_LABEL, WIN_TYPE_LABEL, roundScoreUnits, showScore, wholeScore, type Division, type FightFormat } from '../../lib/outrance';
import type { LystScoringProps } from './LystScoring';

type Phase = 'scoring' | 'finishing' | 'official' | 'pending' | 'review';
type Sheet = null | 'calls' | 'log' | 'rules' | 'phones' | 'appeals';
const CALLED_BY_KEY = 'bos-lyst-called-by';
const readCalledBy = () => { try { return localStorage.getItem(CALLED_BY_KEY) ?? ''; } catch { return ''; } };
const clockText = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const sideName = (m: { entryA: string | null; entryB: string | null; nameA: string | null; nameB: string | null }) => ({ a: sideLabel(m.entryA, m.nameA, 'Side A'), b: sideLabel(m.entryB, m.nameB, 'Side B') });

/** The calls that END the fight, with the words on the finish button (§14, §5.2, §6.2). */
const STOPPAGE: Record<string, { basis: OutranceFinishBasis; word: string }> = {
  ko: { basis: 'ko', word: 'by KO' }, tko: { basis: 'tko', word: 'by TKO (lack of defence)' }, tko_equipment: { basis: 'tko_equipment', word: 'by TKO (armour/weapon failure)' },
  tko_stalling: { basis: 'tko_stalling', word: 'by TKO (stalling)' }, tko_corner: { basis: 'tko_corner', word: 'by TKO (corner stoppage)' },
  yield: { basis: 'yield', word: 'by the opponent yielding' }, medical: { basis: 'medical', word: 'by medical retirement' }
};
const HOLD_WORD: Record<string, string> = {
  medic_check: 'needs the medic\'s check before fighting again (Outrance §14.8)', assessment: 'needs the medic\'s and head marshal\'s assessment (§5.2, §6.2)',
  equipment: 'must show fixed equipment before the next fight (§14.10)', knocked_out: 'lost by KO: no further part in the tournament (§14.11). Withdraw the entry.'
};

/**
 * The Lyst tablet for a Profight, exactly to Outrance Rules and Regulations V.26.4. The SECRETARY (§2.5) sees the line marshals' sheets come in
 * (3 or 5, §15.1.1), confirms the round: the Round Score is the average of the sheets (§15.3.1). The KNIGHT MARSHAL's calls (§13, §14) are one tap
 * each. The Total Fight Score declares the winner (§15.4.1); the win type comes from the marshals' own results (§15.4.2). Nothing here computes a
 * score the server does not: it shows the server's sheets and totals; the only arithmetic is the preview of a round being confirmed.
 */
export function OutranceScoring({ opened, eventId, userId, fieldName, nextFight, backHref, onExit, onFinished, onOfficial, onOpenNext, onStale, canResolve, onClassic, secretary = false }: LystScoringProps) {
  const { match, comp } = opened;
  const names = sideName(match);
  const lyst = useLystState(match.id, eventId);
  const st = lyst.state;
  const om = st?.outrance ?? null;
  const timing = om?.timing ?? null;
  const sides = mergeSides(st?.settings?.sides);
  const { waiting, record, drain, rejected, discardRejected, retryRejected } = useOutbox({ eventId });
  const mine = rejected.filter(e => e.subject === match.id);
  const [phase, setPhase] = useState<Phase>('scoring');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState<{ result: 'a' | 'b' | 'draw'; how: string } | null>(null);
  const [calledBy, setCalledBy] = useState(readCalledBy);
  const commandId = useRef<string | undefined>(undefined);
  const clock = useReliableTimer({ lyst, eventId, fieldName, matchId: match.id, userKey: userId });
  const { timerBusy, timerNote, sendTimer } = clock;

  useEffect(() => { scoringGuard.enter(); return () => scoringGuard.leave(); }, []);
  useEffect(() => { let live = true; void loadFinalCommand(userId, match.id).then(f => { if (live && f) { commandId.current = f.commandId; if (f.review === 'conflict') setPhase('review'); } }); return () => { live = false; }; }, [userId, match.id]);
  // Open this fight on the Lyst (idempotent on the server); a Profight without its division and format asks for them first (§1.3, §4)
  const openedOnce = useRef(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [openTick, setOpenTick] = useState(0);
  useEffect(() => {
    if (!st || (st.lyst && om) || openedOnce.current) return;
    openedOnce.current = true;
    void openLyst(match.id, 'simple').then(() => { setNeedsSetup(false); return lyst.refresh(); })
      .catch(e => { if (/division .*format/i.test((e as { message?: string } | null)?.message ?? '')) setNeedsSetup(true); else setError(friendlyError(e)); });
  }, [st, om, match.id, lyst, openTick]);

  const rounds = useMemo<LystRound[]>(() => st?.rounds ?? [], [st?.rounds]);
  const cur = currentRound(rounds);
  const discipline = st?.discipline ?? [];
  const timer = timerFor(st?.timer, match.id);
  const running = timer?.status === 'running';
  const now = useNow(running);
  const presets = st?.settings?.presets ?? [];
  const leftMs = timer ? remainingMs(timer, lyst.clock.now(now)) : (timing?.round_seconds ?? presetOf(presets, 'fight').seconds) * 1000;
  const totals = om?.totals ?? null;
  const nextNo = (cur?.round_no ?? 0) + 1;

  const send = async () => { const r = await drain(match.id); await lyst.refresh(); return r; };
  const startRound = (n: number) => timing && sendTimer('start', { mode: 'fight', round: n, durationMs: timing.round_seconds * 1000 });
  const endRound = () => timing && sendTimer('start', { mode: 'break', round: cur?.round_no ?? 1, durationMs: timing.break_seconds * 1000 });

  /* ---------------- the knight marshal's calls (§13, §14): one tap each, through the outbox ---------------- */
  const call = async (side: 'a' | 'b', c: OutranceCall, why: string | null = null) => {
    setBusy(true); setError(null);
    try {
      try { localStorage.setItem(CALLED_BY_KEY, calledBy); } catch { /* ignore */ }
      const id = await record('lyst.outrance_call', match.id, { matchId: match.id, round: cur?.round_no ?? 1, side, call: c, reason: why, calledBy: calledBy || null });
      if (!id) { setError('Sign in again to score.'); return; }
      trackEvent('outrance_call', { call: c });
      if (c === 'armour') sendTimer('start', { mode: 'equipment', round: cur?.round_no ?? 1, durationMs: 90_000 });   // §14.4: 90 s for the repair
      setSheet(null);
      await send();
    } catch (e) { setError(friendlyError(e, 'Could not record that call. It is kept on this device; try again.')); } finally { setBusy(false); }
  };
  const voidIt = async (id: string, why: string) => { setBusy(true); setError(null); try { await record('lyst.void', match.id, { id, reason: why }); await send(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); } };

  /* ---------------- the secretary confirms the round (§15.3.1) ---------------- */
  const confirm = async (round: LystRound, short: boolean) => {
    setBusy(true); setError(null);
    try {
      const id = await record('lyst.outrance_confirm', match.id, { matchId: match.id, round: round.round_no, expectedRev: round.rev, reason: reason.trim() || null, short });
      if (!id) { setError('Sign in again to score.'); return; }
      trackEvent('outrance_round_confirmed', { round: round.round_no, short });
      setReason('');
      await send();
    } catch (e) { setError(friendlyError(e, 'Could not confirm the round. It is kept on this device.')); } finally { setBusy(false); }
  };
  const recount = async (round: LystRound) => {
    if (reason.trim().length < 3) { setError('Say why the round goes back to the line marshals.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await returnRound({ command: crypto.randomUUID(), matchId: match.id, round: round.round_no, expectedRev: round.rev, reason: reason.trim() });
      if (r.status === 'stale') setError('This round changed on another device. Check it again.');
      setReason(''); await lyst.refresh();
    } catch (e) { setError(friendlyError(e, 'Could not return the round. Check your connection.')); } finally { setBusy(false); }
  };

  /* ---------------- finishing (§15.4) ---------------- */
  const finish = async (basis: OutranceFinishBasis, result: 'a' | 'b' | 'draw', how: string, why: string | null = null) => {
    if (!st) return;
    setBusy(true); setError(null);
    try {
      const sent = await drain(match.id);
      if (!sent.clear) { setError(`${sent.remaining} action${sent.remaining === 1 ? ' is' : 's are'} still waiting to send, so the result cannot be made official yet. Nothing is lost.`); return; }
      if (!commandId.current) { commandId.current = crypto.randomUUID(); await saveFinalCommand(userId, match.id, commandId.current); }
      let r;
      try { r = await outranceFinish({ command: commandId.current, matchId: match.id, expectedVersion: st.match.version, basis, result, reason: why }); }
      catch (e) { if (isNoSignalError(e)) { setPhase('pending'); return; } throw e; }
      if (r.status === 'accepted' || r.status === 'duplicate') {
        await clearFinalCommand(userId, match.id); await discardRejected(match.id);
        setSaved({ result, how }); trackEvent('result_official', { outcome: r.status, via: 'outrance', basis });
        setPhase('official'); onOfficial();
      } else if (r.status === 'conflict') { await saveFinalCommand(userId, match.id, commandId.current, 'conflict'); setPhase('review'); }
      else { await clearFinalCommand(userId, match.id); onStale('This fight changed after you opened it. Your result was sent to the head marshal for review and nothing was made official.'); }
    } catch (e) { setError(friendlyError(e, 'Could not save the result. Your scoring is kept; try again.')); } finally { setBusy(false); }
  };
  const goNext = async (m: NonNullable<LystScoringProps['nextFight']>) => { try { await openLyst(m.id, 'simple'); } catch { /* the field screen opens it again */ } onOpenNext(m); };

  const context = <><h1 className="sr-only">{names.a} vs {names.b}</h1><p className="sk-ctx"><b>{fieldLabel(fieldName)}</b> · {comp.name} · {match.roundLabel || match.stage}{timing ? ` · Division ${timing.division} · ${timing.format === 'matched' ? 'matched fight' : 'tournament'}` : ''}</p></>;

  if (phase === 'official' && saved) {
    const nn = nextFight ? sideName(nextFight) : null;
    return (
      <section className="panel sk-done" aria-label="Result official">
        {context}<StatusBanner status="official" />
        <p className="sk-winner">{saved.result === 'draw' ? <b>Draw</b> : <>Winner: <b>{names[saved.result]}</b> {saved.how}</>}</p>
        {totals && <p className="mono om-total-line">{names.a} {showScore(totals.a)} – {showScore(totals.b)} {names.b}</p>}
        <div className="sk-after">
          {nextFight && nn && <button type="button" className="btn btn-ink fq-big" onClick={() => void goNext(nextFight)}><span className="sk-after-k">Next fight on {fieldLabel(fieldName)}</span><span>{nn.a} vs {nn.b}</span></button>}
          {backHref && <Link className="btn btn-line fq-big" to={backHref.to}>{backHref.label}</Link>}
          <button type="button" className="btn btn-line fq-big" onClick={onFinished}>Back to the queue</button>
        </div>
        <AppealsBlock om={om} names={names} matchId={match.id} canResolve={canResolve} onChanged={() => void lyst.refresh()} final />
      </section>
    );
  }
  if (phase === 'pending' || phase === 'review') {
    return (
      <section className="panel sk-done" aria-label={phase === 'pending' ? 'Result pending' : 'Result needs review'}>
        {context}<StatusBanner status={phase} />
        {phase === 'pending'
          ? <><p>The result has not reached the server. Everything is saved on this device. Write it on the paper sheet too.</p><button type="button" className="btn btn-ink fq-big" onClick={() => setPhase('finishing')}>Try again</button></>
          : <><p>Another device saved a different result first. Yours was kept, not discarded. Tell the head marshal.</p><button type="button" className="btn btn-ink fq-big" onClick={async () => { await clearFinalCommand(userId, match.id); onFinished(); }}>I have told the head marshal</button></>}
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button>
      </section>
    );
  }

  /* ---------------- set up (§1.3, §4) ---------------- */
  if (needsSetup) {
    return (
      <section className="panel sk-done" aria-label="Set up the Profight">
        {context}
        <h2 className="sk-h">Set this Profight's division and format</h2>
        <p>The rounds, their length and the break come from the Outrance rules (§4): Division 1 rounds are 2:00, Division 2 rounds 1:30. Tournament fights are 2 rounds (a 3rd if level) with a 45 s break; matched fights are 3 rounds with 60 s breaks.</p>
        {canResolve ? <FormatForm competitionId={comp.id} onSaved={() => { openedOnce.current = false; setNeedsSetup(false); setOpenTick(n => n + 1); }} /> : <p className="ly-note">Ask the head marshal or an organizer to set it.</p>}
        {error && <p role="alert" className="ly-error">{error}</p>}
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button>
      </section>
    );
  }

  const zone: 'loading' | 'start' | 'fighting' | 'confirm' | 'between' = !st || !om ? 'loading' : !cur ? 'start' : cur.status === 'running' ? 'fighting' : cur.status === 'confirming' ? 'confirm' : 'between';
  const marshalSeats = (st?.seats ?? []).filter(s => s.side === 'm' && s.role === 'official' && s.status === 'active');
  const roundSheets = (om?.sheets ?? []).filter(s => cur && s.round_no === cur.round_no && s.role === 'official');
  const missing = marshalSeats.filter(s => !roundSheets.some(x => x.seat_id === s.id));
  const preview = roundSheets.length >= 1 && roundSheets.length <= 6 ? roundScoreUnits(roundSheets.map(s => s.score)) : null;
  const rulesCount = roundSheets.length === 3 || roundSheets.length === 5;
  const mOnly: LystState | null = st ? { ...st, seats: st.seats.filter(s => s.side === 'm') } : null;
  const deliveryReason = mOnly && cur ? counterReviewReason(mOnly, cur.round_no) : null;
  const canConfirm = !!cur && rulesCount && missing.length === 0 && (!deliveryReason || reason.trim().length >= 3) && !busy && waiting === 0;
  const stoppages = activeDiscipline(discipline).filter(d => d.kind === 'stoppage' && d.key && STOPPAGE[d.key]);
  const dq = (['a', 'b'] as const).filter(s => activeDiscipline(discipline).some(d => d.kind === 'dq' && d.side === s));
  const marks = (s: 'a' | 'b') => {
    const a = activeDiscipline(discipline).filter(d => d.side === s);
    return { w: a.filter(d => d.kind === 'warning').length, y: a.filter(d => d.kind === 'card' && d.key === 'yellow').length, ar: a.filter(d => d.kind === 'armour').length, dq: a.some(d => d.kind === 'dq') };
  };
  const clockNeedsDecision = !!clock.clockFailure || !!clock.clockOverride || clock.requiresClockCheck || clock.restoreRound !== null || !!clock.pendingTimer;

  return (
    <div className="sk field-run ly ly-control-room om-tablet" style={sideVars(sides) as React.CSSProperties}>
      {context}
      <StatusBanner status={waiting > 0 ? 'pending' : 'scoring'} line={waiting > 0 ? 'Pending: NOT official until the server has it' : 'Profight · Outrance Rules V.26.4 · not official until you finish the fight'} />
      {lyst.offline && <p className="ly-note" role="alert">No signal. What you see is the last thing the server told us; the clock keeps running on the server.</p>}
      {(om?.holds ?? []).map(h => <HoldLine key={h.id} hold={h} name={names[h.side]} canClear={canResolve && h.kind !== 'knocked_out'} onCleared={() => void lyst.refresh()} />)}

      <div className="ly-workspace">
        <div className="ly-score-panel">
          <section className="sk-score ly-score" aria-label="Total Fight Score">
            {(['a', 'mid', 'b'] as const).map(k => k === 'mid'
              ? <div key="mid" className="sk-mid"><span className="sk-vs">vs</span><span className="sk-phase">{!totals || totals.rounds === 0 ? 'No round confirmed' : `After ${totals.rounds} round${totals.rounds === 1 ? '' : 's'}`}</span><span className="sk-unit">Total Fight Score</span></div>
              : (
                <div key={k} className={`sk-side ${k}${totals?.leader === k ? ' lead' : ''}`}>
                  <span className="sk-tag">{sides[k].name}</span>
                  <span className="sk-name">{names[k]}</span>
                  <span className="sk-num" data-testid={`om-total-${k}`}>{totals ? showScore(totals[k]) : 0}</span>
                  {(() => { const m = marks(k); return (m.w || m.y || m.ar || m.dq) ? <span className="ly-marks">{m.w > 0 && <b className="ly-mark">W{m.w}</b>}{m.y > 0 && <b className="ly-mark is-card">Y{m.y}</b>}{m.ar > 0 && <b className="ly-mark is-ded">A{m.ar}</b>}{m.dq && <b className="ly-mark is-dq">DQ</b>}</span> : null; })()}
                </div>
              ))}
          </section>
          {(om?.rounds.length ?? 0) > 0 && (
            <ul className="ly-rounds" aria-label="Round Scores">
              {om!.rounds.map(r => <li key={r.round_no} className="ly-round is-confirmed"><span className="ly-round-n">R{r.round_no}</span><span className="ly-round-s mono">{showScore(r.a)}–{showScore(r.b)}</span><span className="ly-round-w">{r.marshals} marshals{r.short ? ' · not 3 or 5' : ''}</span></li>)}
            </ul>
          )}
          {totals && totals.rounds > 0 && totals.win_type && <p className="src" data-testid="om-wintype">Marshals so far: {totals.marshals.map(m => `${m.operator ?? 'Marshal'} ${m.result === 'draw' ? 'draw' : sides[m.result].name}`).join(' · ')} → {WIN_TYPE_LABEL[totals.win_type as keyof typeof WIN_TYPE_LABEL] ?? totals.win_type}</p>}
        </div>

        <div className="ly-clock-panel">
          <ClockRecovery clock={clock} suspended={!!sheet} />
          <TimerBar timer={timer} leftMs={leftMs} roundNo={cur?.round_no ?? 1} presets={presets} busy={timerBusy || !st} offline={lyst.offline} note={timerNote} onSend={sendTimer}
            startHere={Boolean(timer && (timer.mode === 'equipment' || timer.mode === 'dq' || timer.mode === 'custom'))} />
          {mine.length > 0 && <div className="panel info"><p>{mine[0].error ?? 'An action was not accepted.'} It is kept on this device.</p><button type="button" className="btn btn-ink" onClick={() => void retryRejected(match.id)}>Try again</button><button type="button" className="ly-link" onClick={() => void discardRejected(match.id)}>Discard</button></div>}
          {zone === 'loading' && <p className="muted" role="status">Opening the Lyst…</p>}
          {zone === 'start' && timing && <div className="ly-zone ly-act"><button type="button" className="btn btn-win fq-big ly-go" disabled={timerBusy || lyst.offline || clockNeedsDecision} onClick={() => startRound(1)}>Start round 1 · {clockText(timing.round_seconds)}</button></div>}
          {zone === 'fighting' && timing && <div className="ly-zone ly-act"><button type="button" className={`btn fq-big ly-go ${leftMs <= 0 ? 'btn-win is-urgent' : 'btn-ink'}`} disabled={timerBusy || lyst.offline} onClick={endRound}>{leftMs <= 0 ? 'Time.' : 'End round'} · start the {clockText(timing.break_seconds)} break</button></div>}
          {(zone === 'confirm' || zone === 'fighting') && cur && (
            <SheetsBlock round={cur} marshals={marshalSeats} sheets={roundSheets} missing={missing.map(m => m.name)} preview={preview} sides={sides} names={names}
              rulesCount={rulesCount} deliveryReason={deliveryReason} reason={reason} onReason={setReason} busy={busy} canConfirm={canConfirm && zone === 'confirm'} canResolve={canResolve}
              onConfirm={short => void confirm(cur, short)} onRecount={() => void recount(cur)} protocol={om?.protocol.find(p => p.round_no === cur.round_no) ?? null} />
          )}
          {zone === 'between' && totals && timing && (
            <div className="ly-zone ly-act ly-act-two">
              {totals.next === 'round' && <button type="button" className="btn btn-win fq-big ly-go" disabled={timerBusy || lyst.offline} onClick={() => startRound(nextNo)}>Start round {nextNo} of {timing.rounds} · {clockText(timing.round_seconds)}</button>}
              {totals.next === 'tiebreak' && <><p className="ly-hint-line" role="status">Level after {timing.rounds} rounds: a 3rd round is fought (Outrance §4.2).</p><button type="button" className="btn btn-win fq-big ly-go" disabled={timerBusy || lyst.offline} onClick={() => startRound(nextNo)}>Start round {nextNo} · {clockText(timing.round_seconds)}</button></>}
              {(totals.next === 'finish' || totals.next === 'head_marshal') && <button type="button" className="btn btn-win fq-big ly-go" disabled={busy} onClick={() => { setPhase('finishing'); setError(null); }}>Finish the fight</button>}
            </div>
          )}
          {stoppages.length > 0 && phase === 'scoring' && <button type="button" className="btn btn-win fq-big" onClick={() => setPhase('finishing')}>Finish: {stoppages[0].label}</button>}
          {dq.length > 0 && phase === 'scoring' && stoppages.length === 0 && <button type="button" className="btn btn-win fq-big" onClick={() => setPhase('finishing')}>Finish: disqualification</button>}
        </div>

        <div className="ly-support">
          {st && <CounterDeliveryPanel state={st} sides={sides} onChanged={() => void lyst.refresh()} visible={sheet === 'phones'} onVisibleChange={v => setSheet(v ? 'phones' : null)} />}
          <nav className="ly-tools" aria-label="Lyst tools">
            <button type="button" className="btn btn-line ly-tool" onClick={() => setSheet('calls')} disabled={!st || !cur} data-testid="om-calls-open">Knight marshal's call{discipline.length ? ` · ${activeDiscipline(discipline).length}` : ''}</button>
            <button type="button" className="btn btn-line ly-tool" onClick={() => setSheet('appeals')} disabled={!st}>Appeals{om?.appeals.length ? ` · ${om.appeals.length}` : ''}</button>
            {!secretary && <button type="button" className="btn btn-line ly-tool" onClick={() => setSheet('log')} disabled={!st}>Record</button>}
            <button type="button" className="btn btn-line ly-tool" onClick={() => setSheet('rules')}>Rules</button>
          </nav>
          {discipline.length > 0 && <ul className="ly-recent" aria-label="Recent calls">{activeDiscipline(discipline).slice(-4).map(d => <li key={d.id}>{describeDiscipline(d, names)}</li>)}</ul>}
          <div className="mactions sk-actions">
            <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button>
            {!secretary && <button type="button" className="btn btn-line fq-big" onClick={onClassic}>Use the classic scoreboard (one sheet, paper backup)</button>}
          </div>
        </div>
      </div>

      {phase === 'finishing' && om && totals && (
        <Dialog title="Finish the fight" wide busy={busy} dismissOnBackdrop={false} onClose={() => setPhase('scoring')}>
          <FinishBlock om={om} names={names} sides={sides} stoppages={stoppages} dq={dq} canResolve={canResolve} busy={busy} onFinish={(b, r, how, why) => void finish(b, r, how, why)} />
          {error && <p role="alert" className="ly-error">{error}</p>}
        </Dialog>
      )}
      {sheet === 'calls' && cur && <CallsSheet round={cur.round_no} names={names} sides={sides} division={timing?.division ?? '1'} busy={busy} calledBy={calledBy} onCalledBy={setCalledBy} onCall={(s, c, why) => void call(s, c, why)} onClose={() => setSheet(null)} />}
      {sheet === 'appeals' && <Dialog title="Appeals (Outrance §16)" onClose={() => setSheet(null)}><AppealsBlock om={om} names={names} matchId={match.id} canResolve={canResolve} onChanged={() => void lyst.refresh()} final={false} /></Dialog>}
      {sheet === 'log' && st && <LogPanel state={st} names={names} busy={busy} onVoid={(id, why) => void voidIt(id, why)} onClose={() => setSheet(null)} citations={new Map()} onCite={() => undefined} />}
      {sheet === 'rules' && <RulesSheet onClose={() => setSheet(null)} />}
      {phase === 'scoring' && !sheet && error && <Dialog title="Scoring action needs attention" onClose={() => setError(null)}><p className="ly-error" role="alert">{error}</p><button type="button" className="btn btn-line" onClick={() => setError(null)}>Back to scoring</button></Dialog>}
    </div>
  );
}

/* ---------------- the round's sheets (§15.1.1, §15.3.1) ---------------- */
function SheetsBlock({ round, marshals, sheets, missing, preview, sides, names, rulesCount, deliveryReason, reason, onReason, busy, canConfirm, canResolve, onConfirm, onRecount, protocol }: {
  round: LystRound; marshals: LystState['seats']; sheets: OutranceSheet[]; missing: string[]; preview: { a: number; b: number } | null; sides: ReturnType<typeof mergeSides>; names: { a: string; b: string };
  rulesCount: boolean; deliveryReason: string | null; reason: string; onReason: (v: string) => void; busy: boolean; canConfirm: boolean; canResolve: boolean;
  onConfirm: (short: boolean) => void; onRecount: () => void; protocol: OutranceState['protocol'][number] | null;
}) {
  const confirmed = round.status === 'confirmed';
  return (
    <section className="panel om-sheets" aria-label={`Round ${round.round_no} sheets`} data-testid="om-sheets">
      <h2 className="ly-h">Round {round.round_no}: line marshals' sheets · {sheets.length} of {marshals.length || '3 or 5'}</h2>
      {marshals.length !== 3 && marshals.length !== 5 && <p className="ly-note" role="status">{marshals.length} line-marshal phone{marshals.length === 1 ? '' : 's'} on this fight. Outrance needs 3 or 5 (§15.1.1): add or end phones with the Counter QR.</p>}
      <ul className="om-sheet-list">
        {sheets.map(s => (
          <li key={s.sheet_id} data-testid="om-sheet-row">
            <b>{s.operator ?? 'Marshal'}</b>
            <span className="mono">{s.strikes.a}–{s.strikes.b}</span>
            <span>{BAND_LABEL[s.result.band]}{s.result.decided_by ? ` (${CRITERION_LABEL[s.result.decided_by].replace('Effective ', '')})` : ''}: {s.result.a}–{s.result.b}</span>
            {(s.deduct.a || s.deduct.b) ? <span className="src">−{s.deduct.a} / −{s.deduct.b}</span> : <span />}
            <b className="mono">{s.score.a}–{s.score.b}</b>
          </li>
        ))}
        {missing.map(n => <li key={n} className="is-waiting"><b>{n}</b><span className="src">not handed in yet</span></li>)}
      </ul>
      {protocol && (protocol.yellows.a + protocol.yellows.b + protocol.armour.a + protocol.armour.b > 0 || protocol.stoppage) &&
        <p className="src">This round's protocol: {(['a', 'b'] as const).map(k => `${sides[k].name} ${protocol.yellows[k]} yellow, ${protocol.armour[k]} armour`).join(' · ')}{protocol.stoppage ? ` · ${names[protocol.stoppage]} stopped (10–7)` : ''}. Each comes off every sheet.</p>}
      {preview && <p className="om-preview" data-testid="om-preview">Round Score: <b className="mono">{sides.a.name} {showScore(preview.a)} – {showScore(preview.b)} {sides.b.name}</b> <span className="src">(average of {sheets.length} sheets; shown as {wholeScore(preview.a)}–{wholeScore(preview.b)} where a whole number is needed)</span></p>}
      {!confirmed && (
        <>
          {deliveryReason && <p className="ly-note" role="status">{deliveryReason}</p>}
          {(deliveryReason || !rulesCount || missing.length > 0) && <label className="ly-reason"><span>Reason</span><input value={reason} maxLength={200} onChange={e => onReason(e.target.value)} placeholder="For example: checked the phones with the line marshals" /></label>}
          <div className="ly-confirm-row">
            <button type="button" className="btn btn-win fq-big ly-confirm" disabled={!canConfirm} onClick={() => onConfirm(false)} data-testid="om-confirm">{busy ? 'Saving…' : !rulesCount ? 'Waiting for 3 or 5 sheets' : missing.length ? `Waiting for ${missing.length} sheet${missing.length === 1 ? '' : 's'}` : `Confirm round ${round.round_no}`}</button>
          </div>
          {canResolve && (!rulesCount || missing.length > 0) && sheets.length > 0 && <button type="button" className="ly-link" disabled={busy || reason.trim().length < 3} onClick={() => onConfirm(true)}>Head marshal: confirm with {sheets.length} sheet{sheets.length === 1 ? '' : 's'} (marked "not 3 or 5 line marshals")</button>}
          {sheets.length > 0 && <button type="button" className="ly-link" disabled={busy} onClick={onRecount}>Return the round to the line marshals for recount{reason.trim().length < 3 ? ' (write the reason first)' : ''}</button>}
        </>
      )}
    </section>
  );
}

/* ---------------- the knight marshal's calls (§13, §14) ---------------- */
function CallsSheet({ round, names, sides, division, busy, calledBy, onCalledBy, onCall, onClose }: {
  round: number; names: { a: string; b: string }; sides: ReturnType<typeof mergeSides>; division: Division; busy: boolean; calledBy: string; onCalledBy: (v: string) => void;
  onCall: (side: 'a' | 'b', call: OutranceCall, why: string | null) => void; onClose: () => void;
}) {
  const [side, setSide] = useState<'a' | 'b' | null>(null);
  const [ending, setEnding] = useState<OutranceCall | null>(null);
  const [why, setWhy] = useState('');
  const common: { call: OutranceCall; word: string; hint: string }[] = [
    { call: 'warning', word: 'Verbal warning', hint: '3 warnings make a yellow card (§13.1)' },
    { call: 'yellow', word: 'Yellow card', hint: '−1 on every sheet; a 2nd is a red card (§13.2, §13.4)' },
    { call: 'armour', word: 'Armour failure · 90 s', hint: '−1 for each 90 s granted; starts the repair clock (§14.4)' }
  ];
  const endings: { call: OutranceCall; word: string }[] = [
    { call: 'ko', word: 'Knockout (KO)' }, { call: 'tko', word: division === '1' ? 'TKO: lack of defence (loses the match)' : 'TKO: lack of defence (loses the round, Div 2)' },
    { call: 'tko_equipment', word: 'TKO: armour/weapon failure' }, { call: 'tko_stalling', word: 'TKO: stalling (§11.4)' }, { call: 'tko_corner', word: 'TKO: corner stoppage' },
    { call: 'yield', word: 'Competitor yields' }, { call: 'medical', word: 'Medical retirement' }, { call: 'red', word: 'Red card (disqualification)' },
    { call: 'dq_equipment', word: 'DQ: no weapon / armour' }, { call: 'corner_expelled', word: 'Corner man expelled (no effect on the score)' }
  ];
  return (
    <Dialog title={`Round ${round} · knight marshal's call`} onClose={onClose} busy={busy}>
      <div className="om-call-sides" role="group" aria-label="Against which competitor">
        {(['a', 'b'] as const).map(s => <button key={s} type="button" className={`cp-side cp-side-${s} om-pick`} aria-pressed={side === s} onClick={() => setSide(s)} data-testid={`om-against-${s}`}><span>{sides[s].name}</span><small>{names[s]}</small></button>)}
      </div>
      {side && (
        <>
          <div className="om-call-list">
            {common.map(c => <button key={c.call} type="button" className="btn btn-ink fq-big om-call-btn" disabled={busy} onClick={() => onCall(side, c.call, null)} data-testid={`om-call-${c.call}`}><b>{c.word}</b><small>{c.hint}</small></button>)}
          </div>
          <details className="ly-other"><summary>Ends the fight, or other calls</summary>
            <div className="om-call-list">
              {endings.map(c => <button key={c.call} type="button" className={`btn ${ending === c.call ? 'btn-ink' : 'btn-line'} om-call-btn`} disabled={busy} onClick={() => setEnding(c.call)} data-testid={`om-call-${c.call}`}>{c.word}</button>)}
            </div>
            {ending && <div className="om-confirm-end">
              <label className="ly-reason"><span>What happened (optional)</span><input value={why} maxLength={200} onChange={e => setWhy(e.target.value)} /></label>
              <button type="button" className="btn btn-win fq-big" disabled={busy} onClick={() => onCall(side, ending, why.trim() || null)} data-testid="om-call-confirm">Record against {sides[side].name} · {names[side]}</button>
            </div>}
          </details>
        </>
      )}
      <label className="ly-reason"><span>Knight marshal</span><input value={calledBy} maxLength={60} onChange={e => onCalledBy(e.target.value)} placeholder="Name (optional)" /></label>
    </Dialog>
  );
}

/* ---------------- finishing (§15.4) ---------------- */
function FinishBlock({ om, names, sides, stoppages, dq, canResolve, busy, onFinish }: {
  om: OutranceState; names: { a: string; b: string }; sides: ReturnType<typeof mergeSides>; stoppages: LystDiscipline[]; dq: ('a' | 'b')[]; canResolve: boolean; busy: boolean;
  onFinish: (basis: OutranceFinishBasis, result: 'a' | 'b' | 'draw', how: string, why: string | null) => void;
}) {
  const t = om.totals;
  const [hm, setHm] = useState<'a' | 'b' | 'draw' | null>(null);
  const [why, setWhy] = useState('');
  const leader = t.leader ?? 'draw';
  const type = t.win_type ? (WIN_TYPE_LABEL[t.win_type as keyof typeof WIN_TYPE_LABEL] ?? t.win_type) : null;
  const other = (s: 'a' | 'b') => (s === 'a' ? 'b' : 'a');
  return (
    <div className="om-finish" data-testid="om-finish">
      <p className="mono om-total-line">{names.a} {showScore(t.a)} – {showScore(t.b)} {names.b}</p>
      <ul className="ly-rounds-list">{om.rounds.map(r => <li key={r.round_no}>Round {r.round_no}: <b className="mono">{showScore(r.a)}–{showScore(r.b)}</b> <span className="src">({r.marshals} marshals{r.short ? ', not 3 or 5' : ''})</span></li>)}</ul>
      {t.marshals.length > 0 && <p className="src">Each marshal's fight: {t.marshals.map(m => `${m.operator ?? 'Marshal'} ${m.a}–${m.b}`).join(' · ')}{type ? ` → ${type}` : ''}</p>}
      {t.next === 'finish' && <button type="button" className="btn btn-win fq-big" disabled={busy} onClick={() => onFinish('decision', leader, type ? `by ${type.toLowerCase()}` : 'on points', null)} data-testid="om-finish-decision">
        {leader === 'draw' ? `Save the draw${type ? ` (${type.toLowerCase()})` : ''}` : `${names[leader]} wins on the Total Fight Score${type ? ` · ${type}` : ''}`}</button>}
      {t.next === 'head_marshal' && (
        <div className="ly-other-block"><b>Still level after the 3rd round. The head marshal decides (§2.1).</b>
          {canResolve ? <>
            <div className="mactions">{(['a', 'draw', 'b'] as const).map(r => <button key={r} type="button" className={`btn ${hm === r ? 'btn-ink' : 'btn-line'}`} onClick={() => setHm(r)}>{r === 'draw' ? 'Draw' : names[r]}</button>)}</div>
            <label className="ly-reason"><span>How the head marshal decided</span><input value={why} maxLength={200} onChange={e => setWhy(e.target.value)} /></label>
            <button type="button" className="btn btn-win fq-big" disabled={busy || !hm || why.trim().length < 3} onClick={() => hm && onFinish('head_marshal', hm, 'by the head marshal\'s decision', why.trim())}>Save the head marshal's decision</button>
          </> : <p className="ly-note">Ask the head marshal or an organizer to record the decision.</p>}
        </div>
      )}
      {stoppages.map(d => { const s = STOPPAGE[d.key!]; const w = other(d.side); return <button key={d.id} type="button" className="btn btn-win fq-big" disabled={busy} onClick={() => onFinish(s.basis, w, s.word, null)}>{sides[w].name} · {names[w]} wins {s.word}</button>; })}
      {dq.map(s => <button key={s} type="button" className="btn btn-win fq-big" disabled={busy} onClick={() => onFinish('dq', other(s), `: ${names[s]} disqualified`, null)}>{names[other(s)]} wins: {names[s]} disqualified</button>)}
      {t.next === 'round' || t.next === 'tiebreak' || t.next === 'confirm' ? <p className="ly-note">{t.next === 'confirm' ? 'Confirm the round first.' : t.next === 'tiebreak' ? 'Level: the 3rd round is fought first (§4.2).' : 'More rounds to fight (§4).'} A stoppage or disqualification can still end the fight.</p> : null}
    </div>
  );
}

/* ---------------- holds before the next fight ---------------- */
function HoldLine({ hold, name, canClear, onCleared }: { hold: OutranceState['holds'][number]; name: string; canClear: boolean; onCleared: () => void }) {
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="ly-note om-hold" role="alert" data-testid="om-hold">
      <b>{name}</b> {HOLD_WORD[hold.kind] ?? hold.kind}
      {canClear && <span className="om-hold-clear"><input value={why} maxLength={200} onChange={e => setWhy(e.target.value)} placeholder="What was checked" aria-label="What was checked" />
        <button type="button" className="btn btn-line" disabled={busy || why.trim().length < 3} onClick={async () => { setBusy(true); setProblem(null); try { await outranceClearHold(hold.id, why.trim()); onCleared(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); } }}>Cleared</button></span>}
      {problem && <span className="ly-error">{problem}</span>}
    </div>
  );
}

/* ---------------- appeals (§16) ---------------- */
function AppealsBlock({ om, names, matchId, canResolve, onChanged, final }: { om: OutranceState | null; names: { a: string; b: string }; matchId: string; canResolve: boolean; onChanged: () => void; final: boolean }) {
  const [side, setSide] = useState<'a' | 'b'>('a');
  const [by, setBy] = useState<'competitor' | 'corner'>(final ? 'corner' : 'competitor');
  const [grounds, setGrounds] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const lodge = async () => { setBusy(true); setProblem(null); try { await outranceAppeal(crypto.randomUUID(), matchId, side, by, grounds.trim()); setGrounds(''); onChanged(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); } };
  return (
    <section className="om-appeals" aria-label="Appeals">
      <p className="src">A competitor appeals at the end of the fight, before leaving the list; the corner men within 15 minutes after the fight (§16.3). Outcomes: a rematch of the round, a card or a point deduction imposed or withdrawn (§16.4).</p>
      {(om?.appeals ?? []).map(a => <AppealRow key={a.id} a={a} name={names[a.side]} canResolve={canResolve} onChanged={onChanged} />)}
      <div className="mactions">{(['a', 'b'] as const).map(s => <button key={s} type="button" className={`btn ${side === s ? 'btn-ink' : 'btn-line'}`} onClick={() => setSide(s)}>{names[s]}</button>)}</div>
      <div className="mactions">{(['competitor', 'corner'] as const).map(b => <button key={b} type="button" className={`btn ${by === b ? 'btn-ink' : 'btn-line'}`} onClick={() => setBy(b)}>{b === 'competitor' ? 'The competitor' : 'Their corner men'}</button>)}</div>
      <label className="ly-reason"><span>Grounds (written, §16.1)</span><input value={grounds} maxLength={500} onChange={e => setGrounds(e.target.value)} placeholder="For example: unregistered clean blows in round 2" /></label>
      <button type="button" className="btn btn-line fq-big" disabled={busy || grounds.trim().length < 3} onClick={() => void lodge()}>Record the appeal</button>
      {problem && <p className="ly-error" role="alert">{problem}</p>}
    </section>
  );
}
function AppealRow({ a, name, canResolve, onChanged }: { a: OutranceState['appeals'][number]; name: string; canResolve: boolean; onChanged: () => void }) {
  const [outcome, setOutcome] = useState('none');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (d: 'upheld' | 'rejected') => { setBusy(true); try { await outranceAppealDecide(a.id, d, d === 'rejected' ? 'none' : outcome, note.trim()); onChanged(); } finally { setBusy(false); } };
  return (
    <div className="panel info om-appeal">
      <b>{name} · {a.lodged_by === 'competitor' ? 'competitor' : 'corner men'}</b> <span>{a.grounds}</span>
      {a.decision ? <span className="src">{a.decision === 'upheld' ? `Upheld: ${a.outcome?.replace('_', ' ')}` : 'Rejected'} · {a.decision_note}</span> : canResolve ? (
        <>
          <select value={outcome} onChange={e => setOutcome(e.target.value)} aria-label="Outcome if upheld">
            <option value="none">Outcome if upheld…</option><option value="round_rematch">Rematch of the round</option><option value="card_imposed">Card imposed</option><option value="card_withdrawn">Card withdrawn</option>
            <option value="deduction_imposed">Point deduction imposed</option><option value="deduction_withdrawn">Point deduction withdrawn</option>
          </select>
          <input value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="The decision" aria-label="The decision" />
          <div className="mactions"><button type="button" className="btn btn-line" disabled={busy || note.trim().length < 3 || outcome === 'none'} onClick={() => void decide('upheld')}>Uphold</button><button type="button" className="btn btn-line" disabled={busy || note.trim().length < 3} onClick={() => void decide('rejected')}>Reject</button></div>
          <p className="src">Apply an upheld outcome with the tools here: void or add the call, or return the round for recount.</p>
        </>
      ) : <span className="src">Waiting for the head marshal.</span>}
    </div>
  );
}

/* ---------------- set up a Profight competition ---------------- */
export function FormatForm({ competitionId, onSaved, initial }: { competitionId: string; onSaved: () => void; initial?: { division?: string | null; format?: string | null } }) {
  const [division, setDivision] = useState<Division | null>(initial?.division === '1' || initial?.division === '2' ? initial.division : null);
  const [format, setFormat] = useState<FightFormat | null>(initial?.format === 'tournament' || initial?.format === 'matched' ? initial.format : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => { if (!division || !format) return; setBusy(true); setProblem(null); try { await setProfightFormat(competitionId, division, format); onSaved(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); } };
  return (
    <div className="om-format" data-testid="om-format">
      <div className="mactions" role="group" aria-label="Division">{(['1', '2'] as const).map(d => <button key={d} type="button" className={`btn ${division === d ? 'btn-ink' : 'btn-line'}`} aria-pressed={division === d} onClick={() => setDivision(d)}>Division {d}{d === '1' ? ' · 2:00 rounds' : ' · 1:30 rounds'}</button>)}</div>
      <div className="mactions" role="group" aria-label="Format">{(['tournament', 'matched'] as const).map(f => <button key={f} type="button" className={`btn ${format === f ? 'btn-ink' : 'btn-line'}`} aria-pressed={format === f} onClick={() => setFormat(f)}>{f === 'tournament' ? 'Tournament · 2 rounds (+3rd if level)' : 'Matched fight · 3 rounds'}</button>)}</div>
      <button type="button" className="btn btn-win fq-big" disabled={busy || !division || !format} onClick={() => void save()}>Save</button>
      {problem && <p className="ly-error" role="alert">{problem}</p>}
    </div>
  );
}
