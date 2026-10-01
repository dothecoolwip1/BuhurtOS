import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { DuelBoard, GroupBoard, MarathonBoard, ProBoard, SeriesBoard } from '../components/ScoreBoards';
import { Chip, PageHead } from '../components/ui';
import { fetchEvent, fetchMyEventContext, type LiveEvent } from '../data/api';
import { fetchEventMatches, fetchFieldCompetitions, type FieldCompetition } from '../data/field';
import { sideLabel } from '../lib/entryLabel';
import { finalizeMatch, setQueue, type CompetitionMatch } from '../data/matches';
import { clearBoard, loadBoard, saveBoard } from '../lib/boardStore';
import {
  QUEUE_LABEL, boardModeFor, canOfferFinish, fieldQueue, isAlreadyFinalError, isStaleVersionError, newBoard, perSideFor, resultFromBoard, resultSummary,
  type BoardState
} from '../lib/fieldScoring';
import { friendlyError } from '../lib/friendlyError';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOutbox } from '../lib/useOutbox';
import { NotFoundPage } from './NotFoundPage';

/** Mirrors private.can_score: organizer, marshal, scorekeeper, plus the platform owner. The database enforces it again on every call. */
const SCORE_ROLES = ['organizer', 'marshal', 'scorekeeper', 'owner'];
const POLL_MS = 10000;

function SyncBar({ waiting, stuck = 0 }: { waiting: number; stuck?: number }) {
  return (
    <div className="syncbar" role="status">
      <span className={`chip ${waiting ? 'brass' : 'win'}`}>{waiting ? `${waiting} saved on this device, waiting for signal` : 'All saved and synced'}</span>
      {stuck > 0 && <span className="chip brass" role="alert">{stuck} still not sent after many tries. Check your signal and sign-in, or tell an organizer.</span>}
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

function Scoring({ opened, onExit, onFinished, onStale }: { opened: Opened; onExit: () => void; onFinished: () => void; onStale: (message: string) => void }) {
  const { match, comp, version } = opened;
  const mode = boardModeFor(comp.league, comp.category);
  const { waiting, record, drain, rejected, dismissRejected } = useOutbox();
  const names = sideName(match);
  const [board, setBoard] = useState<BoardState | null>(() => (mode ? loadBoard(match.id, mode) ?? newBoard(mode, { perSide: perSideFor(comp.category), roundsToWin: comp.roundsToWin, seriesKind: comp.category === 'sabre' || comp.category === 'greatsword' ? comp.category : 'triathlon' }) : null));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const mine = rejected.filter(e => e.subject === match.id);

  const change = useCallback((next: BoardState) => { setBoard(next); saveBoard(match.id, next); }, [match.id]);
  const rec = useCallback((kind: string, payload: unknown) => { void record(kind, match.id, payload); }, [record, match.id]);

  if (!mode || !board) {
    return <section className="panel info"><h3>This competition has no scoring board yet</h3><p>The rules for {comp.name} are not loaded, so there is nothing to score here. Ask an organizer to enter the result.</p><button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button></section>;
  }

  const outcome = resultFromBoard(board, match.stage);

  const save = async () => {
    if (!outcome.ok) return;
    setBusy(true); setError(null);
    try {
      const sent = await drain(match.id);
      if (!sent.clear) { setError(`${sent.remaining} score ${sent.remaining === 1 ? 'action is' : 'actions are'} still waiting to send. Check your signal and try again. Nothing is lost.`); return; }
      const v = outcome.value;
      await finalizeMatch({ matchId: match.id, result: v.result, scoreA: v.scoreA, scoreB: v.scoreB, detail: v.detail, expectedVersion: version });
      clearBoard(match.id);
      dismissRejected(match.id);
      setSaved(resultSummary(v, names.a, names.b));
    } catch (e) {
      if (isStaleVersionError(e) || isAlreadyFinalError(e)) { clearBoard(match.id); onStale(`${friendlyError(e)} The queue has been reloaded.`); return; }
      setError(friendlyError(e, 'Could not save the result. Your scoring is kept; try again.'));
    } finally { setBusy(false); }
  };

  if (saved) {
    return (
      <section className="panel mboard" style={{ textAlign: 'center', justifyItems: 'center' }}>
        <Chip tone="win">Result saved</Chip>
        <h2 style={{ fontSize: 36 }}>{saved}</h2>
        <button type="button" className="btn btn-ink fq-big" onClick={onFinished}>Back to the queue</button>
      </section>
    );
  }

  if (confirming) {
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
            <p className="src">{match.stage === 'pool' || match.stage === 'round_robin' ? 'Pool match.' : 'Elimination match: the winner moves on automatically.'} Saving ends the match for everyone. Only an organizer can reopen it.</p>
          </>
        ) : <p role="alert">{outcome.reason}</p>}
        {waiting > 0 && <p className="src">{waiting} saved on this device. They are sent first, then the result.</p>}
        {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
        <div className="mactions">
          <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => { setConfirming(false); setError(null); }}>Back to scoring</button>
          <button type="button" className="btn btn-win fq-big" disabled={busy || !outcome.ok} onClick={() => void save()}>{busy ? 'Saving…' : 'Save result'}</button>
        </div>
      </section>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }} className="field-run">
      <div className="mhead">
        <div><p className="eyebrow">{comp.name} · {match.roundLabel || match.stage}{match.pool ? ` · Pool ${match.pool}` : ''}</p><h1 style={{ fontSize: 34, marginTop: 6 }}>{names.a} vs {names.b}</h1></div>
      </div>
      {mine.length > 0 && (
        <div className="panel info" role="alert" style={{ gap: 8 }}>
          <b>{mine.length} score {mine.length === 1 ? 'action was' : 'actions were'} refused by the server</b>
          <span className="src">For example you may not have permission, or the match was already final. Check the totals before you finish.</span>
          <button type="button" className="btn btn-line" onClick={() => dismissRejected(match.id)}>Dismiss</button>
        </div>
      )}
      {board.mode === 'group' && <GroupBoard state={board.s} onChange={s => change({ mode: 'group', s })} record={rec} names={names} />}
      {board.mode === 'duel' && <DuelBoard state={board.s} onChange={s => change({ mode: 'duel', s })} record={rec} names={names} />}
      {board.mode === 'pro' && <ProBoard state={board.s} onChange={s => change({ mode: 'pro', s })} record={rec} names={names} />}
      {board.mode === 'marathon' && <MarathonBoard state={board.s} onChange={s => change({ mode: 'marathon', s })} record={rec} names={names} stage={match.stage} />}
      {board.mode === 'series' && <SeriesBoard state={board.s} onChange={s => change({ mode: 'series', s })} record={rec} names={names} stage={match.stage} />}
      <div className="mactions">
        <button type="button" className="btn btn-line fq-big" onClick={onExit}>Back to the queue</button>
        <button type="button" className="btn btn-ink fq-big" disabled={!canOfferFinish(board, match.stage)} onClick={() => { setConfirming(true); setError(null); }}>Finish match</button>
      </div>
    </div>
  );
}

export function FieldPage() {
  const { eventId: slug = '', field: rawField = '' } = useParams();
  const field = rawField.trim();
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id;
  const { waiting, stuck } = useOutbox();
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
      <SyncBar waiting={waiting} stuck={stuck} />
      {opened ? (
        <Scoring
          key={opened.match.id}
          opened={opened}
          onExit={() => { setOpened(null); reload(); }}
          onFinished={() => { setOpened(null); reload(); }}
          onStale={message => { setOpened(null); setNotice(message); reload(); }}
        />
      ) : (
        <>
          <PageHead eyebrow={event.name} title={field} lede="Matches for this field, in running order. Pick one to start scoring." />
          {notice && <p role="alert" className="panel info">{notice}</p>}
          {openError && <p role="alert" style={{ color: 'var(--live)' }}>{openError}</p>}
          {(comps.error != null || matches.error != null) && <p role="alert">{friendlyError(comps.error ?? matches.error, 'Could not load the queue. Retrying.')}</p>}
          {(comps.loading || matches.loading) && !matches.data && <p className="muted">Loading the queue…</p>}
          {matches.data && queue.length === 0 && (
            <div className="panel info"><h3>Nothing queued on {field}</h3><p>Matches show here once an organizer puts them on deck, in the hole or active for this field.</p></div>
          )}
          <div style={{ display: 'grid', gap: 12 }}>
            {queue.map(m => <QueueRow key={m.id} m={m} comp={compById.get(m.competitionId)} busy={opening} onOpen={() => void open(m)} />)}
          </div>
          <Link className="more" to={`/events/${event.slug}`}>← Back to the event</Link>
        </>
      )}
    </section>
  );
}
