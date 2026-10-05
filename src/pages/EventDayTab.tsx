import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FieldBoardView, scoreboardLink, type BoardActions } from '../components/eventday/FieldBoardView';
import { ResultConflicts } from '../components/ResultReview';
import { Seg } from '../components/ui';
import type { LiveCompetition, LiveEvent } from '../data/api';
import { fetchScheduleConflicts } from '../data/conflicts';
import { advanceFieldQueue, fetchEventRoster, fetchRegistrationFlags, moveMatchInQueue, type QueueMove } from '../data/eventDay';
import { fetchResultConflicts, setQueue, type CompetitionMatch } from '../data/matches';
import { DEFAULT_TIME_ZONE, fetchEventTimeZone } from '../data/runSchedule';
import {
  attentionItems, buildFieldBoards, checkinGaps, competitionProgress, competitionSorts, matchTitle, planAdvance, withdrawnEntryIds,
  type AttentionItem, type AttentionTarget, type CompetitionProgress, type FieldBoard
} from '../lib/eventDay';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useEventDayData } from '../lib/useEventDayData';
import { fetchFinalizePreflight } from '../data/finalization';
import { RECORD_LABEL, blockerLine, recordState, type RecordState } from '../lib/finalization';
import { NextFight } from '../components/eventday/NextFight';
import { ReviewSheet } from '../components/ReviewSheet';
import { clearManualQueue, saveQueuePlan } from '../data/eventDay';
import { heldMatches, planEvent, planIsSaved } from '../lib/eventPlan';

const dayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

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
  // The record state of each competition (official / ready / reopened ...). For the ones that are ready, the server says whether something still stands in the way.
  const records = useMemo(() => new Map(competitions.map(c => [c.id, recordState(c, live.matches.filter(m => m.competitionId === c.id))])), [competitions, live.matches]);
  const readyIds = useMemo(() => competitions.filter(c => records.get(c.id) === 'ready').map(c => c.id), [competitions, records]);
  const checks = useAsync(async () => new Map(await Promise.all(readyIds.map(async id => [id, blockerLine(await fetchFinalizePreflight(id))] as const))), [readyIds.join(','), live.updatedAt]);
  const allOfficial = competitions.length > 0 && competitions.every(c => records.get(c.id) === 'official' || records.get(c.id) === 'no_draw') && competitions.some(c => records.get(c.id) === 'official');
  const names = useMemo(() => new Map(competitions.map(c => [c.id, c.name])), [competitions]);
  const gaps = useMemo(() => checkinGaps(boards, live.entries, roster.data ?? [], regs.data ?? []), [boards, live.entries, roster.data, regs.data]);
  // ---- Pack 09D: the event-wide fight plan (rest across every field and competition), recomputed on every change and saved when it differs
  const today = dayIn(timeZone);
  const sides = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of live.entries) m.set(e.id, e.fighterId ? [e.fighterId] : (roster.data ?? []).filter(r => r.entryId === e.id).map(r => r.fighterId));
    return m;
  }, [live.entries, roster.data]);
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of live.entries) if (e.fighterId) m.set(e.fighterId, e.name);
    for (const r of roster.data ?? []) m.set(r.fighterId, r.displayName);
    return m;
  }, [live.entries, roster.data]);
  const plan = useMemo(() => planEvent({ matches: live.matches, entries: live.entries, roster: roster.data ?? [], registrations: regs.data ?? [], sorts, withdrawn, today, fieldCount: event.fieldCount }),
    [live.matches, live.entries, roster.data, regs.data, sorts, withdrawn, today, event.fieldCount]);
  const byMatch = useMemo(() => new Map(live.matches.map(m => [m.id, m])), [live.matches]);
  const saving = useRef<string | null>(null);
  const [planOff, setPlanOff] = useState(false);
  useEffect(() => {
    if (planOff || live.loading || roster.loading || !roster.data || planIsSaved(plan, live.matches)) return;
    const signature = JSON.stringify([plan.upcoming, heldMatches(plan)]);
    if (saving.current === signature) return;
    const t = window.setTimeout(() => {
      if (busyRef.current) return;
      saving.current = signature;
      saveQueuePlan(event.id, plan.upcoming, heldMatches(plan)).then(() => live.refresh()).catch(e => {
        // The plan is a convenience: without the database update (PGRST202) or the right (42501) the queue keeps its previous order.
        const code = (e as { code?: string } | null)?.code;
        if (code === 'PGRST202' || code === '42501') setPlanOff(true);
        saving.current = null;
      });
    }, 1200);
    return () => window.clearTimeout(t);
  }, [plan, live.matches, live.loading, roster.loading, roster.data, planOff, event.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const notReady = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of checkinGaps(boards, live.entries, roster.data ?? [], regs.data ?? [], 6)) m.set(g.matchId, [...(m.get(g.matchId) ?? []), g.name]);
    return m;
  }, [boards, live.entries, roster.data, regs.data]);
  const held = plan.waiting.filter(w => w.code === 'unavailable');
  const [reviewing, setReviewing] = useState<string | null>(null);

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

  const nextActions = {
    busy,
    run: (m: CompetitionMatch) => void run(async () => {
      await setQueue(m.id, 'active', null);
      await advanceFieldQueue(event.id, m.field, false).catch(() => undefined);
      return `Started: ${matchTitle(m)}.`;
    }),
    choose: (m: CompetitionMatch, startNow: boolean) => void run(async () => {
      if (startNow) {
        await setQueue(m.id, 'active', null);
        await advanceFieldQueue(event.id, m.field, false).catch(() => undefined);
        return `Started: ${matchTitle(m)}.`;
      }
      const r = await moveMatchInQueue(m.id, 'first');
      return r.changed ? `${matchTitle(m)} is next.` : 'It is already next.';
    })
  };
  const replanField = (b: FieldBoard) => void run(async () => {
    const r = await clearManualQueue(event.id, b.name);
    return r.changed > 0 ? `BuhurtOS plans ${b.name} again.` : undefined;
  });

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
          <h3>The tournament is not built yet</h3>
          <p>Build tournament turns the registrations into draws, fields and a fight order in one step. You check the plan before anything is created.</p>
          <Link className="btn btn-ink" to={`/events/${slug}/manage?tab=build`}>Build tournament</Link>
          <Link className="btn btn-line" to={`/events/${slug}/manage?tab=run`}>Build one draw by hand (Run)</Link>
        </div>
      )}

      {held.length > 0 && (
        <p className="panel info ed-held" role="status"><b>{held.length} fight{held.length === 1 ? ' is' : 's are'} held back:</b> someone in {held.length === 1 ? 'it' : 'them'} registered for another day ({[...new Set(held.flatMap(w => w.fighters.map(f => people.get(f) ?? 'a fighter')))].join(', ')}). You can still call {held.length === 1 ? 'it' : 'them'} by hand from the line.</p>
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
            <FieldBoardView board={b} plan={plans.get(b.key)!} c={{ slug, timeZone, competitionNames: names, actions }} next={<>
              <NextFight field={b.key} label={b.name} plan={plan} matches={byMatch} fighting={b.now.length > 0} sides={sides} names={people} competitionNames={names} notReady={notReady} actions={nextActions} />
              {b.upcoming.some(m => m.queueOrder != null) && (
                <p className="src ed-manual">This field's line was arranged by hand, so BuhurtOS follows it. <button type="button" className="linklike" disabled={busy} onClick={() => replanField(b)}>Let BuhurtOS plan it again</button></p>
              )}
            </>} />
          </div>
        ))}
      </div>

      <div className="ed-lower">
        <AttentionPanel items={attention} href={href} loadingNotes={[clashes.error != null && 'double-bookings', regs.error != null && 'check-in', reviews.error != null && 'results needing review'].filter((x): x is string => !!x)}
          reviewCount={reviews.data?.length ?? 0} eventId={event.id} onReviewed={() => { void live.refresh(); setTick(k => k + 1); }} />
        <ProgressPanel progress={progress} records={records} checks={checks.data ?? new Map()} runHref={`/events/${slug}/manage?tab=run`} resultsHref={`/events/${slug}/manage?tab=finalize`} buildHref={`/events/${slug}/manage?tab=build`} closed={!!event.closedAt} allOfficial={allOfficial} onReview={setReviewing} />
      </div>

      {reviewing && competitions.some(c => c.id === reviewing) && (
        <ReviewSheet event={event} competition={competitions.find(c => c.id === reviewing)!} onClose={() => setReviewing(null)} onChanged={() => { void live.refresh(); setTick(k => k + 1); }} />
      )}
      <nav className="panel info ed-links" aria-label="More event tools">
        <b>More tools</b>
        <div>
          <Link className="btn btn-line" to={`/events/${slug}/manage?tab=run`}>Run tools: draws, times, fields</Link>
          <Link className="btn btn-line" to={`/events/${slug}/manage?tab=checkin`}>Check-in</Link>
          <Link className="btn btn-line" to={`/events/${slug}/manage?tab=competitions`}>Competitions</Link>
          <Link className="btn btn-line" to={`/events/${slug}`}>Public event page</Link>
          <Link className="btn btn-line" to={`/events/${slug}/arena`}>Live display (big screen)</Link>
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

function ProgressPanel({ progress, records, checks, runHref, resultsHref, buildHref, closed, allOfficial, onReview }: {
  progress: CompetitionProgress[]; records: ReadonlyMap<string, RecordState>; checks: ReadonlyMap<string, string | null>; runHref: string; resultsHref: string; buildHref: string; closed: boolean; allOfficial: boolean;
  onReview: (competitionId: string) => void;
}) {
  // Pack 09D: an offered competition with no draw is one line, not a card each (nobody entered, or it is waiting to be built).
  const unbuilt = closed ? [] : progress.filter(p => p.total === 0);
  const shown = closed ? progress : progress.filter(p => p.total > 0);
  return (
    <section className="panel info ed-progress" aria-labelledby="ed-prog-h" style={{ display: 'grid', gap: 10 }}>
      <h2 id="ed-prog-h" className="ed-h">Competition progress</h2>
      {closed && <p className="ed-calm" role="status"><b>This event is closed.</b> Its results are the permanent record. <Link to={resultsHref}>See the results and closeout</Link></p>}
      {!closed && allOfficial && <p role="status" style={{ margin: 0 }}><b>Every competition is official.</b> <Link className="btn btn-ink btn-sm" to={`${resultsHref}#closeout`}>Close the event</Link></p>}
      {unbuilt.length > 0 && <p className="src">Not built: {unbuilt.map(p => p.name).join(', ')}. <Link to={buildHref}>Build tournament</Link></p>}
      <ul className="ed-prog-list">
        {shown.map(p => {
          const record = records.get(p.id) ?? 'running';
          const blocker = record === 'ready' ? checks.get(p.id) ?? null : null;
          const phase = record === 'official' ? 'official' : record === 'ready' ? (blocker ? 'blocked' : 'ready') : record === 'reopened' ? 'reopened' : p.phase;
          const label = record === 'official' ? 'Official' : record === 'ready' ? (blocker ? 'Needs review' : 'Ready to finalize') : record === 'reopened' ? RECORD_LABEL.reopened : p.label;
          return (
            <li key={p.id}>
              <div className="ed-prog-head"><b>{p.name}</b><span className={`ed-phase ed-phase-${phase}`}>{label}</span></div>
              {p.total > 0 && (
                <div className="ed-bar" role="progressbar" aria-label={`${p.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}><i style={{ width: `${p.percent}%` }} /></div>
              )}
              <span className="src">{p.total > 0 ? `${p.final} / ${p.total} fights complete · ${p.percent}%` : closed ? 'Never ran: no draw was built, so it was closed as not held.' : 'Build a draw in the Run tools to see its fights here.'}{blocker ? ` · ${blocker}` : ''}</span>
              {p.needsBracket && !closed && <Link className="btn btn-line btn-sm" to={runHref}>Build the bracket</Link>}
              {record === 'ready' && !blocker && <button type="button" className="btn btn-ink btn-sm" onClick={() => onReview(p.id)}>Review wins &amp; losses</button>}
              {record === 'ready' && blocker && <button type="button" className="btn btn-line btn-sm" onClick={() => onReview(p.id)}>Review wins &amp; losses</button>}
              {record === 'official' && <Link className="btn btn-line btn-sm" to={`${resultsHref}&competition=${p.id}`}>Official results</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type { FieldBoard };
