import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { Chip, PageHead } from '../components/ui';
import { fetchEvent, fetchMyEventContext, type LiveEvent } from '../data/api';
import { fetchEventMatches, fetchFieldCompetitions, type FieldCompetition } from '../data/field';
import { sideLabel } from '../lib/entryLabel';
import { setQueue, type CompetitionMatch } from '../data/matches';
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

/** Mirrors private.can_score: organizer, marshal, scorekeeper, plus the platform owner. The database enforces it again on every call. */
const SCORE_ROLES = ['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'owner'];
/** Mirrors private.can_resolve_results: who may settle a disagreement or enter an official result from paper. */
const RESOLVE_ROLES = ['organizer', 'head_marshal', 'owner'];
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

export function FieldPage() {
  const { eventId: slug = '', field: rawField = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const field = rawField.trim();
  const wantedMatch = search.get('match') ?? search.get('open');   // Event day opens the scoreboard of one match directly; `open` keeps an open fight across a refresh
  const fromEventDay = search.get('from') === 'eventday'; // ... and offers the way back
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id;
  const { waiting, stuck, heldForOthers, durable } = useOutbox();
  const [reloadKey, setReloadKey] = useState(0);
  const [opened, setOpened] = useState<Opened | null>(null);
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
  const comps = useAsync(() => (eventId && canScore ? fetchFieldCompetitions(eventId) : Promise.resolve([] as FieldCompetition[])), [eventId, canScore]);
  const matches = useAsync(() => (comps.data?.length ? fetchEventMatches(comps.data) : Promise.resolve([] as CompetitionMatch[])), [comps.data, reloadKey]);
  useDocumentTitle(event ? `${field} · ${event.name}` : 'Field scoring');

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
        (() => {
          const common = {
            opened, eventId: event.id, userId: session.user.id, fieldName: field,
            nextFight: queue.find(m => m.id !== opened.match.id && m.queueState === 'active' && m.entryA && m.entryB) ?? queue.find(m => m.id !== opened.match.id && m.queueState === 'on_deck' && m.entryA && m.entryB) ?? null,
            backHref: fromEventDay ? { to: `/events/${event.slug}/manage?tab=eventday`, label: 'Back to Event day' } : null,
            onExit: () => { closeOpened(); reload(); },
            onFinished: () => { closeOpened(); reload(); },
            onOfficial: reload,
            onOpenNext: (m: CompetitionMatch) => { closeOpened(); void open(m); },
            onStale: (message: string) => { closeOpened(); setNotice(message); reload(); }
          };
          const isDuel = boardModeFor(opened.comp.league, opened.comp.category) === 'duel';
          return <>
            <ReadinessStrip key={`ready-${opened.match.id}`} matchId={opened.match.id} />
            {isDuel && !classic
              ? <LystScoring key={opened.match.id} {...common} canResolve={canResolve} onClassic={() => { writeClassic(true); setClassic(true); }} />
              : <ScoringScreen key={opened.match.id} {...common} onLyst={isDuel ? () => { writeClassic(false); setClassic(false); } : undefined} />}
          </>;
        })()
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
          {otherFields.length > 0 && (
            <nav aria-label="Other fields" className="panel info" style={{ display: 'grid', gap: 8 }}>
              <b>Other fields</b>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {otherFields.map(f => <Link key={f.field} className={`btn btn-sm ${f.queued > 0 ? 'btn-ink' : 'btn-line'}`} to={`/events/${event.slug}/field/${encodeURIComponent(f.field)}`}>{f.field}{f.queued > 0 ? ` (${f.queued})` : ''}</Link>)}
              </div>
            </nav>
          )}
          {fromEventDay
            ? <Link className="more" to={`/events/${event.slug}/manage?tab=eventday`}>← Back to Event day</Link>
            : <Link className="more" to={`/events/${event.slug}#scorekeeping`}>← Back to the event and field list</Link>}
        </>
      )}
    </section>
  );
}
