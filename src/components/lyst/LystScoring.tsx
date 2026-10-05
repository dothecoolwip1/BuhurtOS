import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBanner, type ScoringScreenProps } from '../scoring/ScoringScreen';
import { TimerBar, type TimerSend } from './TimerBar';
import { RoundEntry, type Hint } from './RoundEntry';
import { DisciplineSheet, type DisciplineDraft } from './DisciplineSheet';
import { CountersPanel } from './CountersPanel';
import { LogPanel } from './LogPanel';
import { LystSettingsDialog } from './LystSettingsDialog';
import { assignSeat, carrySeats, createJoinCode, endSeat, finalizeFromLyst, openLyst, timerCommand } from '../../data/lyst';
import { sideLabel } from '../../lib/entryLabel';
import { isNoSignalError } from '../../lib/fieldScoring';
import { friendlyError } from '../../lib/friendlyError';
import { scoringGuard } from '../../lib/swUpdate';
import { useOutbox } from '../../lib/useOutbox';
import { trackEvent } from '../../lib/analytics';
import { counterInputFor } from '../../lib/lyst/counters';
import { clearFinalCommand, loadFinalCommand, saveFinalCommand } from '../../lib/lyst/finalizeStore';
import {
  activeDiscipline, allRoundsConfirmed, currentRound, describeDiscipline, disciplineCounts, entryStart, hasDq, leadRule, officialTotals, resultSupportedByTotals, roundSeconds,
  ROUND_STATUS_WORD, type FinishBasis, type LystRound
} from '../../lib/lyst/rounds';
import { presetOf, remainingMs, timerFor } from '../../lib/lyst/timer';
import { useLystState, useNow } from '../../lib/lyst/useLystState';

type Phase = 'scoring' | 'confirming' | 'official' | 'pending' | 'review';
type Sheet = null | 'discipline' | 'counters' | 'log' | 'settings';
const CALLED_BY_KEY = 'bos-lyst-called-by';
const readCalledBy = () => { try { return localStorage.getItem(CALLED_BY_KEY) ?? ''; } catch { return ''; } };

const sideName = (m: { entryA: string | null; entryB: string | null; nameA: string | null; nameB: string | null }) => ({ a: sideLabel(m.entryA, m.nameA, 'Side A'), b: sideLabel(m.entryB, m.nameB, 'Side B') });
const roundText = (m: ScoringScreenProps['opened']['match']) => `${m.roundLabel || m.stage}${m.pool ? ` · Pool ${m.pool}` : ''}`;

export interface LystScoringProps extends ScoringScreenProps { canResolve: boolean; onClassic: () => void }

/**
 * The lyst tablet. One screen for the whole fight: the clock (server state), the round zone (start, end, confirm), the marshal's call (cards, deductions, DQ), the optional counters, and
 * finishing through the existing human-confirmed result path. THE MARSHAL'S CALL IS THE ONLY OFFICIAL SCORE: this screen never derives a score from counters or from the clock.
 * Confirmed rounds, penalties and voids go through the existing scoring outbox (saved on the device first, sent in order, kept if refused); the clock is online-only on purpose.
 */
export function LystScoring({ opened, eventId, userId, fieldName, nextFight, backHref, onExit, onFinished, onOfficial, onOpenNext, onStale, canResolve, onClassic }: LystScoringProps) {
  const { match, comp } = opened;
  const names = sideName(match);
  const lyst = useLystState(match.id, eventId);
  const st = lyst.state;
  const { waiting, record, drain, rejected, discardRejected, retryRejected } = useOutbox({ eventId });
  const mine = rejected.filter(e => e.subject === match.id);

  const [phase, setPhase] = useState<Phase>('scoring');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [timerBusy, setTimerBusy] = useState(false);
  const [timerNote, setTimerNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [early, setEarly] = useState(false);   // enter the score without ending the round first
  const [pendingRound, setPendingRound] = useState<{ round: number; a: number; b: number } | null>(null);
  const [saved, setSaved] = useState<{ summary: string; a: number; b: number; winner: 'a' | 'b' | 'draw' } | null>(null);
  const commandId = useRef<string | undefined>(undefined);
  const [choice, setChoice] = useState<{ result: 'a' | 'b' | 'draw'; basis: FinishBasis } | null>(null);
  const [technicalReason, setTechnicalReason] = useState('');
  const [calledBy, setCalledBy] = useState(readCalledBy);

  useEffect(() => { scoringGuard.enter(); return () => scoringGuard.leave(); }, []);
  useEffect(() => { if (phase !== 'scoring') window.scrollTo({ top: 0 }); }, [phase]);
  useEffect(() => { let live = true; void loadFinalCommand(userId, match.id).then(f => { if (live && f) { commandId.current = f.commandId; if (f.review === 'conflict') setPhase('review'); } }); return () => { live = false; }; }, [userId, match.id]);

  // Open this match in Lyst Control once the state is known (idempotent on the server).
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!st || st.lyst || openedOnce.current) return;
    openedOnce.current = true;
    void openLyst(match.id, counterInputFor(comp.category, st.settings.counter_input) === 'weighted' ? 'weighted' : 'simple').then(() => lyst.refresh()).catch(e => setError(friendlyError(e)));
  }, [st, match.id, comp.category, lyst]);

  const settings = st?.settings;
  const presets = settings?.presets ?? [];
  const rounds = useMemo<LystRound[]>(() => st?.rounds ?? [], [st?.rounds]);
  const cur = currentRound(rounds);
  const totals = officialTotals(rounds);
  const discipline = st?.discipline ?? [];
  const timer = timerFor(st?.timer, match.id);
  const running = timer?.status === 'running';
  const now = useNow(running);
  const leftMs = timer ? remainingMs(timer, lyst.clock.now(now)) : presetOf(presets, 'fight').seconds * 1000;
  const nextRoundNo = (cur?.round_no ?? 0) + 1;
  const fightSeconds = presetOf(presets, 'fight').seconds;

  // the saved confirmation is on the server now: stop showing it as pending
  useEffect(() => { if (pendingRound && rounds.some(r => r.round_no === pendingRound.round && r.status === 'confirmed' && r.awarded_a === pendingRound.a && r.awarded_b === pendingRound.b)) setPendingRound(null); }, [rounds, pendingRound]);

  /* ---------------- the clock: online only ---------------- */
  const sendTimer: TimerSend = useCallback((action, o = {}) => {
    if (!st) return;
    setTimerBusy(true); setTimerNote(null);
    void timerCommand({ eventId, field: fieldName, matchId: match.id, expectedRev: st.timer?.rev ?? 0, command: crypto.randomUUID(), action, mode: o.mode ?? null, durationMs: o.durationMs ?? null, round: o.round ?? null, deltaMs: o.deltaMs ?? 0 })
      .then(({ answer, sentAt, receivedAt }) => {
        if (answer.status === 'stale') setTimerNote('Another device changed the clock. Showing the latest. Press again if you still want to.');
        lyst.applyTimer(answer.timer, answer.server_now, sentAt, receivedAt);
      })
      .catch(e => {
        if (isNoSignalError(e)) setTimerNote('No signal. The clock was not changed.'); else setTimerNote(friendlyError(e, 'The clock was not changed.'));
        void lyst.refresh();
      })
      .finally(() => setTimerBusy(false));
  }, [st, eventId, fieldName, match.id, lyst]);

  const startRound = (n: number) => { setEarly(false); sendTimer('start', { mode: 'fight', round: n, durationMs: roundSeconds(n, settings ?? { regular_rounds: 2, extra_round_seconds: 30 }, fightSeconds) * 1000 }); };
  const endRound = (kind: 'break' | 'extended_break' = 'break') => sendTimer('start', { mode: kind, round: cur?.round_no ?? 1, durationMs: presetOf(presets, kind).seconds * 1000 });

  // optional: the operating tablet starts the break by itself when the round clock reaches zero (the first tablet to do it wins; another is told "stale")
  const autoFired = useRef<number | null>(null);
  useEffect(() => {
    if (!settings?.auto_break || !timer || timer.mode !== 'fight' || timer.status !== 'running' || leftMs > 0 || cur?.status !== 'running' || autoFired.current === timer.rev || timerBusy) return;
    autoFired.current = timer.rev;
    endRound('break');
  });
  // a short buzz at zero, once per run of the clock
  const buzzed = useRef<number | null>(null);
  useEffect(() => { if (timer && timer.status === 'running' && leftMs <= 0 && buzzed.current !== timer.rev) { buzzed.current = timer.rev; try { navigator.vibrate?.([250, 120, 250]); } catch { /* not supported */ } } });

  /* ---------------- the marshal's call: through the outbox ---------------- */
  const send = async () => {
    const r = await drain(match.id);
    await lyst.refresh();
    return r;
  };

  const confirm = async (round: LystRound, a: number, b: number, extra: { reason: string | null; recommendedA: number | null; recommendedB: number | null }) => {
    setBusy(true); setError(null);
    try {
      const id = await record('lyst.confirm_round', match.id, { matchId: match.id, round: round.round_no, a, b, expectedRev: round.rev, recommendedA: extra.recommendedA, recommendedB: extra.recommendedB, reason: extra.reason });
      if (!id) { setError('Sign in again to score.'); return; }
      setPendingRound({ round: round.round_no, a, b });
      setCorrecting(null); setEarly(false);
      trackEvent('lyst_round_confirmed', { round: round.round_no, correction: round.status === 'confirmed' });
      await send();
    } catch (e) { setError(friendlyError(e, 'Could not save the round. It is kept on this device.')); } finally { setBusy(false); }
  };

  const recordDiscipline = async (d: DisciplineDraft) => {
    setBusy(true); setError(null);
    const round = cur?.round_no ?? 1;
    try {
      try { localStorage.setItem(CALLED_BY_KEY, d.calledBy ?? ''); setCalledBy(d.calledBy ?? ''); } catch { /* ignore */ }
      const first = await record('lyst.discipline', match.id, { matchId: match.id, round, side: d.side, kind: d.kind, label: d.label, amount: d.amount, reason: d.reason, calledBy: d.calledBy, related: null });
      if (first && d.kind === 'card' && d.alsoDeduct > 0) {
        await record('lyst.discipline', match.id, { matchId: match.id, round, side: d.side, kind: 'deduction', label: null, amount: d.alsoDeduct, reason: d.reason ?? 'With the card', calledBy: d.calledBy, related: first });
      }
      trackEvent('lyst_discipline_recorded', { kind: d.kind });
      setSheet(null);
      await send();
    } catch (e) { setError(friendlyError(e, 'Could not record that. Nothing was lost; try again.')); } finally { setBusy(false); }
  };

  const voidIt = async (id: string, reason: string) => {
    setBusy(true); setError(null);
    try { await record('lyst.void', match.id, { id, reason }); await send(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  /* ---------------- counters: seats ---------------- */
  const seatAction = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await lyst.refresh(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); } };

  /* ---------------- finishing: the existing human-confirmed path ---------------- */
  const supported = resultSupportedByTotals(rounds);
  const finishReady = allRoundsConfirmed(rounds) && !pendingRound && waiting === 0;
  const rule = leadRule(rounds, settings ?? { regular_rounds: 2 });
  const summaryFor = (result: 'a' | 'b' | 'draw') => (result === 'draw' ? `Draw, ${totals.a}–${totals.b}` : `${result === 'a' ? names.a : names.b} win, ${Math.max(totals.a, totals.b)}–${Math.min(totals.a, totals.b)}`);

  const saveFinal = async (result: 'a' | 'b' | 'draw', basis: FinishBasis, reason: string | null) => {
    if (!st) return;
    setBusy(true); setError(null);
    try {
      const sent = await drain(match.id);
      if (!sent.clear) { setError(`${sent.remaining} action${sent.remaining === 1 ? ' is' : 's are'} still waiting to send, so the result cannot be made official yet. Nothing is lost.`); setPhase('pending'); return; }
      if (!commandId.current) { commandId.current = crypto.randomUUID(); await saveFinalCommand(userId, match.id, commandId.current); }
      let r;
      try { r = await finalizeFromLyst({ command: commandId.current, matchId: match.id, expectedVersion: st.match.version, result, basis, reason }); }
      catch (e) { if (isNoSignalError(e)) { trackEvent('result_pending_no_signal'); setPhase('pending'); return; } throw e; }
      if (r.status === 'accepted' || r.status === 'duplicate') {
        await clearFinalCommand(userId, match.id); await discardRejected(match.id);
        setSaved({ summary: summaryFor(result), a: totals.a, b: totals.b, winner: result });
        trackEvent('result_official', { outcome: r.status, via: 'lyst', basis });
        setPhase('official'); onOfficial();
      } else if (r.status === 'conflict') {
        await saveFinalCommand(userId, match.id, commandId.current, 'conflict'); trackEvent('result_conflict'); setPhase('review');
      } else {
        trackEvent('result_stale'); await clearFinalCommand(userId, match.id);
        onStale('This match changed after you opened it (a side was replaced or the result was reopened). Your result was sent to the head marshal for review and nothing was made official. The queue has been reloaded.');
      }
    } catch (e) { setError(friendlyError(e, 'Could not save the result. Your scoring is kept; try again.')); } finally { setBusy(false); }
  };

  const goNext = async (m: NonNullable<ScoringScreenProps['nextFight']>) => {
    // the same counters carry over to the next fight on this field (the operator can still change any seat)
    try { await openLyst(m.id, 'weighted'); await carrySeats(match.id, m.id); } catch { /* the counters can be seated again by hand */ }
    onOpenNext(m);
  };

  const context = <><h1 className="sr-only">{names.a} vs {names.b}</h1><p className="sk-ctx"><b>{fieldName}</b> · {comp.name} · {roundText(match)}</p></>;

  /* ---------------- result screens ---------------- */
  if (phase === 'official' && saved) {
    const nextNames = nextFight ? sideName(nextFight) : null;
    return (
      <section className="panel sk-done" aria-label="Result official">
        {context}
        <StatusBanner status="official" />
        <div className="sk-final">
          {(['a', 'b'] as const).map(k => <div key={k} className={`sk-fside${saved.winner === k ? ' won' : ''}`}><span className="sk-name">{names[k]}</span><span className="sk-num">{k === 'a' ? saved.a : saved.b}</span></div>)}
        </div>
        <p className="sk-winner">{saved.winner === 'draw' ? <b>Draw</b> : <>Winner: <b>{names[saved.winner]}</b></>}</p>
        <div className="sk-after">
          {nextFight && nextNames && <button type="button" className="btn btn-ink fq-big" onClick={() => void goNext(nextFight)}><span className="sk-after-k">Next fight on {fieldName}</span><span>{nextNames.a} vs {nextNames.b}</span></button>}
          {!nextFight && <p className="muted">Nothing is waiting on {fieldName} right now.</p>}
          {backHref && <Link className="btn btn-line fq-big" to={backHref.to}>{backHref.label}</Link>}
          <button type="button" className="btn btn-line fq-big" onClick={onFinished}>Back to the queue</button>
        </div>
      </section>
    );
  }
  if (phase === 'pending') {
    return (
      <section className="panel sk-done" aria-label="Result pending">
        {context}
        <StatusBanner status="pending" />
        <h2 className="sk-h">{choice ? summaryFor(choice.result) : 'Result not sent yet'}</h2>
        <p>This has not reached the server. Your rounds and penalties are saved on this device. Press Try again when you have signal.</p>
        <p><b>If the signal does not come back, write the result on the paper score sheet.</b> The paper sheet is the official record at this event; the head marshal can enter it later.</p>
        <div className="mactions">
          <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => setPhase('scoring')}>Back to the lyst</button>
          <button type="button" className="btn btn-ink fq-big" disabled={busy || !choice} onClick={() => choice && void saveFinal(choice.result, choice.basis, technicalReason || null)}>{busy ? 'Trying…' : 'Try again'}</button>
        </div>
        {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
        <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={onExit}>Back to the queue (keep this pending)</button>
      </section>
    );
  }
  if (phase === 'review') {
    return (
      <section className="panel sk-done" aria-label="Result needs review">
        {context}
        <StatusBanner status="review" />
        <h2 className="sk-h">A different result is already official for this match</h2>
        <p>Another device saved a different result first. Yours was <b>kept, not discarded</b>, and nothing was overwritten. Tell the head marshal. They can compare both with the paper sheet and decide.</p>
        <button type="button" className="btn btn-ink fq-big" onClick={async () => { await clearFinalCommand(userId, match.id); onFinished(); }}>I have told the head marshal: back to the queue</button>
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue (keep this on the device)</button>
      </section>
    );
  }

  if (phase === 'confirming') {
    const dqA = hasDq(discipline, 'a'), dqB = hasDq(discipline, 'b');
    return (
      <section className="panel sk-done ly-finish" aria-label="Finish the match">
        {context}
        <StatusBanner status={busy ? 'saving' : 'confirming'} />
        <h2 className="sk-h">{supported ? summaryFor(supported) : 'Confirm every round first'}</h2>
        <div className="sk-final">
          {(['a', 'b'] as const).map(k => <div key={k} className={`sk-fside${supported === k ? ' won' : ''}`}><span className="sk-name">{names[k]}</span><span className="sk-num">{k === 'a' ? totals.a : totals.b}</span></div>)}
        </div>
        <ul className="ly-rounds-list">{rounds.map(r => <li key={r.round_no}>Round {r.round_no}: <b className="mono">{r.official_a}–{r.official_b}</b>{(r.deduct_a || r.deduct_b) ? <span className="src"> (marshal awarded {r.awarded_a}–{r.awarded_b}, points taken off {r.deduct_a}–{r.deduct_b})</span> : null}</li>)}</ul>
        <p className="src">These totals are the marshal's confirmed rounds. {match.stage === 'pool' || match.stage === 'round_robin' ? 'Pool match.' : 'Elimination match: the winner moves on automatically.'} The result is only <b>official</b> once the server confirms it, and that needs signal.</p>
        {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
        <div className="mactions">
          <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => { setPhase('scoring'); setError(null); }}>Back to the lyst</button>
          <button type="button" className="btn btn-win fq-big" disabled={busy || !supported || !finishReady} onClick={() => { if (supported) { setChoice({ result: supported, basis: 'score' }); void saveFinal(supported, 'score', null); } }}>{busy ? 'Saving…' : 'Save result'}</button>
        </div>
        <details className="ly-other">
            <summary>Finish another way</summary>
            {(dqA || dqB) && (
              <div className="ly-other-block"><b>Disqualification</b>
                {dqB && <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => { setChoice({ result: 'a', basis: 'dq' }); void saveFinal('a', 'dq', null); }}>{names.a} win: {names.b} disqualified</button>}
                {dqA && <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => { setChoice({ result: 'b', basis: 'dq' }); void saveFinal('b', 'dq', null); }}>{names.b} win: {names.a} disqualified</button>}
              </div>
            )}
            {!dqA && !dqB && <p className="src">To finish on a disqualification, record the disqualification first (Marshal's call).</p>}
            <div className="ly-other-block"><b>Technical result</b>
              <label className="ly-reason"><span>The marshal's reason</span><input value={technicalReason} maxLength={200} onChange={e => setTechnicalReason(e.target.value)} placeholder="For example: opponent could not continue" /></label>
              <div className="mactions">
                {(['a', 'b'] as const).map(k => <button key={k} type="button" className="btn btn-line fq-big" disabled={busy || technicalReason.trim().length < 3 || !finishReady} onClick={() => { setChoice({ result: k, basis: 'technical' }); void saveFinal(k, 'technical', technicalReason.trim()); }}>{names[k]} win</button>)}
              </div>
            </div>
          </details>
      </section>
    );
  }

  /* ---------------- the lyst ---------------- */
  const zone: 'loading' | 'start' | 'fighting' | 'confirm' | 'between' = !st ? 'loading' : !cur ? 'start' : cur.status === 'running' ? 'fighting' : cur.status === 'confirming' ? 'confirm' : 'between';
  const hintsFor = (side: 'a' | 'b', round: number): Hint[] => (st?.seats ?? []).filter(s => s.role === 'official' && s.side === side && s.status === 'active').map(s => ({ slot: s.slot ?? '?', total: s.tallies.find(t => t.round_no === round)?.total ?? 0 }));
  const correctingRound = correcting !== null ? rounds.find(r => r.round_no === correcting) ?? null : null;
  const showEntry = zone === 'confirm' || (zone === 'fighting' && early);
  const bannerStatus = pendingRound || waiting > 0 ? 'pending' : finishReady ? 'ready' : 'scoring';
  const counts = { a: disciplineCounts(discipline, 'a'), b: disciplineCounts(discipline, 'b') };
  const entryRound = showEntry && cur ? cur : null;

  return (
    <div className="sk field-run ly">
      {context}
      <StatusBanner status={bannerStatus} line={bannerStatus === 'ready' ? 'Every round is confirmed. Finish the match when the marshal says so.' : bannerStatus === 'pending' ? 'Pending: NOT official until the server has it' : 'Pending: not official until you finish the match'} />
      {lyst.offline && <p className="ly-note" role="alert">No signal. What you see is the last thing the server told us; the clock keeps running on the server.</p>}

      <section className="sk-score ly-score" aria-label="Official score">
        {(['a', 'mid', 'b'] as const).map(k => k === 'mid'
          ? <div key="mid" className="sk-mid"><span className="sk-vs">vs</span><span className="sk-phase">{totals.rounds === 0 ? 'No round confirmed' : `After ${totals.rounds} round${totals.rounds === 1 ? '' : 's'}`}</span><span className="sk-unit">official</span></div>
          : (
            <div key={k} className={`sk-side ${k}${supported === k ? ' won' : totals[k] > totals[k === 'a' ? 'b' : 'a'] ? ' lead' : ''}`}>
              <span className="sk-tag">{k === 'a' ? 'A' : 'B'}</span>
              <span className="sk-name">{names[k]}</span>
              <span className="sk-num" aria-label={`${names[k]}: ${totals[k]} official points`}>{totals[k]}</span>
              {(counts[k].warnings > 0 || counts[k].cards > 0 || counts[k].deducted > 0 || counts[k].dq) && (
                <span className="ly-marks">{counts[k].warnings > 0 && <b className="ly-mark">W{counts[k].warnings}</b>}{counts[k].cards > 0 && <b className="ly-mark is-card">C{counts[k].cards}</b>}{counts[k].deducted > 0 && <b className="ly-mark is-ded">−{counts[k].deducted}</b>}{counts[k].dq && <b className="ly-mark is-dq">DQ</b>}</span>
              )}
            </div>
          ))}
      </section>
      {rounds.length > 0 && (
        <ul className="ly-rounds" aria-label="Rounds">
          {rounds.map(r => (
            <li key={r.round_no} className={`ly-round is-${r.status}`}>
              <span className="ly-round-n">R{r.round_no}</span>
              <span className="ly-round-s mono">{r.status === 'confirmed' ? `${r.official_a}–${r.official_b}` : '·'}</span>
              <span className="ly-round-w">{ROUND_STATUS_WORD[r.status]}{r.status === 'confirmed' && (r.deduct_a || r.deduct_b) ? ` (−${r.deduct_a}/−${r.deduct_b})` : ''}</span>
              {r.status === 'confirmed' && <button type="button" className="ly-link" onClick={() => { setCorrecting(r.round_no); setEarly(false); }} aria-label={`Correct round ${r.round_no}`}>Correct</button>}
            </li>
          ))}
        </ul>
      )}

      <TimerBar timer={timer} leftMs={leftMs} roundNo={cur?.round_no ?? 1} presets={presets} busy={timerBusy || !st} offline={lyst.offline} note={timerNote} onSend={sendTimer}
        startHere={Boolean(timer && (timer.mode === 'dq' || timer.mode === 'equipment' || timer.mode === 'custom' || zone === 'fighting'))} />

      {error && <p role="alert" className="ly-error">{error}</p>}
      {mine.length > 0 && (
        <div className="panel info" role="alert" style={{ gap: 8 }}>
          <b>{mine.length} action{mine.length === 1 ? ' was' : 's were'} refused by the server</b>
          <span className="src">{mine[0].error ?? 'For example you may not have permission, or the round changed on another device.'} They are kept here until you decide. Check the round before you finish.</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-line" onClick={() => void retryRejected(match.id)}>Try sending them again</button>
            <button type="button" className="btn btn-line" onClick={() => void discardRejected(match.id)}>Discard them</button>
          </div>
        </div>
      )}

      {correctingRound && (
        <RoundEntry round={correctingRound.round_no} names={names} initial={entryStart(correctingRound)} correcting hintsA={hintsFor('a', correctingRound.round_no)} hintsB={hintsFor('b', correctingRound.round_no)} busy={busy}
          onConfirm={(a, b, x) => void confirm(correctingRound, a, b, x)} onCancel={() => setCorrecting(null)} />
      )}

      {!correctingRound && zone === 'loading' && <p className="muted" role="status">Opening the lyst…</p>}

      {!correctingRound && zone === 'start' && (
        <button type="button" className="btn btn-win fq-big ly-go" disabled={timerBusy || lyst.offline} onClick={() => startRound(1)}>Start round 1 · {presetOf(presets, 'fight').seconds >= 60 ? `${Math.floor(roundSeconds(1, settings!, fightSeconds) / 60)}:${String(roundSeconds(1, settings!, fightSeconds) % 60).padStart(2, '0')}` : `${fightSeconds}s`}</button>
      )}

      {!correctingRound && zone === 'fighting' && !early && (
        <div className="ly-zone">
          <button type="button" className={`btn fq-big ly-go ${leftMs <= 0 ? 'btn-win is-urgent' : 'btn-ink'}`} disabled={timerBusy || lyst.offline} onClick={() => endRound('break')}>{leftMs <= 0 ? 'Time. End round and start the break' : 'End round · start break'}</button>
          <button type="button" className="ly-link" onClick={() => setEarly(true)}>Enter the score now without a break</button>
        </div>
      )}

      {!correctingRound && showEntry && entryRound && !pendingRound && (
        <RoundEntry round={entryRound.round_no} names={names} initial={null} correcting={false} hintsA={hintsFor('a', entryRound.round_no)} hintsB={hintsFor('b', entryRound.round_no)} busy={busy}
          onConfirm={(a, b, x) => void confirm(entryRound, a, b, x)} onCancel={early ? () => setEarly(false) : undefined} />
      )}

      {!correctingRound && pendingRound && (
        <section className="panel info ly-pending" role="status">
          <b>Round {pendingRound.round}: {pendingRound.a}–{pendingRound.b}</b>
          <span className="src">Saved on this device. Not official until the server has it{waiting > 0 ? `; ${waiting} waiting to send` : ''}.</span>
          <button type="button" className="btn btn-line" disabled={busy} onClick={() => void send()}>Send now</button>
        </section>
      )}

      {!correctingRound && zone === 'between' && !pendingRound && (
        <div className="ly-zone">
          {rule.decided && <p className="ly-hint-line" role="status">{names[rule.winner!]} lead by {Math.abs(totals.a - totals.b)} after {totals.rounds} rounds: the lead rule says the match can finish.</p>}
          {rule.extraRound && <p className="ly-hint-line" role="status">Level or close after {totals.rounds} rounds: an extra round of {roundSeconds(nextRoundNo, settings ?? { regular_rounds: 2, extra_round_seconds: 30 }, fightSeconds)} s decides it under the lead rule.</p>}
          <button type="button" className={`btn fq-big ly-go ${rule.decided ? 'btn-line' : 'btn-win'}`} disabled={timerBusy || lyst.offline} onClick={() => startRound(nextRoundNo)}>Start round {nextRoundNo} · {(() => { const s = roundSeconds(nextRoundNo, settings ?? { regular_rounds: 2, extra_round_seconds: 30 }, fightSeconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; })()}</button>
          <button type="button" className={`btn fq-big ly-go ${rule.decided ? 'btn-win' : 'btn-line'}`} disabled={!finishReady || busy} onClick={() => { setPhase('confirming'); setError(null); }}>Finish match</button>
          {timer?.mode === 'break' || timer?.mode === 'extended_break' ? null : <button type="button" className="ly-link" disabled={timerBusy || lyst.offline} onClick={() => endRound('extended_break')}>Start a long break</button>}
        </div>
      )}

      <nav className="ly-tools" aria-label="Lyst tools">
        <button type="button" className="btn btn-line ly-tool" onClick={() => setSheet('discipline')} disabled={!st || !cur}>Marshal's call{discipline.length ? ` · ${activeDiscipline(discipline).length}` : ''}</button>
        <button type="button" className="btn btn-line ly-tool" onClick={() => setSheet('counters')} disabled={!st}>Counters{st && st.seats.length ? ` · ${st.seats.length}` : ''}{st && st.requests.length ? ` (+${st.requests.length})` : ''}</button>
        <button type="button" className="btn btn-line ly-tool" onClick={() => setSheet('log')} disabled={!st}>Record</button>
        {canResolve && <button type="button" className="btn btn-line ly-tool" onClick={() => setSheet('settings')} disabled={!st}>Lyst settings</button>}
      </nav>
      {discipline.length > 0 && (
        <ul className="ly-recent" aria-label="Recent calls">
          {activeDiscipline(discipline).slice(-3).map(d => <li key={d.id}>{describeDiscipline(d, names)}</li>)}
        </ul>
      )}

      <div className="mactions sk-actions">
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button>
        <button type="button" className="btn btn-line fq-big" onClick={onClassic}>Use the classic scoreboard</button>
      </div>

      {sheet === 'discipline' && st && settings && <DisciplineSheet names={names} round={cur?.round_no ?? 1} settings={settings} calledByDefault={calledBy} busy={busy} onClose={() => setSheet(null)} onRecord={d => void recordDiscipline(d)} />}
      {sheet === 'counters' && st && <CountersPanel state={st} names={names} round={cur?.round_no ?? 1} eventSlug="" busy={busy} onClose={() => setSheet(null)}
        onNewCode={() => void seatAction(() => createJoinCode(eventId, fieldName))} onAssign={(seat, side, role) => void seatAction(() => assignSeat(seat, match.id, side, role))} onEnd={(seat, decline) => void seatAction(() => endSeat(seat, decline))} />}
      {sheet === 'log' && st && <LogPanel state={st} names={names} busy={busy} onVoid={(id, reason) => void voidIt(id, reason)} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && settings && <LystSettingsDialog eventId={eventId} settings={settings} onClose={() => setSheet(null)} onSaved={() => void lyst.refresh()} />}
    </div>
  );
}
