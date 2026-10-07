import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { Chip, PageHead } from '../components/ui';
import { fetchEvent, fetchMyEventContext, type LiveEvent } from '../data/api';
import { fetchEventMatches, fetchFieldCompetitions, type FieldCompetition } from '../data/field';
import { sideLabel } from '../lib/entryLabel';
import { setQueue, type CompetitionMatch } from '../data/matches';
import { moveMatchInQueue, type QueueMove } from '../data/eventDay';
import { EnterOfficialResult, ResultConflicts } from '../components/ResultReview';
import { QUEUE_LABEL, fieldQueue } from '../lib/fieldScoring';
import { ScoringScreen, type Opened } from '../components/scoring/ScoringScreen';
import { LystScoring } from '../components/lyst/LystScoring';
import { ReadinessStrip } from '../components/ReadinessStrip';
import { boardModeFor } from '../lib/fieldScoring';
import { friendlyError } from '../lib/friendlyError';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOutbox } from '../lib/useOutbox';
import { realtimeFilter } from '../lib/liveSync';
import { fieldOverview } from '../lib/fieldOverview';
import { NotFoundPage } from './NotFoundPage';
import { realtimeChannel } from '../lib/realtimeChannel';
import { useFocusBar } from '../components/FocusLayout';
import { fieldLabel } from '../lib/eventDay';

/** Mirrors private.can_score: organizer, marshal, scorekeeper, plus the platform owner. The database enforces it again on every call. */
const SCORE_ROLES = ['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'owner', 'operator'];
/** Mirrors private.can_resolve_results: who may settle a disagreement or enter an official result from paper. */
const RESOLVE_ROLES = ['organizer', 'head_marshal', 'owner', 'operator'];
/** Mirrors private.can_adjust_queue (Pack 18.1): who may change the running order. The head marshal and marshals may not; an event admin (Temporary Organizer) is an operator. */
const QUEUE_ROLES = ['organizer', 'owner', 'scorekeeper', 'operator'];
const POLL_MS = 10000;
/** Duels are scored through Lyst Control (clock, rounds, marshal's call). A marshal can fall back to the classic board; the choice is remembered on this device only. */
const LYST_MODE_KEY = 'bos-lyst-mode';
const readClassic = () => { try { return localStorage.getItem(LYST_MODE_KEY) === 'classic'; } catch { return false; } };
const writeClassic = (v: boolean) => { try { localStorage.setItem(LYST_MODE_KEY, v ? 'classic' : 'lyst'); } catch { /* ignore */ } };

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

interface Adjust { canEarlier: boolean; canLater: boolean; onMove: (action: QueueMove) => void }

/** The fight was finished on another device while this board was open: show the official result, offer the next fight, change nothing. */
function FinalElsewhere({ m, fieldName, nextFight, onOpenNext, onBack }: { m: CompetitionMatch; fieldName: string; nextFight: CompetitionMatch | null; onOpenNext: (m: CompetitionMatch) => void; onBack: () => void }) {
  const n = sideName(m);
  const score = m.scoreA !== null && m.scoreB !== null ? `${m.scoreA}–${m.scoreB}` : null;
  const summary = m.result === 'draw' ? `Draw${score ? `, ${score}` : ''}` : m.result === 'a' || m.result === 'b' ? `${m.result === 'a' ? n.a : n.b} win${score ? `, ${score}` : ''}` : 'Result recorded';
  const next = nextFight ? sideName(nextFight) : null;
  return (
    <section className="panel info" aria-label="This fight is final" style={{ display: 'grid', gap: 12 }} data-testid="final-elsewhere">
      <h2 style={{ margin: 0 }}>This fight is final</h2>
      <p style={{ margin: 0 }}><b>{n.a} vs {n.b}</b>: {summary}. It was finished on another device. The result stands; nothing on this screen can change it. If it is wrong, an organizer corrects it from Live ops.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {nextFight && next && <button type="button" className="btn btn-ink fq-big" onClick={() => onOpenNext(nextFight)}><span className="sk-after-k">Next fight on {fieldLabel(fieldName)}</span><span>{next.a} vs {next.b}</span></button>}
        <button type="button" className="btn btn-line fq-big" onClick={onBack}>Back to the queue</button>
      </div>
    </section>
  );
}

function QueueRow({ m, comp, busy, onOpen, adjust }: { m: CompetitionMatch; comp: FieldCompetition | undefined; busy: boolean; onOpen: () => void; adjust?: Adjust }) {
  const n = sideName(m);
  const ready = m.entryA !== null && m.entryB !== null;
  const row = (
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
  if (!adjust) return row;
  // Running-order controls sit beside the row, not inside it (a button cannot hold buttons). Only for a fight that is waiting: one being fought stays put.
  const label = `${n.a} against ${n.b}`;
  return (
    <div className="fq-item" style={{ display: 'grid', gap: 6 }}>
      {row}
      <div className="fq-adjust" role="group" aria-label={`Running order: ${label}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-line btn-sm" disabled={busy || !adjust.canEarlier} onClick={() => adjust.onMove('earlier')} aria-label={`Move ${label} earlier`}>Move earlier</button>
        <button type="button" className="btn btn-line btn-sm" disabled={busy || !adjust.canLater} onClick={() => adjust.onMove('later')} aria-label={`Move ${label} later`}>Move later</button>
        <button type="button" className="btn btn-line btn-sm" disabled={busy || !adjust.canEarlier} onClick={() => adjust.onMove('first')} aria-label={`Make ${label} next`}>Make next</button>
      </div>
    </div>
  );
}

export function FieldPage() {
  const { eventId: slug = '', field: rawField = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const field = rawField.trim();
  const wantedMatch = search.get('match') ?? search.get('open');   // Event day opens the scoreboard of one match directly; `open` keeps an open fight across a refresh
  const fromControl = search.get('from') === 'control' || search.get('from') === 'eventday'; // ... and offers the way back to Event Control › Live ops
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id;
  const { waiting, stuck, heldForOthers, durable } = useOutbox();
  const [reloadKey, setReloadKey] = useState(0);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [officialHere, setOfficialHere] = useState<string | null>(null);   // the fight this device itself finished (its board shows the result and the next fight)
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [classic, setClassic] = useState(readClassic);

  const loaded = useAsync(() => fetchEvent(slug), [slug]);
  const event: LiveEvent | undefined = loaded.data?.event;
  const eventId = event?.id;
  const mine = useAsync(() => (eventId && userId ? fetchMyEventContext(eventId, userId) : Promise.resolve(undefined)), [eventId, userId]);
  const canScore = mine.data?.roles.some(r => SCORE_ROLES.includes(r)) === true;
  const canResolve = mine.data?.roles.some(r => RESOLVE_ROLES.includes(r)) === true;
  const canAdjust = mine.data?.roles.some(r => QUEUE_ROLES.includes(r)) === true;
  const [moving, setMoving] = useState(false);
  const comps = useAsync(() => (eventId && canScore ? fetchFieldCompetitions(eventId) : Promise.resolve([] as FieldCompetition[])), [eventId, canScore]);
  const matches = useAsync(() => (comps.data?.length ? fetchEventMatches(comps.data) : Promise.resolve([] as CompetitionMatch[])), [comps.data], [reloadKey]);
  useDocumentTitle(event ? `${fieldLabel(field)} · ${event.name}` : 'Lyst Control');
  useFocusBar({
    eventName: event?.name, context: fieldLabel(field),
    exit: fromControl ? { to: `/events/${slug}/control?mode=live`, label: 'Event Control' } : { to: `/events/${slug}/live`, label: 'Event' },
    pending: canScore ? waiting : undefined
  });

  // Keep the queue fresh: poll, and reload when anybody changes a match (realtime is a nudge, polling is the safety net).
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const closeOpened = useCallback(() => { setOpened(null); setSearch(prev => { const n = new URLSearchParams(prev); n.delete('open'); return n; }, { replace: true }); }, [setSearch]);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!canScore) return;
    const poll = window.setInterval(() => { if (!document.hidden) reload(); }, POLL_MS);
    const nudge = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(reload, 500); };
    const ids = (comps.data ?? []).map(c => c.id);
    const filter = realtimeFilter(ids);   // only this event's competitions, filtered on the server
    const channel = realtimeChannel(`field-${slug}-${field}`).on('postgres_changes', { event: '*', schema: 'public', table: 'matches', ...(filter ? { filter } : {}) }, nudge).subscribe();
    return () => { window.clearInterval(poll); window.clearTimeout(timer.current); void supabase.removeChannel(channel); };
  }, [canScore, slug, field, reload, comps.data]);

  const compById = useMemo(() => new Map((comps.data ?? []).map(c => [c.id, c])), [comps.data]);
  const queue = useMemo(() => fieldQueue(matches.data ?? [], field), [matches.data, field]);
  const otherFields = useMemo(() => fieldOverview(matches.data ?? []).filter(f => f.field !== field), [matches.data, field]);

  // Running order (organizer, secretary / scorekeeper, event admin): the database checks who you are again and refuses a fight that is being fought or has no place in the line yet.
  const move = async (m: CompetitionMatch, action: QueueMove) => {
    setMoving(true); setOpenError(null); setNotice(null);
    try {
      const r = await moveMatchInQueue(m.id, action);
      setNotice(!r.changed ? 'It is already there.' : action === 'first' ? 'It will run next.' : action === 'earlier' ? 'Moved up one place.' : 'Moved back one place.');
      reload();
    } catch (e) { setOpenError(friendlyError(e)); } finally { setMoving(false); }
  };

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
      // a refresh of the lyst screen comes back to this fight (the clock and rounds live on the server). The classic board keeps its own behaviour: a refresh returns to the queue.
      if (boardModeFor(comp.league, comp.category) === 'duel' && !classic) setSearch(prev => { const n = new URLSearchParams(prev); n.set('open', m.id); return n; }, { replace: true });
      reload();
    } catch (e) { setOpenError(friendlyError(e)); } finally { setOpening(false); }
  };

  // Open the match Event day sent us to, once, as soon as the queue has loaded. Going "back to the queue" afterwards must not reopen it.
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    // `matches.data` is an empty list until the competitions have loaded: that is not "loaded", so wait for real rows.
    if (!wantedMatch || autoOpened.current === wantedMatch || opened || opening || !comps.data?.length || !matches.data?.length) return;
    const target = matches.data.find(x => x.id === wantedMatch);
    autoOpened.current = wantedMatch;
    setSearch(prev => { const n = new URLSearchParams(prev); n.delete('match'); return n; }, { replace: true });
    if (target && target.queueState !== 'final') void open(target);
    else { setNotice('That match is not waiting to be scored any more.'); setSearch(prev => { const n = new URLSearchParams(prev); n.delete('open'); return n; }, { replace: true }); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || (loaded.loading && !loaded.data)) return <p className="muted">Loading…</p>;
  if (loaded.error != null) return <p role="alert">{friendlyError(loaded.error)}</p>;
  if (!loaded.data || !event) return <NotFoundPage />;
  if (!session) return <><PageHead eyebrow="Lyst Control" title={`${event.name} · ${fieldLabel(field)}`} /><SignIn reason="Sign in with the account that scores this event." /></>;
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
        (() => {
          const common = {
            opened, eventId: event.id, userId: session.user.id, fieldName: field,
            nextFight: queue.find(m => m.id !== opened.match.id && m.queueState === 'active' && m.entryA && m.entryB) ?? queue.find(m => m.id !== opened.match.id && m.queueState === 'on_deck' && m.entryA && m.entryB) ?? null,
            backHref: fromControl ? { to: `/events/${event.slug}/control?mode=live`, label: 'Back to Event Control' } : null,
            onExit: () => { closeOpened(); reload(); },
            onFinished: () => { closeOpened(); reload(); },
            onOfficial: () => { setOfficialHere(opened.match.id); reload(); },
            onOpenNext: (m: CompetitionMatch) => { closeOpened(); void open(m); },
            onStale: (message: string) => { closeOpened(); setNotice(message); reload(); }
          };
          const isDuel = boardModeFor(opened.comp.league, opened.comp.category) === 'duel';
          // Another device finished this fight while it was open here: the result stands; this board must not offer another round or a second result.
          const fresh = matches.data?.find(m => m.id === opened.match.id);
          if (fresh && fresh.queueState === 'final' && officialHere !== opened.match.id) {
            return <FinalElsewhere m={fresh} fieldName={field} nextFight={common.nextFight} onOpenNext={common.onOpenNext} onBack={common.onFinished} />;
          }
          return <>
            <ReadinessStrip key={`ready-${opened.match.id}`} matchId={opened.match.id} />
            {isDuel && !classic
              ? <LystScoring key={opened.match.id} {...common} canResolve={canResolve} onClassic={() => { writeClassic(true); setClassic(true); }} />
              : <ScoringScreen key={opened.match.id} {...common} onLyst={isDuel ? () => { writeClassic(false); setClassic(false); } : undefined} />}
          </>;
        })()
      ) : (
        <>
          <PageHead eyebrow={event.name} title={fieldLabel(field)} lede="Fights on this Lyst, in running order. Pick one to start scoring." />
          {notice && <p role="alert" className="panel info">{notice}</p>}
          {canResolve && <ResultConflicts eventId={event.id} onChanged={reload} />}
          {openError && <p role="alert" style={{ color: 'var(--live)' }}>{openError}</p>}
          {(comps.error != null || matches.error != null) && <p role="alert">{friendlyError(comps.error ?? matches.error, 'Could not load the queue. Retrying.')}</p>}
          {(comps.loading || matches.loading) && !matches.data && <p className="muted">Loading the queue…</p>}
          {matches.data && queue.length === 0 && (
            <div className="panel info"><h3>Nothing queued on {fieldLabel(field)}</h3><p>Fights show here once an organizer puts them on deck, in the hole or on this Lyst.</p></div>
          )}
          <div style={{ display: 'grid', gap: 12 }}>
            {queue.map(m => {
              // Position among the waiting fights: the first cannot move earlier, the last cannot move later. A fight being fought is not moved.
              const waitingIds = queue.filter(x => x.queueState !== 'active' && x.entryA && x.entryB).map(x => x.id);
              const at = waitingIds.indexOf(m.id);
              const adjust: Adjust | undefined = canAdjust && m.queueState !== 'active' && at >= 0
                ? { canEarlier: at > 0, canLater: at < waitingIds.length - 1, onMove: a => void move(m, a) } : undefined;
              return <QueueRow key={m.id} m={m} comp={compById.get(m.competitionId)} busy={opening || moving} onOpen={() => void open(m)} adjust={adjust} />;
            })}
          </div>
          {canResolve && <EnterOfficialResult matches={matches.data ?? []} names={new Map((comps.data ?? []).map(c => [c.id, c.name]))} onDone={reload} />}
          {otherFields.length > 0 && (
            <nav aria-label="Other Lysts" className="panel info" style={{ display: 'grid', gap: 8 }}>
              <b>Other Lysts</b>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {otherFields.map(f => <Link key={f.field} className={`btn btn-sm ${f.queued > 0 ? 'btn-ink' : 'btn-line'}`} to={`/events/${event.slug}/field/${encodeURIComponent(f.field)}`}>{fieldLabel(f.field)}{f.queued > 0 ? ` (${f.queued})` : ''}</Link>)}
              </div>
            </nav>
          )}
          {fromControl
            ? <Link className="more" to={`/events/${event.slug}/control?mode=live`}>← Back to Event Control</Link>
            : <Link className="more" to={`/events/${event.slug}/live`}>← Back to the event</Link>}
        </>
      )}
    </section>
  );
}
