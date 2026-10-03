import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { DuelBoard, GroupBoard, MarathonBoard, ProBoard, SeriesBoard } from '../components/ScoreBoards';
import { Chip, PageHead } from '../components/ui';
import { fetchEvent, fetchMyEventContext, type LiveEvent } from '../data/api';
import { fetchEventMatches, fetchFieldCompetitions, type FieldCompetition } from '../data/field';
import { sideLabel } from '../lib/entryLabel';
import { setQueue, submitMatchResult, type CompetitionMatch } from '../data/matches';
import { EnterOfficialResult, ResultConflicts } from '../components/ResultReview';
import { clearBoard, loadBoard, saveBoard } from '../lib/boardStore';
import {
  QUEUE_LABEL, boardModeFor, canOfferFinish, fieldQueue, isNoSignalError, newBoard, perSideFor, resultFromBoard, resultSummary,
  type BoardState
} from '../lib/fieldScoring';
import { friendlyError } from '../lib/friendlyError';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOutbox } from '../lib/useOutbox';
import { NotFoundPage } from './NotFoundPage';

/** Mirrors private.can_score: organizer, marshal, scorekeeper, plus the platform owner. The database enforces it again on every call. */
const SCORE_ROLES = ['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'owner'];
/** Mirrors private.can_resolve_results: who may settle a disagreement or enter an official result from paper. */
const RESOLVE_ROLES = ['organizer', 'head_marshal', 'owner'];
const POLL_MS = 10000;

const wrap = { whiteSpace: 'normal', textAlign: 'left', maxWidth: '100%' } as const;
function SyncBar({ waiting, stuck = 0, heldForOthers = 0, durable = true }: { waiting: number; stuck?: number; heldForOthers?: number; durable?: boolean }) {
  return (
    <div className="syncbar" role="status" style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
      <span className={`chip ${waiting ? 'brass' : 'win'}`} style={wrap}>{waiting ? `Pending: ${waiting} score ${waiting === 1 ? 'action' : 'actions'} saved on this device, not yet confirmed by the server` : 'All score actions confirmed by the server'}</span>
      {stuck > 0 && <span className="chip brass" role="alert" style={wrap}>{stuck} still not sent after many tries. Check your signal and sign-in, or tell an organizer.</span>}
      {heldForOthers > 0 && <span className="chip brass" role="alert" style={wrap}>{heldForOthers} saved on this device belong to another account and are not sent while you are signed in as yourself.</span>}
      {!durable && <span className="chip brass" role="alert" style={wrap}>This browser cannot save scoring on the device. Keep the paper score sheet up to date.</span>}
    </div>
  );
}

const sideName = (m: CompetitionMatch) => ({ a: sideLabel(m.entryA, m.nameA, 'Side A'), b: sideLabel(m.entryB, m.nameB, 'Side B') });

function QueueRow({ m, comp, busy, onOpen }: { m: CompetitionMatch; comp: FieldCompetition | undefined; busy: boolean; onOpen: () => void }) {
  const n = sideName(m);
  const ready = m.entryA !== null && m.entryB !== null;
  return (
    <button type="button" className="panel info fq-row" disabled={busy || !ready} onClick={onOpen} aria-label={`Score ${n.a} against ${n.b}`}>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip tone={m.queueState === 'active' ? 'live' : m.queueState === 'on_deck' ? 'brass' : ''}>{QUEUE_LABEL[m.queueState]}</Chip>
        <span className="src">{comp?.name ?? 'Competition'} · {m.roundLabel || m.stage}{m.pool ? ` · Pool ${m.pool}` : ''}</span>
      </span>
      <b className="fq-names">{n.a} <span style={{ color: 'var(--faint)' }}>vs</span> {n.b}</b>
      {!ready && <span className="src">{m.stage === 'third_place' && !m.entryA && !m.entryB ? 'Waiting for the semifinals to finish' : 'Waiting for an earlier match to decide the other side.'}</span>}
      {ready && <span className="src">{m.queueState === 'active' ? 'Tap to continue scoring' : 'Tap to start scoring'}</span>}
    </button>
  );
}

interface Opened { match: CompetitionMatch; comp: FieldCompetition; version: number }
type Phase = 'scoring' | 'confirming' | 'official' | 'pending' | 'review';

function Scoring({ opened, eventId, userId, onExit, onFinished, onStale }: { opened: Opened; eventId: string; userId: string; onExit: () => void; onFinished: () => void; onStale: (message: string) => void }) {
  const { match, comp, version } = opened;
  const mode = boardModeFor(comp.league, comp.category);
  const { waiting, record, drain, rejected, discardRejected, retryRejected } = useOutbox({ eventId });
  const names = sideName(match);
  const fresh = useCallback((): BoardState | null => (mode ? newBoard(mode, { perSide: perSideFor(comp.category), roundsToWin: comp.roundsToWin, seriesKind: comp.category === 'sabre' || comp.category === 'greatsword' ? comp.category : 'triathlon' }) : null), [mode, comp]);
  const [board, setBoard] = useState<BoardState | null | undefined>(undefined);   // undefined: still reading what was saved on this device
  const commandId = useRef<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('scoring');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const mine = rejected.filter(e => e.subject === match.id);

  useEffect(() => {
    let live = true;
    if (!mode) { setBoard(null); return; }
    void loadBoard(userId, eventId, match.id, mode).then(stored => {
      if (!live) return;
      commandId.current = stored?.finalizeCommandId;
      if (stored?.review === 'conflict') setPhase('review');
      setBoard(stored?.board ?? fresh());
    });
    return () => { live = false; };
  }, [userId, eventId, match.id, mode, fresh]);

  const change = useCallback((next: BoardState) => { setBoard(next); void saveBoard(userId, eventId, match.id, next, { finalizeCommandId: commandId.current }); }, [userId, eventId, match.id]);
  const rec = useCallback((kind: string, payload: unknown) => { void record(kind, match.id, payload); }, [record, match.id]);

  if (!mode) {
    return <section className="panel info"><h3>This competition has no scoring board yet</h3><p>The rules for {comp.name} are not loaded, so there is nothing to score here. Ask an organizer to enter the result.</p><button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button></section>;
  }
  if (board === undefined) return <p className="muted">Opening the scoreboard…</p>;
  if (board === null) return <section className="panel info"><h3>This competition has no scoring board yet</h3><button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button></section>;

  const outcome = resultFromBoard(board, match.stage);

  const save = async () => {
    if (!outcome.ok) return;
    setBusy(true); setError(null);
    try {
      const sent = await drain(match.id);
      if (!sent.clear) { setError(`${sent.remaining} score ${sent.remaining === 1 ? 'action is' : 'actions are'} still waiting to send, so the result cannot be made official yet. Nothing is lost.`); setPhase('pending'); return; }
      // One command id per board: pressing Save again after a lost signal sends the SAME command, so it can never create a second result.
      if (!commandId.current) { commandId.current = crypto.randomUUID(); await saveBoard(userId, eventId, match.id, board, { finalizeCommandId: commandId.current }); }
      const v = outcome.value;
      let r;
      try { r = await submitMatchResult({ commandId: commandId.current, matchId: match.id, result: v.result, scoreA: v.scoreA, scoreB: v.scoreB, detail: v.detail, expectedVersion: version }); }
      catch (e) {
        if (isNoSignalError(e)) { setPhase('pending'); return; }   // not official: nothing reached the server
        throw e;
      }
      if (r.status === 'accepted' || r.status === 'duplicate') {
        await clearBoard(userId, match.id);
        await discardRejected(match.id);
        setSaved(resultSummary(v, names.a, names.b));
        setPhase('official');
      } else if (r.status === 'conflict') {
        await saveBoard(userId, eventId, match.id, board, { finalizeCommandId: commandId.current, review: 'conflict' });
        setPhase('review');
      } else {
        await clearBoard(userId, match.id);   // the server keeps this device's result as evidence; the match itself changed
        onStale('This match changed after you opened it (a side was replaced or the result was reopened). Your result was sent to the head marshal for review and nothing was made official. The queue has been reloaded.');
      }
    } catch (e) {
      setError(friendlyError(e, 'Could not save the result. Your scoring is kept; try again.'));
    } finally { setBusy(false); }
  };

  if (phase === 'official' && saved) {
    return (
      <section className="panel mboard" style={{ textAlign: 'center', justifyItems: 'center' }}>
        <Chip tone="win">Official: saved on the server</Chip>
        <h2 style={{ fontSize: 36 }}>{saved}</h2>
        <button type="button" className="btn btn-ink fq-big" onClick={onFinished}>Back to the queue</button>
      </section>
    );
  }

  if (phase === 'pending') {
    return (
      <section className="panel mboard" aria-label="Result pending" style={{ justifyItems: 'center', textAlign: 'center' }}>
        <Chip tone="brass">Pending: NOT official yet</Chip>
        <h2 style={{ fontSize: 30 }}>{outcome.ok ? resultSummary(outcome.value, names.a, names.b) : 'Result not ready'}</h2>
        <p>This result has not reached the server. Your scoring is saved on this device. Press Try again when you have signal.</p>
        <p><b>If the signal does not come back, write the result on the paper score sheet.</b> The paper sheet is the official record at this event; the head marshal can enter it later.</p>
        <div className="mactions">
          <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => setPhase('scoring')}>Back to scoring</button>
          <button type="button" className="btn btn-ink fq-big" disabled={busy} onClick={() => void save()}>{busy ? 'Trying…' : 'Try again'}</button>
        </div>
        {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
      </section>
    );
  }

  if (phase === 'review') {
    return (
      <section className="panel mboard" aria-label="Result needs review" style={{ justifyItems: 'center', textAlign: 'center' }}>
        <Chip tone="brass">Needs review: not changed</Chip>
        <h2 style={{ fontSize: 28 }}>A different result is already official for this match</h2>
        <p>Another device saved a different result first. Yours was <b>kept, not discarded</b>, and nothing was overwritten. Tell the head marshal. They can compare both with the paper sheet and decide.</p>
        <button type="button" className="btn btn-ink fq-big" onClick={async () => { await clearBoard(userId, match.id); onFinished(); }}>I have told the head marshal: back to the queue</button>
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue (keep this on the device)</button>
      </section>
    );
  }

  if (phase === 'confirming') {
    return (
      <section className="panel mboard" aria-label="Confirm result">
        <span className="eyebrow">Check before you save</span>
        {outcome.ok ? (
          <>
            <h2 style={{ fontSize: 36 }}>{resultSummary(outcome.value, names.a, names.b)}</h2>
            <div className="mteams">
              {(['a', 'b'] as const).map(s => (
                <div className="dside" key={s}><div className="n">{names[s]}</div><div className="dscore mono">{s === 'a' ? outcome.value.scoreA : outcome.value.scoreB}</div></div>
              ))}
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

  return (
    <div style={{ display: 'grid', gap: 14 }} className="field-run">
      <div className="mhead">
        <div><p className="eyebrow">{comp.name} · {match.roundLabel || match.stage}{match.pool ? ` · Pool ${match.pool}` : ''}</p><h1 style={{ fontSize: 34, marginTop: 6 }}>{names.a} vs {names.b}</h1></div>
        <span className="chip brass" style={wrap}>Pending: not official until you save</span>
      </div>
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
      {board.mode === 'duel' && <DuelBoard state={board.s} onChange={s => change({ mode: 'duel', s })} record={rec} names={names} />}
      {board.mode === 'pro' && <ProBoard state={board.s} onChange={s => change({ mode: 'pro', s })} record={rec} names={names} />}
      {board.mode === 'marathon' && <MarathonBoard state={board.s} onChange={s => change({ mode: 'marathon', s })} record={rec} names={names} stage={match.stage} />}
      {board.mode === 'series' && <SeriesBoard state={board.s} onChange={s => change({ mode: 'series', s })} record={rec} names={names} stage={match.stage} />}
      <div className="mactions">
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button>
        <button type="button" className="btn btn-ink fq-big" disabled={!canOfferFinish(board, match.stage)} onClick={() => { setPhase('confirming'); setError(null); }}>Finish match</button>
      </div>
    </div>
  );
}

export function FieldPage() {
  const { eventId: slug = '', field: rawField = '' } = useParams();
  const field = rawField.trim();
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id;
  const { waiting, stuck, heldForOthers, durable } = useOutbox();
  const [reloadKey, setReloadKey] = useState(0);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const loaded = useAsync(() => fetchEvent(slug), [slug]);
  const event: LiveEvent | undefined = loaded.data?.event;
  const eventId = event?.id;
  const mine = useAsync(() => (eventId && userId ? fetchMyEventContext(eventId, userId) : Promise.resolve(undefined)), [eventId, userId]);
  const canScore = mine.data?.roles.some(r => SCORE_ROLES.includes(r)) === true;
  const canResolve = mine.data?.roles.some(r => RESOLVE_ROLES.includes(r)) === true;
  const comps = useAsync(() => (eventId && canScore ? fetchFieldCompetitions(eventId) : Promise.resolve([] as FieldCompetition[])), [eventId, canScore]);
  const matches = useAsync(() => (comps.data?.length ? fetchEventMatches(comps.data) : Promise.resolve([] as CompetitionMatch[])), [comps.data, reloadKey]);
  useDocumentTitle(event ? `${field} · ${event.name}` : 'Field scoring');

  // Keep the queue fresh: poll, and reload when anybody changes a match (realtime is a nudge, polling is the safety net).
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!canScore) return;
    const poll = window.setInterval(() => { if (!document.hidden) reload(); }, POLL_MS);
    const nudge = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(reload, 500); };
    const channel = supabase.channel(`field-${slug}-${field}`).on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, nudge).subscribe();
    return () => { window.clearInterval(poll); window.clearTimeout(timer.current); void supabase.removeChannel(channel); };
  }, [canScore, slug, field, reload]);

  const compById = useMemo(() => new Map((comps.data ?? []).map(c => [c.id, c])), [comps.data]);
  const queue = useMemo(() => fieldQueue(matches.data ?? [], field), [matches.data, field]);

  const open = async (m: CompetitionMatch) => {
    const comp = compById.get(m.competitionId);
    if (!comp) return;
    setOpening(true); setOpenError(null); setNotice(null);
    try {
      if (m.queueState !== 'active') await setQueue(m.id, 'active', field);
      // Read it fresh so the version we finalize against is the one we actually scored.
      const fresh = (await fetchEventMatches([comp])).find(x => x.id === m.id);
      if (!fresh || fresh.queueState === 'final') { setNotice('That match is already final.'); reload(); return; }
      setOpened({ match: fresh, comp, version: fresh.version });
      reload();
    } catch (e) { setOpenError(friendlyError(e)); } finally { setOpening(false); }
  };

  if (authLoading || (loaded.loading && !loaded.data)) return <p className="muted">Loading…</p>;
  if (loaded.error != null) return <p role="alert">{friendlyError(loaded.error)}</p>;
  if (!loaded.data || !event) return <NotFoundPage />;
  if (!session) return <><PageHead eyebrow="Field scoring" title={`${event.name} · ${field}`} /><SignIn reason="Sign in with the account that scores this event." /></>;
  if (mine.loading && !mine.data) return <p className="muted">Loading…</p>;
  if (!canScore) {
    return (
      <section style={{ display: 'grid', gap: 14 }}>
        <PageHead eyebrow="Field scoring" title="This area is for scorekeepers and marshals" lede="Ask an organizer of this event to add your account as a marshal or scorekeeper." />
        <Link className="btn btn-line" to={`/events/${event.slug}`}>Back to the event</Link>
      </section>
    );
  }

  return (
    <section className="marshal fade-in">
      <SyncBar waiting={waiting} stuck={stuck} heldForOthers={heldForOthers} durable={durable} />
      {opened ? (
        <Scoring
          key={opened.match.id}
          opened={opened}
          eventId={event.id}
          userId={session.user.id}
          onExit={() => { setOpened(null); reload(); }}
          onFinished={() => { setOpened(null); reload(); }}
          onStale={message => { setOpened(null); setNotice(message); reload(); }}
        />
      ) : (
        <>
          <PageHead eyebrow={event.name} title={field} lede="Matches for this field, in running order. Pick one to start scoring." />
          {notice && <p role="alert" className="panel info">{notice}</p>}
          {canResolve && <ResultConflicts eventId={event.id} onChanged={reload} />}
          {openError && <p role="alert" style={{ color: 'var(--live)' }}>{openError}</p>}
          {(comps.error != null || matches.error != null) && <p role="alert">{friendlyError(comps.error ?? matches.error, 'Could not load the queue. Retrying.')}</p>}
          {(comps.loading || matches.loading) && !matches.data && <p className="muted">Loading the queue…</p>}
          {matches.data && queue.length === 0 && (
            <div className="panel info"><h3>Nothing queued on {field}</h3><p>Matches show here once an organizer puts them on deck, in the hole or active for this field.</p></div>
          )}
          <div style={{ display: 'grid', gap: 12 }}>
            {queue.map(m => <QueueRow key={m.id} m={m} comp={compById.get(m.competitionId)} busy={opening} onOpen={() => void open(m)} />)}
          </div>
          {canResolve && <EnterOfficialResult matches={matches.data ?? []} names={new Map((comps.data ?? []).map(c => [c.id, c.name]))} onDone={reload} />}
          <Link className="more" to={`/events/${event.slug}`}>← Back to the event</Link>
        </>
      )}
    </section>
  );
}
