import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FieldBoardView, scoreboardLink, type BoardActions } from '../components/eventday/FieldBoardView';
import { ResultConflicts } from '../components/ResultReview';
import { Seg } from '../components/ui';
import type { LiveCompetition, LiveEvent } from '../data/api';
import { fetchScheduleConflicts } from '../data/conflicts';
import { advanceFieldQueue, fetchEventRoster, fetchRegistrationFlags, moveMatchInQueue, type QueueMove } from '../data/eventDay';
import { fetchResultConflicts, setQueue } from '../data/matches';
import { DEFAULT_TIME_ZONE, fetchEventTimeZone } from '../data/runSchedule';
import {
  attentionItems, buildFieldBoards, checkinGaps, competitionProgress, competitionSorts, matchTitle, planAdvance, withdrawnEntryIds,
  type AttentionItem, type AttentionTarget, type CompetitionProgress, type FieldBoard
} from '../lib/eventDay';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useEventDayData } from '../lib/useEventDayData';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

/**
 * Manage › Event day. The organizer's screen while a tournament is running: what is fighting, who is next on each field, what needs a person, and how far
 * each competition has got. It reads live (the same machinery as the public screens) and sends every change through the database functions, which check
 * the caller again. Scoring itself stays on the existing scoring screen; this page only opens it.
 */
export function EventDayTab({ event, competitions }: { event: LiveEvent; competitions: LiveCompetition[] }) {
  const ids = useMemo(() => competitions.map(c => c.id), [competitions]);
  const live = useEventDayData(ids);
  const tz = useAsync(() => fetchEventTimeZone(event.id), [event.id]);
  const timeZone = tz.data ?? DEFAULT_TIME_ZONE;

  // Things that change without a match changing (check-in, schedule clashes, results needing review): re-read every 30 s and after each live update.
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => { if (!document.hidden) setTick(k => k + 1); }, 30_000); return () => window.clearInterval(t); }, []);
  useEffect(() => { if (live.updatedAt === null) return; const t = window.setTimeout(() => setTick(k => k + 1), 1500); return () => window.clearTimeout(t); }, [live.updatedAt]);
  const roster = useAsync(() => fetchEventRoster(ids), [ids.join(','), tick]);
  const regs = useAsync(() => fetchRegistrationFlags(event.id), [event.id, tick]);
  const clashes = useAsync(() => fetchScheduleConflicts(event.id), [event.id, tick]);
  const reviews = useAsync(() => fetchResultConflicts(event.id), [event.id, tick]);

  const sorts = useMemo(() => competitionSorts(competitions), [competitions]);
  const withdrawn = useMemo(() => withdrawnEntryIds(live.entries), [live.entries]);
  const boards = useMemo(() => buildFieldBoards(live.matches, sorts, withdrawn), [live.matches, sorts, withdrawn]);
  const plans = useMemo(() => new Map(boards.map(b => [b.key, planAdvance(b, withdrawn, sorts, { start: true })])), [boards, withdrawn, sorts]);
  const progress = useMemo(() => competitions.map(c => competitionProgress(c, live.matches.filter(m => m.competitionId === c.id))), [competitions, live.matches]);
  const names = useMemo(() => new Map(competitions.map(c => [c.id, c.name])), [competitions]);
  const gaps = useMemo(() => checkinGaps(boards, live.entries, roster.data ?? [], regs.data ?? []), [boards, live.entries, roster.data, regs.data]);
  const attention = useMemo(() => attentionItems({
    boards, progress, clashes: clashes.data ?? [], gaps, resultConflicts: reviews.data?.length ?? 0, withdrawn, competitionNames: names, timeZone, now: new Date()
  }), [boards, progress, clashes.data, gaps, reviews.data, withdrawn, names, timeZone, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- doing things: one at a time, then read everything again
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const run = async (fn: () => Promise<string | undefined>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try { const text = await fn(); await live.refresh(); setTick(k => k + 1); if (text) setNotice({ kind: 'ok', text }); }
    catch (e) {
      // PGRST202: the database does not have the function yet (the update for this screen has not been applied).
      const missing = (e as { code?: string } | null)?.code === 'PGRST202';
      setNotice({ kind: 'error', text: missing ? 'This needs a database update that has not been applied yet. Ask whoever looks after BuhurtOS.' : friendlyError(e) });
      await live.refresh().catch(() => undefined);
    }
    finally { busyRef.current = false; setBusy(false); }
  };
  const byId = useMemo(() => new Map(live.matches.map(m => [m.id, m])), [live.matches]);
  const actions: BoardActions = {
    busy,
    startNext: board => void run(async () => {
      const r = await advanceFieldQueue(event.id, board.name, true);
      const started = r.promoted.find(p => p.to === 'active');
      const m = started ? byId.get(started.match) : undefined;
      return m ? `Started: ${matchTitle(m)}.` : r.promoted.length > 0 ? 'The queue behind the fight is filled.' : 'Nothing is ready to start on this field.';
    }),
    move: (m, action: QueueMove) => void run(async () => {
      const r = await moveMatchInQueue(m.id, action);
      if (!r.changed) return action === 'first' || action === 'earlier' ? 'It is already as far forward as it can go.' : 'Nothing else is ready to go ahead of it.';
      return action === 'first' ? 'It will run next.' : action === 'earlier' ? 'Moved up one place.' : action === 'later' ? 'Moved back one place.' : 'Skipped for now: it stays in the line.';
    }),
    sendBack: m => {
      if (m.queueState === 'active' && !window.confirm('Send this fight back to the line? It will not be recorded as fought.')) return;
      void run(async () => { await setQueue(m.id, 'scheduled', null); return 'Sent back to the line.'; });
    }
  };

  // ---- which field is showing on a phone (wide screens show them all)
  const [picked, setPicked] = useState<string | null>(null);
  const pickedKey = boards.some(b => b.key === picked) ? picked! : (boards.find(b => b.now.length > 0) ?? boards[0])?.key ?? '';

  const slug = event.slug;
  const href = (t: AttentionTarget): string => (t.to === 'run' ? `/events/${slug}/manage?tab=run${t.matchId ? `&match=${t.matchId}` : ''}`
    : t.to === 'checkin' ? `/events/${slug}/manage?tab=checkin` : t.to === 'field' ? scoreboardLink(slug, t.field, t.matchId ?? '') : '');
  const stamp = live.updatedAt ? new Date(live.updatedAt).toLocaleTimeString('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) : null;

  if (competitions.length === 0) {
    return (
      <div className="panel info ed-empty" style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
        <h3>No competitions yet</h3>
        <p>Add the competitions {event.name} runs, then build their draws. The fields appear here as soon as there are matches.</p>
        <Link className="btn btn-ink" to={`/events/${slug}/manage?tab=competitions`}>+ Add competition</Link>
      </div>
    );
  }

  return (
    <section className="eventday" aria-label="Event day" style={{ display: 'grid', gap: 16 }}>
      <div className="ed-status">
        {live.connection === 'live' && <span className="ed-live on" role="status">● Live</span>}
        {live.connection === 'polling' && <span className="ed-live" role="status" title="Showing the last information we have, refreshing every few seconds">Refreshing every few seconds</span>}
        {stamp && <span className="src">Updated {stamp}</span>}
        <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void run(async () => undefined)}>Refresh</button>
      </div>
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="panel info ed-notice" style={notice.kind === 'error' ? { color: 'var(--live)' } : undefined}>{notice.text}</p>}
      {live.error != null && live.matches.length === 0 && (
        <div className="panel info" role="alert" style={{ display: 'grid', gap: 8 }}>
          <b>{friendlyError(live.error, 'Could not load the matches.')}</b>
          <button type="button" className="btn btn-line" onClick={() => void live.refresh()}>Try again</button>
        </div>
      )}
      {live.loading && live.matches.length === 0 && live.error == null && <p className="muted">Loading the fields…</p>}
      {!live.loading && live.error == null && boards.length === 0 && (
        <div className="panel info ed-empty" style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
          <h3>No draw has been built yet</h3>
          <p>Build a draw for a competition in the Run tools and its fights appear here, on Field 1 unless you give them another field.</p>
          <Link className="btn btn-ink" to={`/events/${slug}/manage?tab=run`}>Open Run tools</Link>
        </div>
      )}

      {boards.length > 1 && (
        <div className="ed-picker">
          <Seg scroll label="Field" value={pickedKey} onChange={setPicked}
            options={boards.map(b => [b.key, `${b.name}${b.now.length > 0 ? ' · live' : ''}`] as const)} />
        </div>
      )}
      <div className="ed-fields">
        {boards.map(b => (
          <div key={b.key} className={`ed-field-wrap${b.key === pickedKey ? ' picked' : ''}`}>
            <FieldBoardView board={b} plan={plans.get(b.key)!} c={{ slug, timeZone, competitionNames: names, actions }} />
          </div>
        ))}
      </div>

      <div className="ed-lower">
        <AttentionPanel items={attention} href={href} loadingNotes={[clashes.error != null && 'double-bookings', regs.error != null && 'check-in', reviews.error != null && 'results needing review'].filter((x): x is string => !!x)}
          reviewCount={reviews.data?.length ?? 0} eventId={event.id} onReviewed={() => { void live.refresh(); setTick(k => k + 1); }} />
        <ProgressPanel progress={progress} runHref={`/events/${slug}/manage?tab=run`} />
      </div>

      <nav className="panel info ed-links" aria-label="More event tools">
        <b>More tools</b>
        <div>
          <Link className="btn btn-line" to={`/events/${slug}/manage?tab=run`}>Run tools: draws, times, fields</Link>
          <Link className="btn btn-line" to={`/events/${slug}/manage?tab=checkin`}>Check-in</Link>
          <Link className="btn btn-line" to={`/events/${slug}/manage?tab=competitions`}>Competitions</Link>
          <Link className="btn btn-line" to={`/events/${slug}`}>Public event page</Link>
        </div>
      </nav>
    </section>
  );
}

function AttentionPanel({ items, href, loadingNotes, reviewCount, eventId, onReviewed }: {
  items: AttentionItem[]; href: (t: AttentionTarget) => string; loadingNotes: string[]; reviewCount: number; eventId: string; onReviewed: () => void;
}) {
  return (
    <div className="ed-attention-col" style={{ display: 'grid', gap: 16 }}>
      <section className="panel info ed-attention" aria-labelledby="ed-att-h" style={{ display: 'grid', gap: 10 }}>
        <h2 id="ed-att-h" className="ed-h">Needs attention{items.length > 0 && <span className="chip brass" aria-label={`${items.length} items`}>{items.length}</span>}</h2>
        {items.length === 0 && <p className="ed-calm">Nothing needs your attention right now.</p>}
        {items.length > 0 && (
          <ul className="ed-att-list">
            {items.map(i => (
              <li key={i.id} className={`ed-att ${i.urgency}`}>
                <div><b>{i.title}</b>{i.detail && <span className="src">{i.detail}</span>}</div>
                {i.target.to === 'review'
                  ? <button type="button" className="btn btn-line" onClick={() => document.getElementById('ed-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{i.targetLabel}</button>
                  : <Link className="btn btn-line" to={href(i.target)}>{i.targetLabel}</Link>}
              </li>
            ))}
          </ul>
        )}
        {loadingNotes.length > 0 && <p className="src" role="status">Could not check {loadingNotes.join(', ')} just now. It will try again.</p>}
      </section>
      {/* The existing review panel (it brings its own panel), directly under the list that points to it. */}
      {reviewCount > 0 && <div id="ed-review" tabIndex={-1}><ResultConflicts eventId={eventId} onChanged={onReviewed} /></div>}
    </div>
  );
}

function ProgressPanel({ progress, runHref }: { progress: CompetitionProgress[]; runHref: string }) {
  return (
    <section className="panel info ed-progress" aria-labelledby="ed-prog-h" style={{ display: 'grid', gap: 10 }}>
      <h2 id="ed-prog-h" className="ed-h">Competition progress</h2>
      <ul className="ed-prog-list">
        {progress.map(p => (
          <li key={p.id}>
            <div className="ed-prog-head"><b>{p.name}</b><span className={`ed-phase ed-phase-${p.phase}`}>{p.label}</span></div>
            {p.total > 0 && (
              <div className="ed-bar" role="progressbar" aria-label={`${p.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}><i style={{ width: `${p.percent}%` }} /></div>
            )}
            <span className="src">{p.total > 0 ? `${p.final} / ${p.total} fights complete · ${p.percent}%` : 'Build a draw in the Run tools to see its fights here.'}</span>
            {p.needsBracket && <Link className="btn btn-line btn-sm" to={runHref}>Build the bracket</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export type { FieldBoard };
