import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DuelBoard, GroupBoard, MarathonBoard, ProBoard, SeriesBoard } from '../ScoreBoards';
import { GroupCounterRounds } from './GroupCounterRounds';
import type { FieldCompetition } from '../../data/field';
import { fetchLystState } from '../../data/lyst';
import type { LystRound } from '../../lib/lyst/rounds';
import { groupRoundsAligned, recoverGroupBoard } from '../../lib/lyst/groupRecovery';
import { submitMatchResult, type CompetitionMatch } from '../../data/matches';
import { clearBoard, loadBoard, saveBoard } from '../../lib/boardStore';
import { sideLabel } from '../../lib/entryLabel';
import { boardModeFor, canOfferFinish, isNoSignalError, newBoard, perSideFor, resultFromBoard, resultSummary, type BoardState } from '../../lib/fieldScoring';
import { fieldLabel } from '../../lib/eventDay';
import { friendlyError } from '../../lib/friendlyError';
import { snapshotOf } from '../../lib/liveScoreSnapshot';
import { scoringGuard } from '../../lib/swUpdate';
import { useLiveScoreReporter } from '../../lib/useLiveScoreReporter';
import { useOutbox } from '../../lib/useOutbox';
import { trackEvent } from '../../lib/analytics';

export interface Opened { match: CompetitionMatch; comp: FieldCompetition; version: number }
type Phase = 'scoring' | 'confirming' | 'official' | 'pending' | 'review';
/** The one thing the scorer must never be unsure about. Exactly one of these is on screen at all times. */
type Status = 'scoring' | 'ready' | 'confirming' | 'saving' | 'official' | 'pending' | 'review';

const STATUS_TEXT: Record<Status, { word: string; line: string; tone: string }> = {
  scoring: { word: 'Scoring', line: 'Pending: not official until you save', tone: 'is-scoring' },
  ready: { word: 'Ready to confirm', line: 'The board has a result. Check it, then Finish match.', tone: 'is-ready' },
  confirming: { word: 'Check before you save', line: 'Pending: not official until you save', tone: 'is-ready' },
  saving: { word: 'Saving…', line: 'Contacting the server', tone: 'is-saving' },
  official: { word: 'Official', line: 'Official: saved on the server', tone: 'is-official' },
  pending: { word: 'Pending · no signal', line: 'Pending: NOT official yet', tone: 'is-pending' },
  review: { word: 'Needs review', line: 'Needs review: not changed', tone: 'is-review' }
};

export function StatusBanner({ status, line }: { status: Status; line?: string }) {
  const t = { ...STATUS_TEXT[status], ...(line ? { line } : {}) };
  return (
    <div className={`sk-status ${t.tone}`} role="status" aria-live="polite">
      <b>{t.word}</b><span>{t.line}</span>
    </div>
  );
}

const sideName = (m: CompetitionMatch) => ({ a: sideLabel(m.entryA, m.nameA, 'Side A'), b: sideLabel(m.entryB, m.nameB, 'Side B') });
const roundText = (m: CompetitionMatch) => `${m.roundLabel || m.stage}${m.pool ? ` · Pool ${m.pool}` : ''}`;

/** The two sides and the running score, the dominant element of the screen. The numbers come from the same snapshot the venue display gets. */
function ScoreStrip({ names, scoreA, scoreB, phase, decided, unit }: { names: Record<'a' | 'b', string>; scoreA: number; scoreB: number; phase: string; decided: 'a' | 'b' | 'draw' | null; unit: string }) {
  const lead = decided === 'a' || decided === 'b' ? decided : scoreA > scoreB ? 'a' : scoreB > scoreA ? 'b' : null;
  return (
    <section className="sk-score" aria-label="Score">
      {(['a', 'mid', 'b'] as const).map(k => k === 'mid'
        ? <div key="mid" className="sk-mid"><span className="sk-vs">vs</span><span className="sk-phase">{phase}</span><span className="sk-unit">{unit}</span></div>
        : (
          <div key={k} className={`sk-side ${k}${lead === k ? ' lead' : ''}${decided === k ? ' won' : ''}`}>
            <span className="sk-tag">{k === 'a' ? 'A' : 'B'}</span>
            <span className="sk-name">{names[k]}</span>
            <span className="sk-num" aria-label={`${names[k]}: ${k === 'a' ? scoreA : scoreB} ${unit}`}>{k === 'a' ? scoreA : scoreB}</span>
          </div>
        ))}
    </section>
  );
}

const UNIT: Record<BoardState['mode'], string> = { group: 'rounds', duel: 'points', pro: 'points', marathon: 'points', series: 'points' };

export interface ScoringScreenProps {
  secretary?: boolean;
  opened: Opened; eventId: string; userId: string; fieldName: string;
  /** The field's next fight once this one is official (the queue has advanced), so the scorer can go straight on. */
  nextFight: CompetitionMatch | null;
  backHref: { to: string; label: string } | null;
  onExit: () => void; onFinished: () => void; onOfficial: () => void; onOpenNext: (m: CompetitionMatch) => void; onStale: (message: string) => void;
  /** Duels only: switch back to the lyst screen (clock, rounds, marshal's call). */
  onLyst?: () => void;
}

/**
 * The fight, for the person standing beside the list. Same engine as before (boards, outbox, idempotent finalization, stale and conflict handling);
 * this screen only changes what they see: the sides and the score dominate, one status banner says exactly where the result stands, and when the
 * server confirms it the next fight is one tap away.
 */
export function ScoringScreen({ opened, eventId, userId, fieldName, nextFight, backHref, onExit, onFinished, onOfficial, onOpenNext, onStale, onLyst, secretary = false }: ScoringScreenProps) {
  const { match, comp, version } = opened;
  const mode = boardModeFor(comp.league, comp.category);
  const { waiting, record, drain, rejected, discardRejected, retryRejected } = useOutbox({ eventId });
  const names = sideName(match);
  const fresh = useCallback((): BoardState | null => (mode ? newBoard(mode, { perSide: perSideFor(comp.category), roundsToWin: comp.roundsToWin, seriesKind: comp.category === 'sabre' || comp.category === 'greatsword' ? comp.category : 'triathlon' }) : null), [mode, comp]);
  const [board, setBoard] = useState<BoardState | null | undefined>(undefined);   // undefined: still reading what was saved on this device
  const [groupRounds, setGroupRounds] = useState<readonly LystRound[] | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState(0);
  const commandId = useRef<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('scoring');
  // The board is long on a phone: when the screen changes to a confirm / official / pending / review step, start it at the top.
  useEffect(() => { if (phase !== 'scoring') window.scrollTo({ top: 0 }); }, [phase]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const mine = rejected.filter(e => e.subject === match.id);

  // While a scoring screen is open a waiting app update must not take over (see swUpdate.ts).
  useEffect(() => { scoringGuard.enter(); return () => scoringGuard.leave(); }, []);

  useEffect(() => {
    let live = true;
    if (!mode) { setBoard(null); return; }
    setRestoreError(null);
    void (async () => {
      const stored = await loadBoard(userId, eventId, match.id, mode);
      let restored = stored?.board ?? fresh();
      let recorded: readonly LystRound[] | null = null;
      let repaired = false;
      if (restored?.mode === 'group' && !stored?.review) {
        try {
          const { state } = await fetchLystState(match.id);
          recorded = state.rounds;
          const recovered = recoverGroupBoard(restored.s, recorded);
          repaired = recovered !== restored.s;
          restored = { mode: 'group', s: recovered };
        } catch (e) {
          if (!live) return;
          setRestoreError(friendlyError(e, 'Could not check recorded team rounds. Reconnect and try again before scoring.'));
          if (!stored) return;
        }
      }
      if (!live) return;
      commandId.current = repaired ? undefined : stored?.finalizeCommandId;
      if (repaired && restored) await saveBoard(userId, eventId, match.id, restored, { finalizeCommandId: null });
      if (!live) return;
      if (stored?.review === 'conflict') setPhase('review');
      setGroupRounds(recorded);
      setBoard(restored);
    })().catch(e => { if (live) setRestoreError(friendlyError(e)); });
    return () => { live = false; };
  }, [userId, eventId, match.id, mode, fresh, restoreKey]);

  const change = useCallback((next: BoardState) => { setBoard(next); void saveBoard(userId, eventId, match.id, next, { finalizeCommandId: commandId.current ?? null }); }, [userId, eventId, match.id]);
  const rec = useCallback((kind: string, payload: unknown) => { void record(kind, match.id, payload); }, [record, match.id]);
  const applyGroupRounds = useCallback((rounds: readonly LystRound[]) => {
    if (board?.mode !== 'group') return;
    try {
      const recovered = recoverGroupBoard(board.s, rounds);
      if (recovered !== board.s) { commandId.current = undefined; change({ mode: 'group', s: recovered }); }
      setGroupRounds(rounds); setRestoreError(null);
    } catch (e) { setRestoreError(friendlyError(e)); setGroupRounds(null); }
  }, [board, change]);
  const applyStanding = useCallback((side: 'a' | 'b', count: number) => {
    if (board?.mode !== 'group' || board.s.winner) return;
    const down = board.s.down[side].map((_, i) => i >= count);
    for (let i = 0; i < down.length; i++) if (down[i] !== board.s.down[side][i]) rec('group.fighter', { side, index: i, down: down[i] });
    change({ mode: 'group', s: { ...board.s, down: { ...board.s.down, [side]: down } } });
  }, [board, change, rec]);
  const groupReady = board?.mode !== 'group' || groupRounds !== null;
  let groupAligned = true;
  try { groupAligned = board?.mode !== 'group' || (groupRounds !== null && groupRoundsAligned(board.s, groupRounds)); }
  catch { groupAligned = false; }
  // The venue display follows the board while the fight is being scored or checked; never after the server has an answer.
  useLiveScoreReporter({ matchId: match.id, version, stage: match.stage, board: board ?? null, active: groupReady && (phase === 'scoring' || phase === 'confirming') });

  if (!mode) {
    return <section className="panel info"><h3>This competition has no scoring board yet</h3><p>The rules for {comp.name} are not loaded, so there is nothing to score here. Ask an organizer to enter the result.</p><button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button></section>;
  }
  if (board === undefined) return restoreError ? <section className="panel info"><p role="alert">{restoreError}</p><button type="button" className="btn btn-line" onClick={() => setRestoreKey(k => k + 1)}>Retry recorded rounds</button></section> : <p className="muted">Opening the scoreboard…</p>;
  if (board === null) return <section className="panel info"><h3>This competition has no scoring board yet</h3><button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button></section>;

  const outcome = resultFromBoard(board, match.stage);
  const snap = snapshotOf(board, match.stage);
  const unit = UNIT[board.mode];
  const context = <><h1 className="sr-only">{names.a} vs {names.b}</h1><p className="sk-ctx"><b>{fieldLabel(fieldName)}</b> · {comp.name} · {roundText(match)}</p></>;

  const save = async () => {
    if (!outcome.ok) return;
    setBusy(true); setError(null);
    try {
      if (board.mode === 'group') {
        const { state } = await fetchLystState(match.id);
        if (!groupRoundsAligned(board.s, state.rounds)) {
          applyGroupRounds(state.rounds); setPhase('scoring');
          setError('Recorded team rounds changed or are still being confirmed. Check the board before finishing.');
          return;
        }
      }
      const sent = await drain(match.id);
      if (!sent.clear) { trackEvent('result_pending_no_signal', { waiting: sent.remaining }); setError(`${sent.remaining} score ${sent.remaining === 1 ? 'action is' : 'actions are'} still waiting to send, so the result cannot be made official yet. Nothing is lost.`); setPhase('pending'); return; }
      // One command id per board: pressing Save again after a lost signal sends the SAME command, so it can never create a second result.
      if (!commandId.current) { commandId.current = crypto.randomUUID(); await saveBoard(userId, eventId, match.id, board, { finalizeCommandId: commandId.current }); }
      const v = outcome.value;
      let r;
      try { r = await submitMatchResult({ commandId: commandId.current, matchId: match.id, result: v.result, scoreA: v.scoreA, scoreB: v.scoreB, detail: v.detail, expectedVersion: version }); }
      catch (e) {
        if (isNoSignalError(e)) { trackEvent('result_pending_no_signal'); setPhase('pending'); return; }   // not official: nothing reached the server
        throw e;
      }
      if (r.status === 'accepted' || r.status === 'duplicate') {
        await clearBoard(userId, match.id);
        await discardRejected(match.id);
        setSaved(resultSummary(v, names.a, names.b));
        trackEvent('result_official', { outcome: r.status });
        setPhase('official');
        onOfficial();   // the queue has moved in the database: read it again so Next fight is right
      } else if (r.status === 'conflict') {
        await saveBoard(userId, eventId, match.id, board, { finalizeCommandId: commandId.current, review: 'conflict' });
        trackEvent('result_conflict');
        setPhase('review');
      } else {
        trackEvent('result_stale');
        await clearBoard(userId, match.id);   // the server keeps this device's result as evidence; the match itself changed
        onStale('This match changed after you opened it (a side was replaced or the result was reopened). Your result was sent to the head marshal for review and nothing was made official. The queue has been reloaded.');
      }
    } catch (e) {
      setError(friendlyError(e, 'Could not save the result. Your scoring is kept; try again.'));
    } finally { setBusy(false); }
  };

  if (phase === 'official' && saved) {
    const v = outcome.ok ? outcome.value : null;
    const winner = v ? (v.result === 'a' ? names.a : v.result === 'b' ? names.b : null) : null;
    const nextNames = nextFight ? sideName(nextFight) : null;
    return (
      <section className="panel sk-done" aria-label="Result official">
        {context}
        <StatusBanner status="official" />
        <div className="sk-final">
          {(['a', 'b'] as const).map(k => (
            <div key={k} className={`sk-fside${v && v.result === k ? ' won' : ''}`}>
              <span className="sk-name">{names[k]}</span>
              <span className="sk-num">{v ? (k === 'a' ? v.scoreA : v.scoreB) : snap[k === 'a' ? 'scoreA' : 'scoreB']}</span>
            </div>
          ))}
        </div>
        <p className="sk-winner">{winner ? <>Winner: <b>{winner}</b></> : <b>Draw</b>}{v?.result === 'draw' || !winner ? <span className="src"> · {saved}</span> : null}</p>
        <div className="sk-after">
          {nextFight && nextNames && (
            <button type="button" className="btn btn-ink fq-big" onClick={() => onOpenNext(nextFight)}>
              <span className="sk-after-k">Next fight on {fieldLabel(fieldName)}</span><span>{nextNames.a} vs {nextNames.b}</span>
            </button>
          )}
          {!nextFight && <p className="muted">Nothing is waiting on {fieldLabel(fieldName)} right now.</p>}
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
        <h2 className="sk-h">{outcome.ok ? resultSummary(outcome.value, names.a, names.b) : 'Result not ready'}</h2>
        <p>This result has not reached the server. Your scoring is saved on this device. Press Try again when you have signal.</p>
        <p><b>If the signal does not come back, write the result on the paper score sheet.</b> The paper sheet is the official record at this event; the head marshal can enter it later.</p>
        <div className="mactions">
          <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => setPhase('scoring')}>Back to scoring</button>
          <button type="button" className="btn btn-ink fq-big" disabled={busy} onClick={() => void save()}>{busy ? 'Trying…' : 'Try again'}</button>
        </div>
        {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
        {/* Pack 11: the next fight does not wait for the signal. The board and its command id stay on this device; open this fight again to save it. */}
        <p className="src">The next fight does not have to wait: this result stays on this device, marked pending, until you open this fight again and save it.</p>
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
        <button type="button" className="btn btn-ink fq-big" onClick={async () => { await clearBoard(userId, match.id); onFinished(); }}>I have told the head marshal: back to the queue</button>
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue (keep this on the device)</button>
      </section>
    );
  }

  if (phase === 'confirming') {
    return (
      <section className="panel sk-done" aria-label="Confirm result">
        {context}
        <StatusBanner status={busy ? 'saving' : 'confirming'} />
        {outcome.ok ? (
          <>
            <h2 className="sk-h">{resultSummary(outcome.value, names.a, names.b)}</h2>
            <div className="sk-final">
              {(['a', 'b'] as const).map(k => <div key={k} className={`sk-fside${outcome.value.result === k ? ' won' : ''}`}><span className="sk-name">{names[k]}</span><span className="sk-num">{k === 'a' ? outcome.value.scoreA : outcome.value.scoreB}</span></div>)}
            </div>
            <p className="src">{match.stage === 'pool' || match.stage === 'round_robin' ? 'Pool match.' : 'Elimination match: the winner moves on automatically.'} The result is only <b>official</b> once the server confirms it, and that needs signal. Only an organizer or the head marshal can change it afterwards.</p>
          </>
        ) : <p role="alert">{outcome.reason}</p>}
        {waiting > 0 && <p className="src">{waiting} saved on this device. They are sent first, then the result.</p>}
        {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
        <div className="mactions">
          <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => { setPhase('scoring'); setError(null); }}>Back to scoring</button>
          <button type="button" className="btn btn-win fq-big" disabled={busy || !outcome.ok} onClick={() => void save()}>{busy ? 'Saving…' : 'Save result'}</button>
        </div>
      </section>
    );
  }

  const ready = canOfferFinish(board, match.stage) && outcome.ok && groupAligned;
  return (
    <div className="sk field-run">
      {context}
      <StatusBanner status={ready ? 'ready' : 'scoring'} />
      {restoreError && <p role="alert">{restoreError}</p>}
      <ScoreStrip names={names} scoreA={snap.scoreA} scoreB={snap.scoreB} phase={snap.phase} decided={snap.decided} unit={unit} />
      {mine.length > 0 && (
        <div className="panel info" role="alert" style={{ gap: 8 }}>
          <b>{mine.length} score {mine.length === 1 ? 'action was' : 'actions were'} refused by the server</b>
          <span className="src">{mine[0].error ?? 'For example you may not have permission, or the match was already final.'} They are kept here until you decide. Check the totals before you finish.</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-line" onClick={() => void retryRejected(match.id)}>Try sending them again</button>
            <button type="button" className="btn btn-line" onClick={() => void discardRejected(match.id)}>Discard them</button>
          </div>
        </div>
      )}
      {board.mode === 'group' && <GroupBoard state={board.s} onChange={s => change({ mode: 'group', s })} record={rec} names={names} />}
      {board.mode === 'group' && <GroupCounterRounds key={`${userId}:${match.id}`} matchId={match.id} eventId={eventId} fieldName={fieldName} userKey={userId} board={board.s} secretary={secretary} names={names} onRounds={applyGroupRounds} onStanding={applyStanding} />}
      {board.mode === 'duel' && <DuelBoard headless state={board.s} onChange={s => change({ mode: 'duel', s })} record={rec} names={names} />}
      {board.mode === 'pro' && <ProBoard headless state={board.s} onChange={s => change({ mode: 'pro', s })} record={rec} names={names} />}
      {board.mode === 'marathon' && <MarathonBoard headless state={board.s} onChange={s => change({ mode: 'marathon', s })} record={rec} names={names} stage={match.stage} />}
      {board.mode === 'series' && <SeriesBoard headless state={board.s} onChange={s => change({ mode: 'series', s })} record={rec} names={names} stage={match.stage} />}
      <div className="mactions sk-actions">
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button>
        {onLyst && <button type="button" className="btn btn-line fq-big" onClick={onLyst}>Use the lyst screen</button>}
        <button type="button" className={`btn fq-big ${ready ? 'btn-win' : 'btn-ink'}`} disabled={!canOfferFinish(board, match.stage) || !groupAligned} onClick={() => { setPhase('confirming'); setError(null); }}>Finish match</button>
      </div>
    </div>
  );
}
