import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import '../styles/announcer.css';
import { CameraOffControl } from '../components/CameraOffControl';
import { Crest } from '../components/Crest';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { fetchEvent } from '../data/api';
import { fetchEntryCareer, fetchEventIsTest, fetchReadiness } from '../data/announcer';
import { fetchSides } from '../data/broadcast';
import type { SideSource } from '../lib/broadcast/sides';
import { friendlyError } from '../lib/friendlyError';
import { useArenaData } from '../lib/useArenaData';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useEventRecordWatch } from '../lib/useEventRecordWatch';
import { useLystPublic } from '../lib/lyst/useLystPublic';
import { useNow } from '../lib/lyst/useLystState';
import { MODE_LABEL, formatClock, remainingMs, timerTone, timerWord, type ServerClock, type TimerMode } from '../lib/lyst/timer';
import { buildAnnouncerView, orderLysts, slotWord, type AnnFight, type AnnMark, type AnnSide, type AnnTimer, type LystCard, type RecentResult } from '../lib/announcer/viewModel';
import { buildEntryInfo, type EntryInfo } from '../lib/announcer/info';
import { loadFocus, saveFocus } from '../lib/announcer/focus';
import { latest, staleLine, staleness } from '../lib/announcer/stale';

const MARK_ICON: Record<AnnMark['kind'], string> = { warning: '⚠', card: '▮', deduction: '−', dq: '⊘' };

interface Picked { entryId: string; matchId: string; side: 'a' | 'b'; snapshot: AnnSide; competition: string }

/**
 * The Announcer view: what the person with the microphone needs, on a tablet beside them. READ-ONLY: the only control that does anything to the event
 * is the shared Camera Off button. Official data only (marshal-confirmed lyst scores, final results); never a counter's tally, never a reason, a note
 * or a private detail. Every refresh updates the screen in place (nothing remounts, nothing flashes "Loading"), so scroll position, the Lyst you
 * focused on and the fighter card you opened all stay put while fights start and finish.
 */
export function AnnouncerPage() {
  return <ErrorBoundary fullPage><AnnouncerScreen /></ErrorBoundary>;
}

function AnnouncerScreen() {
  const { eventId: slug = '' } = useParams();
  const [recordKey, setRecordKey] = useState(0);
  const loaded = useAsync(() => fetchEvent(slug), [slug], [recordKey]);
  const event = loaded.data?.event;
  // when the event record last answered well (one of the heartbeats for the "not updating" banner)
  const eventOkAt = useRef<number | null>(null);
  const eventSeen = useRef<unknown>(undefined);
  if (loaded.data !== eventSeen.current) { eventSeen.current = loaded.data; if (loaded.data) eventOkAt.current = Date.now(); }
  useEventRecordWatch(event?.id, () => setRecordKey(k => k + 1));
  const competitions = useMemo(() => loaded.data?.competitions ?? [], [loaded.data]);
  const published = event?.status === 'published';
  const ids = useMemo(() => (published ? competitions.map(c => c.id) : []), [published, competitions]);
  const live = useArenaData(ids);
  const lyst = useLystPublic(event?.id, ids.length > 0);

  // "now" for the stale check only: five seconds is plenty, and it re-renders nothing that is not already changing
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(t); }, []);

  // readiness (booleans only) re-read every few seconds and whenever the matches changed
  const [rdTick, setRdTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => { if (!document.hidden) setRdTick(n => n + 1); }, 6000); return () => window.clearInterval(t); }, []);
  useEffect(() => { setRdTick(n => n + 1); }, [live.updatedAt]);
  const eventIdForReads = published ? event?.id : undefined;
  const readiness = useAsync(() => (eventIdForReads ? fetchReadiness(eventIdForReads) : Promise.resolve(null)), [eventIdForReads], [rdTick]);

  // local-only focus
  const [focusRaw, setFocusRaw] = useState<string | null>(() => loadFocus(slug));
  const setFocus = useCallback((f: string | null) => { setFocusRaw(f); saveFocus(slug, f); }, [slug]);

  // two passes: the first says which fighters are on screen, the records for them arrive, the second has everything
  const finals = useMemo(() => live.matches.filter(m => m.queueState === 'final').length, [live.matches]);
  const first = useMemo(() => buildAnnouncerView({ matches: live.matches, competitions, lyst: lyst.rows, sides: {}, readiness: readiness.data ?? null, focus: focusRaw }), [live.matches, competitions, lyst.rows, readiness.data, focusRaw]);
  const wanted = first.entryIds.join(',');
  const sidesLoad = useAsync(() => (wanted ? fetchSides(wanted.split(','), true) : Promise.resolve({} as Record<string, SideSource>)), [wanted], [finals]);
  const sidesSeen = useRef<Record<string, SideSource>>({});
  if (sidesLoad.data) sidesSeen.current = { ...sidesSeen.current, ...sidesLoad.data };
  const view = useMemo(
    () => buildAnnouncerView({ matches: live.matches, competitions, lyst: lyst.rows, sides: sidesSeen.current, readiness: readiness.data ?? null, focus: focusRaw }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live.matches, competitions, lyst.rows, readiness.data, focusRaw, sidesLoad.data]
  );

  // a fighter card the announcer opened: it stays open and keeps updating while the fights move
  const [picked, setPicked] = useState<Picked | null>(null);
  const eventTest = useAsync(() => (eventIdForReads ? fetchEventIsTest(eventIdForReads) : Promise.resolve(false)), [eventIdForReads]);
  const career = useAsync(() => (picked ? fetchEntryCareer(picked.entryId) : Promise.resolve(null)), [picked?.entryId ?? ''], [finals]);
  const pickedSide = useMemo(() => {
    if (!picked) return null;
    const f = view.lysts.flatMap(l => [l.now, l.next, ...l.coming]).find(x => x?.id === picked.matchId);
    return f ? f[picked.side] : picked.snapshot;
  }, [picked, view.lysts]);
  const info: EntryInfo | null = useMemo(() => (picked && pickedSide
    ? buildEntryInfo({ side: pickedSide, competition: picked.competition, matches: live.matches, competitions, career: career.loading ? null : career.data?.lines, entryIds: career.loading ? null : career.data?.entryIds, eventIsTest: eventTest.data === true })
    : null), [picked, pickedSide, live.matches, competitions, career.loading, career.data, eventTest.data]);

  useDocumentTitle(event ? `Announcer · ${event.name}` : 'Announcer');

  // ------------------------------------------------------------------ states that are not the board
  if (loaded.loading && !loaded.data) return <div className="ann"><p className="an-note" role="status">Loading…</p></div>;
  if (loaded.error != null && !loaded.data) return <div className="ann"><div className="an-center"><p className="an-note" role="alert">{friendlyError(loaded.error, 'Could not load this event.')}</p><button type="button" className="an-btn" onClick={loaded.reload}>Try again</button></div></div>;
  if (!event) {
    return (
      <div className="ann"><div className="an-center">
        <p className="an-label">Announcer</p><h1 className="an-big">This event is not available</h1>
        <p className="an-note">The announcer view shows published events. If this event is still a draft, ask the organizer to publish it.</p>
        <Link className="an-btn" to="/events">Events</Link>
      </div></div>
    );
  }
  if (!published) {
    return (
      <div className="ann">
        <header className="an-bar"><span className="an-event">{event.name}</span><div className="an-tools"><CameraOffControl eventId={event.id} compact /></div></header>
        <div className="an-center">
          <p className="an-label">Announcer</p><h1 className="an-big">{event.status === 'cancelled' ? 'This event was cancelled' : 'This event is not public yet'}</h1>
          <p className="an-note">{event.status === 'cancelled' ? 'There is nothing to announce.' : 'The announcer view shows fights once the organizer publishes the event.'}</p>
        </div>
      </div>
    );
  }

  const stale = staleness(latest(lyst.updatedAt, eventOkAt.current, live.updatedAt), now);
  const staleWords = staleLine(stale);
  const shownLysts = orderLysts(view.lysts, view.focus);
  const connectionWord = live.connection === 'live' ? 'Live' : live.connection === 'polling' ? 'Updating every few seconds' : 'Connecting';
  const pick = (f: AnnFight, side: AnnSide) => { if (side.entryId) setPicked({ entryId: side.entryId, matchId: f.id, side: side.side, snapshot: side, competition: f.competition }); };

  return (
    <div className="ann">
      <header className="an-bar">
        <span className="an-event" title={event.name}>{event.name}</span>
        <span className="an-conn" role="status">{connectionWord}</span>
        <div className="an-tools"><CameraOffControl eventId={event.id} compact /></div>
      </header>
      <div className="an-stale-slot" role="status" aria-live="polite">{staleWords && <p className="an-stale" data-testid="stale-banner"><span aria-hidden="true">⏸ </span>{staleWords}</p>}</div>

      <ErrorBoundary>
        {view.lysts.length > 1 && (
          <nav className="an-focus" aria-label="Focus Lyst (this screen only)">
            <button type="button" className="an-chip" aria-pressed={view.focus === null} onClick={() => setFocus(null)}>All Lysts</button>
            {view.lysts.map(l => <button key={l.key} type="button" className="an-chip" aria-pressed={view.focus === l.key} onClick={() => setFocus(l.key)}>Focus {l.label}</button>)}
          </nav>
        )}

        <main className="an-main" data-testid="announcer-main">
          <div className="an-lysts" data-lysts={shownLysts.length}>
            {shownLysts.length === 0 && (
              <section className="an-card an-empty"><h2 className="an-h">{live.loading && live.updatedAt === null ? 'Loading fights…' : event.closedAt ? 'Event complete' : 'No fights waiting'}</h2>
                <p className="an-note">{competitions.length === 0 ? 'No competitions have been set up yet.' : view.recent.length > 0 ? 'Every posted fight is finished. Results are below.' : 'Fights will appear here as soon as they are posted.'}</p></section>
            )}
            {shownLysts.map(l => <LystColumn key={l.key} card={l} clock={lyst.clock} compact={view.focus !== null && view.focus !== l.key} picked={picked} onPick={pick} />)}
          </div>

          <section className="an-recent" aria-labelledby="an-recent-h">
            <h2 className="an-h" id="an-recent-h">Recent results</h2>
            {view.recent.length === 0 ? <p className="an-note">No finished fights yet.</p> : <ul className="an-results">{view.recent.map(r => <ResultRow key={r.id} r={r} />)}</ul>}
          </section>
        </main>
      </ErrorBoundary>

      {info && picked && <InfoPanel info={info} loading={career.loading && !career.data} onClose={() => setPicked(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ parts
function LystColumn({ card, clock, compact, picked, onPick }: { card: LystCard; clock: ServerClock; compact: boolean; picked: Picked | null; onPick: (f: AnnFight, s: AnnSide) => void }) {
  return (
    <section className={`an-card an-lyst${card.live ? ' is-live' : ''}${compact ? ' is-compact' : ''}`} aria-labelledby={`an-h-${card.key.replace(/\W+/g, '-')}`} data-lyst={card.key}>
      <header className="an-lyst-head">
        <h2 className="an-lyst-name" id={`an-h-${card.key.replace(/\W+/g, '-')}`}>{card.label}</h2>
        <span className={`an-state ${card.live ? 'live' : 'idle'}`}><span aria-hidden="true">{card.live ? '●' : '○'}</span> {card.live ? 'Fighting now' : 'Between fights'}</span>
        <span className="an-count">{card.total > 0 ? `${card.done} of ${card.total} fights done` : ''}</span>
      </header>

      {card.now
        ? <NowFight f={card.now} clock={clock} extra={card.alsoActive} picked={picked} onPick={onPick} />
        : <div className="an-nonow"><p className="an-label">Now fighting</p><p className="an-none">Nobody on the Lyst yet</p></div>}

      <div className="an-next">
        <p className="an-label">Up next</p>
        {card.next ? <UpFight f={card.next} big picked={picked} onPick={onPick} /> : <p className="an-none">No fight called yet</p>}
      </div>

      {!compact && (
        <div className="an-coming">
          <p className="an-label">Coming up</p>
          {card.coming.length === 0 ? <p className="an-none">Nothing else lined up</p> : (
            <ol className="an-queue">{card.coming.map(f => <li key={f.id}><UpFight f={f} picked={picked} onPick={onPick} /></li>)}</ol>
          )}
          {card.more > 0 && <p className="an-more">+ {card.more} more after these</p>}
        </div>
      )}
    </section>
  );
}

function NowFight({ f, clock, extra, picked, onPick }: { f: AnnFight; clock: ServerClock; extra: number; picked: Picked | null; onPick: (f: AnnFight, s: AnnSide) => void }) {
  return (
    <div className="an-now" data-testid="now-fighting">
      <p className="an-label an-live-label"><span aria-hidden="true">● </span>Now fighting</p>
      <p className="an-ctx">{f.competition} · {f.stage}</p>
      <div className="an-sides">
        <SideButton f={f} s={f.a} score picked={picked} onPick={onPick} />
        <span className="an-vs" aria-hidden="true">vs</span>
        <SideButton f={f} s={f.b} score picked={picked} onPick={onPick} />
      </div>
      {f.timer && <AnnClock timer={f.timer} clock={clock} />}
      {f.phase && <p className="an-phase">{f.phase}</p>}
      {extra > 0 && <p className="an-note">{extra === 1 ? 'Another fight is also marked as fighting on this Lyst.' : `${extra} other fights are also marked as fighting on this Lyst.`}</p>}
    </div>
  );
}

function SideButton({ f, s, score = false, picked, onPick }: { f: AnnFight; s: AnnSide; score?: boolean; picked: Picked | null; onPick: (f: AnnFight, s: AnnSide) => void }) {
  const open = !!picked && picked.entryId === s.entryId && !!s.entryId;
  const inner = (
    <>
      <span className="an-corner"><span aria-hidden="true">{s.side === 'a' ? '▲' : '■'}</span> {s.corner}</span>
      <span className="an-who"><Badge s={s} size={score ? 64 : 44} /><span className="an-names"><span className="an-name">{s.name}</span>{s.teamName && <span className="an-team">{s.teamName}</span>}{s.record && <span className="an-rec">{s.record}{s.recordIsTest ? ' · Test' : ''}</span>}</span></span>
      {score && <span className="an-score" aria-label={`${s.name} official score ${s.score ?? 0}`}>{s.score ?? '–'}</span>}
      {s.marks.length > 0 && <span className="an-marks">{s.marks.map((m, i) => <b key={i} className={`an-mark ${m.kind}`}><span aria-hidden="true">{MARK_ICON[m.kind]} </span>{m.text}</b>)}</span>}
    </>
  );
  if (!s.entryId) return <div className={`an-side ${s.side}`}>{inner}</div>;
  return <button type="button" className={`an-side ${s.side}${open ? ' is-open' : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => onPick(f, s)}>{inner}</button>;
}

function Badge({ s, size }: { s: AnnSide; size: number }) {
  if (s.photoUrl) return <img className="an-photo" src={s.photoUrl} width={size} height={size} alt="" style={{ width: size, height: size }} />;
  if (s.crest) return <span className="an-crest" style={{ width: size, height: size }}><Crest team={s.crest} size={Math.round(size * 0.82)} /></span>;
  return <span className="an-photo an-initial" style={{ width: size, height: size }} aria-hidden="true">{s.name.slice(0, 1).toUpperCase()}</span>;
}

function Readiness({ s }: { s: AnnSide }) {
  if (s.ready === null) return null;
  return s.ready
    ? <span className="an-ready ok"><span aria-hidden="true">✓ </span>Ready</span>
    : <span className="an-ready no"><span aria-hidden="true">! </span>Not yet ready</span>;
}

function UpFight({ f, big = false, picked, onPick }: { f: AnnFight; big?: boolean; picked: Picked | null; onPick: (f: AnnFight, s: AnnSide) => void }) {
  return (
    <div className={`an-up${big ? ' big' : ''}${f.notReady ? ' not-ready' : ''}`} data-testid={big ? 'up-next' : 'coming-up'}>
      <p className="an-up-meta"><b>{slotWord(f.slot)}</b> · {f.competition} · {f.stage}</p>
      <div className="an-up-sides">
        {[f.a, f.b].map((s, i) => (
          <div className="an-up-side" key={s.side}>
            {s.entryId
              ? <button type="button" className="an-up-btn" aria-expanded={!!picked && picked.entryId === s.entryId} aria-haspopup="dialog" onClick={() => onPick(f, s)}><Badge s={s} size={big ? 44 : 32} /><span className="an-names"><span className="an-name"><span className="an-corner-i" aria-hidden="true">{s.side === 'a' ? '▲' : '■'}</span><span className="sr-only">{s.corner}: </span>{s.name}</span>{s.teamName && <span className="an-team">{s.teamName}</span>}</span></button>
              : <span className="an-up-btn"><span className="an-names"><span className="an-name">{s.name}</span></span></span>}
            <Readiness s={s} />
            {i === 0 && <span className="an-vs-i" aria-hidden="true">vs</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnnClock({ timer, clock }: { timer: AnnTimer; clock: ServerClock }) {
  const running = timer.status === 'running';
  const now = useNow(running, 250);
  const left = remainingMs({ status: timer.status, remaining_ms: timer.remainingMs, started_at: timer.startedAt }, clock.now(now));
  const word = timerWord({ status: timer.status, mode: timer.mode as TimerMode }, left);
  const tone = timerTone({ status: timer.status }, left);
  return (
    <p className={`an-clock ${timer.status} ${tone}`} role="timer" aria-label={`${MODE_LABEL[timer.mode as TimerMode] ?? 'Clock'} ${formatClock(left)}, ${word}`}>
      <span className="an-clock-k"><span aria-hidden="true">{running ? '▶' : timer.status === 'paused' ? '⏸' : '■'} </span>{word}</span>
      <span className="an-clock-n">{formatClock(left)}</span>
    </p>
  );
}

function ResultRow({ r }: { r: RecentResult }) {
  return (
    <li className="an-result" data-testid="recent-result">
      <p className="an-res-line">
        <span className={`an-res-side${r.a.winner ? ' won' : ''}`}>{r.a.winner && <span aria-hidden="true">✓ </span>}{r.a.name}</span>
        <span className="an-vs-i" aria-hidden="true">vs</span>
        <span className={`an-res-side${r.b.winner ? ' won' : ''}`}>{r.b.winner && <span aria-hidden="true">✓ </span>}{r.b.name}</span>
      </p>
      <p className="an-res-out">
        <b>{r.drawn ? 'Draw' : r.winnerName ? `Winner: ${r.winnerName}` : 'Result official'}</b>
        {r.scoreText && <span className="an-res-score"> · {r.scoreText}</span>}
        {r.basis && <span> · {r.basis}</span>}
      </p>
      <p className="an-res-ctx">{r.competition} · {r.stage} · {r.fieldLabel}</p>
    </li>
  );
}

function InfoPanel({ info, loading, onClose }: { info: EntryInfo; loading: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // focus the close button once when a card opens (not on every refresh), and give focus back when it closes
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { if (before && document.contains(before)) before.focus?.(); };
  }, [info.entryId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const asSide = { photoUrl: info.photoUrl, crest: info.crest, name: info.name } as AnnSide;
  return (
    <aside className="an-info" role="dialog" aria-modal="false" aria-label={`${info.name}: details`} data-testid="info-panel">
      <header className="an-info-head">
        <Badge s={asSide} size={72} />
        <div className="an-info-title">
          <h2 className="an-info-name">{info.name}{info.test && <span className="an-test"> Test</span>}</h2>
          {info.teamName && <p className="an-team">{info.teamName}</p>}
          <p className="an-info-sub">{info.corner ? `${info.corner} corner` : ''}{info.corner && info.category ? ' · ' : ''}{info.category ?? ''}</p>
        </div>
        <button ref={closeRef} type="button" className="an-btn an-close" onClick={onClose}>Close</button>
      </header>
      <dl className="an-facts">
        <div><dt>{info.kind === 'team' ? 'Team record' : 'Career record'}{info.test ? ' (Test)' : ''}</dt><dd>{info.career ? <>{info.career.text}<small> · {info.career.matches} {info.career.matches === 1 ? 'fight' : 'fights'}, {info.career.events} {info.career.events === 1 ? 'event' : 'events'}</small></> : loading ? 'Loading…' : 'No record on file'}</dd></div>
        <div><dt>At this event</dt><dd>{info.event.text}</dd></div>
      </dl>
      <h3 className="an-info-h">Earlier fights at this event</h3>
      {info.earlier.length === 0 ? <p className="an-note">None yet.</p> : (
        <ul className="an-earlier">
          {info.earlier.map(e => (
            <li key={e.matchId}><b className={`an-out ${e.outcome.toLowerCase()}`}><span aria-hidden="true">{e.outcome === 'Won' ? '✓ ' : e.outcome === 'Lost' ? '✗ ' : '＝ '}</span>{e.outcome}</b> vs {e.opponent}{e.scoreText ? ` · ${e.scoreText}` : ''}{e.basis ? ` · ${e.basis}` : ''}<small>{e.competition} · {e.stage} · {e.lyst}</small></li>
          ))}
        </ul>
      )}
    </aside>
  );
}
