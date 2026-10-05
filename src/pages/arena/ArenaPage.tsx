import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { fetchEvent } from '../../data/api';
import { arenaFields, buildArena, nextArenaTick, pickField, type ArenaFight, type ArenaView } from '../../lib/arena';
import { dateRange } from '../../lib/dates';
import { eventPhase, todayIso } from '../../lib/careerView';
import { friendlyError } from '../../lib/friendlyError';
import { useArenaData } from '../../lib/useArenaData';
import { useAsync } from '../../lib/useAsync';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useEventRecordWatch } from '../../lib/useEventRecordWatch';

/**
 * The venue display: what spectators see on a TV, projector or phone beside the list. Public, no sign-in, published events only, nothing but the
 * same match data the public event page shows plus the running score a scorer's device reported. One field at a time (Field 1 is the default; a
 * blank field is Field 1), big and readable from far away, updating by itself. Fullscreen when the browser allows it, and fine without.
 */
export function ArenaPage() {
  const { eventId: slug = '', field: fieldParam } = useParams();
  const [search] = useSearchParams();
  const [recordKey, setRecordKey] = useState(0);
  const loaded = useAsync(() => fetchEvent(slug), [slug, recordKey]);
  const event = loaded.data?.event;
  useEventRecordWatch(event?.id, () => setRecordKey(k => k + 1));
  const competitions = useMemo(() => loaded.data?.competitions ?? [], [loaded.data]);
  const ids = useMemo(() => (event?.status === 'published' ? competitions.map(c => c.id) : []), [event?.status, competitions]);
  const live = useArenaData(ids);
  const fields = useMemo(() => arenaFields(live.matches), [live.matches]);
  const wanted = fieldParam ?? search.get('field');
  const field = pickField(fields, wanted);
  const [now, setNow] = useState(() => Date.now());
  // The result card has a time limit: wake exactly when it runs out, never on a steady interval.
  useEffect(() => {
    const t = nextArenaTick(live.matches, field, now);
    if (t === null) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(50, t - now));
    return () => window.clearTimeout(id);
  }, [live.matches, field, now]);
  useEffect(() => { setNow(Date.now()); }, [live.updatedAt]);
  const view = useMemo(() => buildArena({ matches: live.matches, scores: live.scores, competitions, field, now }), [live.matches, live.scores, competitions, field, now]);
  useDocumentTitle(event ? `${view.field} · ${event.name}` : 'Live display');

  // ---- fullscreen, and a bar that gets out of the way while nobody is touching the screen
  const root = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const canFs = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { /* refused or unsupported: the page works the same without it */ }
  };
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!fs) { setIdle(false); return; }
    let t = window.setTimeout(() => setIdle(true), 4000);
    const wake = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), 4000); };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
    return () => { window.clearTimeout(t); for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, wake); };
  }, [fs]);

  if (loaded.loading && !loaded.data) return <div className="arena"><p className="ar-note">Loading…</p></div>;
  if (loaded.error != null) return <div className="arena"><p className="ar-note" role="alert">{friendlyError(loaded.error, 'Could not load this event.')}</p><Link className="ar-exit" to="/events">Events</Link></div>;
  if (!event || event.status !== 'published') {
    return (
      <div className="arena">
        <div className="ar-main ar-center"><p className="ar-label">Live display</p><h1 className="ar-big">This event is not public</h1><p className="ar-note">The live display shows published events only.</p><Link className="ar-btn" to="/events">Events</Link></div>
      </div>
    );
  }

  const phase = eventPhase(event.startsOn, event.endsOn, todayIso());
  const liveWord = live.connection === 'live' ? 'Live' : live.connection === 'polling' ? 'Updating every few seconds' : 'Connecting';
  return (
    <div ref={root} className={`arena${fs ? ' fs' : ''}${idle ? ' idle' : ''}`}>
      <header className="ar-bar">
        <Link className="ar-exit" to={`/events/${event.slug}`} aria-label={`Exit the live display, back to ${event.name}`}>← {event.name}</Link>
        {fields.length > 1 && (
          <nav className="ar-fields" aria-label="Field">
            {fields.map(f => <Link key={f} to={`/events/${event.slug}/arena/${encodeURIComponent(f)}`} aria-current={f === view.field ? 'page' : undefined}>{f}</Link>)}
          </nav>
        )}
        <div className="ar-tools">
          <span className={`ar-live ${live.connection}`} role="status">{liveWord}</span>
          {canFs && <button type="button" className="ar-btn" onClick={() => void toggleFs()}>{fs ? 'Exit fullscreen' : 'Enter fullscreen'}</button>}
        </div>
      </header>

      <main className="ar-main" aria-live="polite">
        <p className="ar-field">{view.field}<span className="ar-count">{view.total > 0 ? `${view.done} of ${view.total} fights done` : ''}</span></p>
        {event.closedAt
          ? <div className="ar-center ar-enter" key="closed"><p className="ar-label">Event complete</p><h1 className="ar-big">{event.name}</h1><p className="ar-note">Every competition is official.</p><Link className="ar-btn" to={`/events/${event.slug}`}>View results</Link></div>
          : <Stage view={view} phase={phase} eventStarts={dateRange(event.startsOn, event.endsOn)} timeNote={event.timeNote} loading={live.loading && live.updatedAt === null} resultsTo={competitions.some(c => c.status === 'finished') ? `/events/${event.slug}` : null} />}
      </main>

      <footer className="ar-next">
        {view.state.kind === 'result' && view.state.next
          ? <><NextSlot label="Up next" fight={view.state.next} /><NextSlot label="On deck" fight={view.onDeck} /></>
          : <><NextSlot label="On deck" fight={view.onDeck} /><NextSlot label="In the hole" fight={view.inTheHole} /></>}
      </footer>
    </div>
  );
}

function Stage({ view, phase, eventStarts, timeNote, loading, resultsTo }: { view: ArenaView; phase: 'past' | 'upcoming' | 'current'; eventStarts: string; timeNote: string | null; loading: boolean; resultsTo: string | null }) {
  const s = view.state;
  if (loading) return <div className="ar-center" key="loading"><p className="ar-note">Loading…</p></div>;
  if (s.kind === 'fighting') return <Fight key={s.now.id} label="Now fighting" fight={s.now} />;
  if (s.kind === 'result') {
    return <Fight key={`r-${s.result.id}`} label="Result" fight={s.result} result winner={s.drawn ? 'Draw' : s.winnerName ? <>Winner: <b>{s.winnerName}</b></> : 'Result official'} />;
  }
  if (s.kind === 'finished') return <div className="ar-center ar-enter" key="finished"><p className="ar-label">Field complete</p><h1 className="ar-big">{view.field} is complete</h1>{resultsTo && <Link className="ar-btn" to={resultsTo}>View results</Link>}</div>;
  if (s.kind === 'no_matches') {
    return (
      <div className="ar-center ar-enter" key="none">
        {phase === 'upcoming'
          ? <><p className="ar-label">Fighting begins</p><h1 className="ar-big">{eventStarts}</h1>{timeNote && <p className="ar-note">{timeNote}</p>}</>
          : <><p className="ar-label">{view.field}</p><h1 className="ar-big">Matches have not been posted yet</h1></>}
      </div>
    );
  }
  return (
    <div className="ar-center ar-enter" key={`w-${s.next?.id ?? 'none'}`}>
      <p className="ar-label">{s.next ? 'Next fight coming up' : phase === 'upcoming' ? 'Fighting begins' : 'Waiting for the next fight'}</p>
      {s.next ? <Fight label={null} fight={s.next} muted /> : phase === 'upcoming' ? <h1 className="ar-big">{eventStarts}</h1> : <h1 className="ar-big">Stand by</h1>}
    </div>
  );
}

function Fight({ label, fight, result = false, muted = false, winner = null }: { label: string | null; fight: ArenaFight; result?: boolean; muted?: boolean; winner?: ReactNode }) {
  const showScore = result || fight.live;
  return (
    <div className={`ar-fight${result ? ' ar-done' : ''}${muted ? ' ar-muted' : ''} ar-enter`}>
      {label && <p className="ar-label">{label}</p>}
      <div className="ar-sides">
        <Side k="a" fight={fight} showScore={showScore} />
        <div className="ar-vs" aria-hidden="true">vs</div>
        <Side k="b" fight={fight} showScore={showScore} />
      </div>
      <p className="ar-ctx">{fight.competition} · {fight.stage}</p>
      {fight.phase && <p className="ar-phase">{fight.phase}</p>}
      {winner && <p className="ar-winner">{winner}</p>}
      {!result && !fight.live && !muted && <p className="ar-note">The score appears here as soon as the scorer's device reports it.</p>}
    </div>
  );
}

function Side({ k, fight, showScore }: { k: 'a' | 'b'; fight: ArenaFight; showScore: boolean }) {
  const side = fight[k];
  return (
    <div className={`ar-side ${k}${side.winner ? ' won' : ''}`}>
      <span className="ar-name">{side.name}</span>
      {showScore && <span className="ar-score" aria-label={`${side.name}: ${side.score ?? 0}`}>{side.score ?? 0}{side.winner && <span className="sr-only"> (winner)</span>}</span>}
    </div>
  );
}

function NextSlot({ label, fight }: { label: string; fight: ArenaFight | null }) {
  return (
    <div className="ar-slot">
      <span className="ar-slot-k">{label}</span>
      {fight ? <><span className="ar-slot-n"><b>{fight.a.name}</b> <i>vs</i> <b>{fight.b.name}</b></span><span className="ar-slot-c">{fight.competition} · {fight.stage}</span></> : <span className="ar-slot-n muted">—</span>}
    </div>
  );
}
