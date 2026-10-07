import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnnouncementPanel } from '../../components/AnnouncementPanel';
import { CameraOffControl } from '../../components/CameraOffControl';
import { BroadcastPanel } from '../../components/command/BroadcastPanel';
import { CommandSection as Section } from '../../components/command/CommandSection';
import { CounterQrCard } from '../../components/command/CounterQrCard';
import { DevicesPanel } from '../../components/command/DevicesPanel';
import { StaffNamesPanel } from '../../components/command/StaffNamesPanel';
import { FieldBoardView, type BoardActions } from '../../components/eventday/FieldBoardView';
import { NextFight } from '../../components/eventday/NextFight';
import { ResultConflicts } from '../../components/ResultReview';
import { ReviewSheet } from '../../components/ReviewSheet';
import { Seg } from '../../components/ui';
import type { LiveCompetition, LiveEvent } from '../../data/api';
import { fetchCommandSnapshot } from '../../data/command';
import { fetchScheduleConflicts } from '../../data/conflicts';
import { advanceFieldQueue, clearManualQueue, fetchEventRoster, fetchRegistrationFlags, moveMatchInQueue, saveQueuePlan, type QueueMove } from '../../data/eventDay';
import { fetchFinalizePreflight } from '../../data/finalization';
import { fetchResultConflicts, setQueue, type CompetitionMatch } from '../../data/matches';
import {
  commandAttention, deskHref, eventProgress, FIELD_STATE_LABEL, fieldHref, fieldSummaries, fightsOverview, freshness, overallState, ROLE_NAMES, unassignedRoles,
  type CommandItem, type CommandSnapshot, type FightWarning
} from '../../lib/commandCentre';
import { controlPath, eventPath } from '../../lib/eventPhaseView';
import { buildFieldBoards, checkinGaps, competitionProgress, competitionSorts, fieldLabel, matchTitle, planAdvance, withdrawnEntryIds, type FieldBoard } from '../../lib/eventDay';
import { heldMatches, planEvent, planIsSaved } from '../../lib/eventPlan';
import { blockerLine, recordState } from '../../lib/finalization';
import { friendlyError } from '../../lib/friendlyError';
import { useLystPublic } from '../../lib/lyst/useLystPublic';
import { timeLabel } from '../../lib/runSchedule';
import { useAsync } from '../../lib/useAsync';
import { useEventDayData } from '../../lib/useEventDayData';
import { ProgressPanel } from './ProgressPanel';

const SNAPSHOT_MS = 20_000;
const dayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Notice = { kind: 'ok' | 'error'; text: string } | null;

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}
function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/**
 * Event Control › Live ops (Pack 25): ONE hub for running the day. It is the Command Centre (what needs attention, readiness, staff, broadcast, Camera Off,
 * devices) and the old Event day screen (the fields with their queues: start the next fight, change the order, who is next) in one place, in the order the
 * day needs them. Who may open it: organizers, the head marshal, the Secretary / Scorekeeper and a Temporary Organizer device; the database decides
 * (event_command_snapshot refuses everyone else) and `viewer` says what each may do. Reading is live (the shared realtime + polling machinery); every change
 * goes through a database function that checks the caller again. Scoring stays on the Lyst; this page only opens it.
 */
export function LiveOps({ event, competitions, organizer, onEventChanged }: { event: LiveEvent; competitions: LiveCompetition[]; organizer: boolean; onEventChanged: () => void }) {
  // ---- the private part (readiness, staff, who I am here), every 20 s, after a live change, and on reconnect / focus
  const [snap, setSnap] = useState<CommandSnapshot | null>(null);
  const [snapError, setSnapError] = useState<unknown>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [refused, setRefused] = useState(false);
  const [tick, setTick] = useState(0);
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try { const s = await fetchCommandSnapshot(event.id); setSnap(s); setSnapError(null); setLastOk(Date.now()); setTick(k => k + 1); }
    catch (e) { const code = (e as { code?: string } | null)?.code; if (code === '42501' || code === '28000' || code === 'PGRST301') setRefused(true); setSnapError(e); }
    finally { loading.current = false; }
  }, [event.id]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, SNAPSHOT_MS);
    const again = () => void load();
    window.addEventListener('online', again); window.addEventListener('focus', again);
    return () => { window.clearInterval(t); window.removeEventListener('online', again); window.removeEventListener('focus', again); };
  }, [load]);

  const allowed = (snap !== null && !refused) || organizer;
  const operator = organizer || snap?.viewer.operator === true;
  // ---- the live part: the queues on every field (shared machinery: realtime with unique channels, polling fallback)
  const ids = useMemo(() => (allowed ? competitions.map(c => c.id) : []), [allowed, competitions]);
  const live = useEventDayData(ids);
  const lyst = useLystPublic(event.id, allowed);
  useEffect(() => { if (live.updatedAt === null) return; const t = window.setTimeout(() => void load(), 1500); return () => window.clearTimeout(t); }, [live.updatedAt, load]);
  const conflicts = useAsync(() => (allowed ? fetchResultConflicts(event.id) : Promise.resolve([])), [allowed, event.id], [tick]);
  const clashes = useAsync(() => (allowed ? fetchScheduleConflicts(event.id) : Promise.resolve([])), [allowed, event.id], [tick]);
  // the organizer's extra: rosters and check-in flags (private tables) for the event-wide fight plan and "not ready" names on the boards
  const roster = useAsync(() => (organizer ? fetchEventRoster(ids) : Promise.resolve([])), [organizer, ids.join(',')], [tick]);
  const regs = useAsync(() => (organizer ? fetchRegistrationFlags(event.id) : Promise.resolve([])), [organizer, event.id], [tick]);

  const now = useNow(5000);
  const online = useOnline();
  const fresh = freshness(lastOk, now, online);
  const tz = snap?.event.timezone ?? event.timezone ?? 'America/Edmonton';

  const sorts = useMemo(() => competitionSorts(competitions), [competitions]);
  const withdrawn = useMemo(() => withdrawnEntryIds(live.entries), [live.entries]);
  const boards = useMemo(() => buildFieldBoards(live.matches, sorts, withdrawn), [live.matches, sorts, withdrawn]);
  const plans = useMemo(() => new Map(boards.map(b => [b.key, planAdvance(b, withdrawn, sorts, { start: true })])), [boards, withdrawn, sorts]);
  const progress = useMemo(() => competitions.map(c => competitionProgress(c, live.matches.filter(m => m.competitionId === c.id))), [competitions, live.matches]);
  const names = useMemo(() => new Map(competitions.map(c => [c.id, c.name])), [competitions]);
  const fields = useMemo(() => (snap ? fieldSummaries(boards, lyst.rows, snap.fightWarnings, new Date(now)) : []), [boards, lyst.rows, snap, now]);
  const items = useMemo(() => (snap ? commandAttention({
    snapshot: snap, boards, progress, clashes: clashes.data ?? [], conflicts: conflicts.data ?? [], fields, withdrawn, competitionNames: names, now: new Date(now),
    links: { slug: event.slug, organizer: snap.viewer.organizer }
  }) : []), [snap, boards, progress, clashes.data, conflicts.data, fields, withdrawn, names, now, event.slug]);
  // the record state of each competition (official / ready / reopened ...); for the ones that are ready, the server says what still stands in the way
  const records = useMemo(() => new Map(competitions.map(c => [c.id, recordState(c, live.matches.filter(m => m.competitionId === c.id))])), [competitions, live.matches]);
  const readyIds = useMemo(() => (organizer ? competitions.filter(c => records.get(c.id) === 'ready').map(c => c.id) : []), [organizer, competitions, records]);
  const checks = useAsync(async () => new Map(await Promise.all(readyIds.map(async id => [id, blockerLine(await fetchFinalizePreflight(id))] as const))), [readyIds.join(',')], [live.updatedAt]);
  const allOfficial = competitions.length > 0 && competitions.every(c => records.get(c.id) === 'official' || records.get(c.id) === 'no_draw') && competitions.some(c => records.get(c.id) === 'official');

  // ---- Pack 09D: the event-wide fight plan (rest across every field and competition), recomputed on every change and saved when it differs (organizer)
  const today = dayIn(tz);
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
  const busyRef = useRef(false);
  useEffect(() => {
    if (!organizer || planOff || live.loading || roster.loading || !roster.data || planIsSaved(plan, live.matches)) return;
    const signature = JSON.stringify([plan.upcoming, heldMatches(plan)]);
    if (saving.current === signature) return;
    const t = window.setTimeout(() => {
      if (busyRef.current) return;
      saving.current = signature;
      saveQueuePlan(event.id, plan.upcoming, heldMatches(plan)).then(() => live.refresh()).catch(e => {
        // the plan is a convenience: without the database update (PGRST202) or the right (42501) the queue keeps its previous order
        const code = (e as { code?: string } | null)?.code;
        if (code === 'PGRST202' || code === '42501') setPlanOff(true);
        saving.current = null;
      });
    }, 1200);
    return () => window.clearTimeout(t);
  }, [organizer, plan, live.matches, live.loading, roster.loading, roster.data, planOff, event.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const notReady = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of checkinGaps(boards, live.entries, roster.data ?? [], regs.data ?? [], 6)) m.set(g.matchId, [...(m.get(g.matchId) ?? []), g.name]);
    return m;
  }, [boards, live.entries, roster.data, regs.data]);
  const held = plan.waiting.filter(w => w.code === 'unavailable');
  const [reviewing, setReviewing] = useState<string | null>(null);

  // ---- doing things: one at a time, then read everything again
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const run = async (fn: () => Promise<string | undefined>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try { const text = await fn(); await live.refresh(); void load(); if (text) setNotice({ kind: 'ok', text }); }
    catch (e) {
      const missing = (e as { code?: string } | null)?.code === 'PGRST202';
      setNotice({ kind: 'error', text: missing ? 'This needs a database update that has not been applied yet. Ask whoever looks after BuhurtOS.' : friendlyError(e) });
      await live.refresh().catch(() => undefined);
    }
    finally { busyRef.current = false; setBusy(false); }
  };
  const actions: BoardActions = {
    busy,
    startNext: board => void run(async () => {
      const r = await advanceFieldQueue(event.id, board.name, true);
      const started = r.promoted.find(p => p.to === 'active');
      const m = started ? byMatch.get(started.match) : undefined;
      return m ? `Started: ${matchTitle(m)}.` : r.promoted.length > 0 ? 'The queue behind the fight is filled.' : 'Nothing is ready to start on this Lyst.';
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
    return r.changed > 0 ? `BuhurtOS plans ${fieldLabel(b.name)} again.` : undefined;
  });

  // ---- which field is showing on a phone (wide screens show them all)
  const [picked, setPicked] = useState<string | null>(null);
  const pickedKey = boards.some(b => b.key === picked) ? picked! : (boards.find(b => b.now.length > 0) ?? boards[0])?.key ?? '';

  const slug = event.slug;
  const stamp = lastOk ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(lastOk)) : '—';
  const clockText = new Intl.DateTimeFormat('en-CA', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));

  if (refused && !organizer) {
    return (
      <section className="panel info" role="status" style={{ display: 'grid', gap: 10 }}>
        <p><b>Live ops is for this event's organizers, head marshal and secretary.</b> You do not have any of those roles here.</p>
        <p><Link className="btn btn-line" to={eventPath(slug)}>Back to the event</Link></p>
      </section>
    );
  }
  if (!snap && !organizer) {
    return snapError != null
      ? <section className="panel info" style={{ display: 'grid', gap: 10 }}><p role="alert">{friendlyError(snapError, 'Could not load Live ops.')}</p><button type="button" className="btn btn-line" onClick={() => void load()}>Try again</button></section>
      : <p className="muted" role="status">Loading Live ops…</p>;
  }
  if (competitions.length === 0) {
    return (
      <div className="panel info ed-empty" style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
        <h3>No competitions yet</h3>
        <p>Add the competitions {event.name} runs, then build their draws. The fields appear here as soon as there are matches.</p>
        {organizer && <Link className="btn btn-ink" to={controlPath(slug, 'setup', 'competitions')}>+ Add competition</Link>}
      </div>
    );
  }

  const viewer = snap?.viewer ?? { organizer, announce: organizer, operator: organizer, cameraOff: false, cameraRelease: false, broadcast: false };
  const overall = overallState(items);
  const warnByMatch = new Map<string, FightWarning[]>();
  for (const w of snap?.fightWarnings ?? []) warnByMatch.set(w.matchId, [...(warnByMatch.get(w.matchId) ?? []), w]);
  const fights = fightsOverview(boards);
  const prog = eventProgress(progress);
  const r = snap?.readiness;
  const unassigned = snap ? unassignedRoles(snap.staff) : [];
  const fieldNames = boards.map(b => b.name);

  return (
    <section className="cmd-centre lo" aria-label="Live ops" data-testid="control-live">
      <header className={`cc-head tone-${overall.tone}`}>
        <p className="cc-overall" role="status" aria-live="polite">{overall.tone === 'ok' ? '✓ ' : '⚠ '}{overall.headline}</p>
        <p className="cc-meta ed-status">
          {live.connection === 'live' && <span className="ed-live on" role="status">● Live</span>}
          {live.connection === 'polling' && <span className="ed-live" role="status">Refreshing every few seconds</span>}
          <span className="src">{clockText} at the event</span>
          <span className={`cc-fresh is-${fresh}`} data-testid="cc-fresh">{fresh === 'live' ? `Updated ${stamp}` : fresh === 'offline' ? `Offline · last updated ${stamp}` : `Not updating · last updated ${stamp}`}</span>
          <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void run(async () => undefined)}>Refresh</button>
        </p>
      </header>
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="panel info ed-notice" style={notice.kind === 'error' ? { color: 'var(--live)' } : undefined}>{notice.text}</p>}
      {snapError != null && !snap && <p className="src" role="status">Readiness and staff could not be read just now. It will try again.</p>}

      {/* Camera Off: the safety control, for everyone who may protect the broadcast; it hides itself for anyone who may not even read the state */}
      <div className="cc-camera"><CameraOffControl eventId={event.id} /></div>

      <Section id="cc-attention" title="Needs attention" count={items.filter(i => i.urgency !== 'info').length} open>
        {items.length === 0 ? <p className="cc-empty">{snap ? 'Nothing needs you right now. Fights, check-in and armour are in order.' : 'Checking…'}</p> : <AttentionList items={items} />}
        {organizer && (conflicts.data?.length ?? 0) > 0 && <div id="review" tabIndex={-1}><ResultConflicts eventId={event.id} onChanged={() => { void live.refresh(); void load(); }} /></div>}
      </Section>

      {/* the fields: the operator's boards (start the next fight, change the line); for the others, what is on and what is next */}
      <section className="lo-fields" aria-label="Fields">
        <h2 className="cc-h lo-h">Lysts{boards.length > 0 && <span className="cc-count">{boards.length} {boards.length === 1 ? 'Lyst' : 'Lysts'}</span>}</h2>
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
            <p>Build tournament turns the registrations into draws, Lysts and a fight order in one step. You check the plan before anything is created.</p>
            {organizer && <><Link className="btn btn-ink" to={controlPath(slug, 'setup', 'build')}>Build tournament</Link><Link className="btn btn-line" to={controlPath(slug, 'setup', 'run')}>Build one draw by hand</Link></>}
          </div>
        )}
        {held.length > 0 && (
          <p className="panel info ed-held" role="status"><b>{held.length} fight{held.length === 1 ? ' is' : 's are'} held back:</b> someone in {held.length === 1 ? 'it' : 'them'} registered for another day ({[...new Set(held.flatMap(w => w.fighters.map(f => people.get(f) ?? 'a fighter')))].join(', ')}). You can still call {held.length === 1 ? 'it' : 'them'} by hand from the line.</p>
        )}
        {operator && boards.length > 1 && (
          <div className="ed-picker">
            <Seg scroll label="Lyst" value={pickedKey} onChange={setPicked} options={boards.map(b => [b.key, `${fieldLabel(b.name)}${b.now.length > 0 ? ' · live' : ''}`] as const)} />
          </div>
        )}
        {operator ? (
          <div className="ed-fields">
            {boards.map(b => (
              <div key={b.key} className={`ed-field-wrap${b.key === pickedKey ? ' picked' : ''}`}>
                <FieldBoardView board={b} plan={plans.get(b.key)!} c={{ slug, timeZone: tz, competitionNames: names, actions }} next={<>
                  <NextFight field={b.key} label={fieldLabel(b.name)} plan={plan} matches={byMatch} fighting={b.now.length > 0} called={b.onDeck.length > 0} sides={sides} names={people} competitionNames={names} notReady={notReady} actions={nextActions} />
                  {b.upcoming.some(m => m.queueOrder != null) && (
                    <p className="src ed-manual">This Lyst's line was arranged by hand, so BuhurtOS follows it. <button type="button" className="linklike" disabled={busy} onClick={() => replanField(b)}>Let BuhurtOS plan it again</button></p>
                  )}
                </>} />
              </div>
            ))}
          </div>
        ) : fields.length > 0 && (
          <div className="cc-fields">
            {fields.map(f => (
              <article key={f.key} className={`cc-field state-${f.state} panel`} aria-label={fieldLabel(f.name)}>
                <div className="cc-field-head"><h3>{fieldLabel(f.name)}</h3><span className="cc-state">{FIELD_STATE_LABEL[f.state]}{f.round ? ` · round ${f.round}` : ''}</span></div>
                {f.current && <p><span className="src">On now</span><br /><b>{matchTitle(f.current)}</b></p>}
                {f.next && <p><span className="src">Next</span><br />{matchTitle(f.next)}{f.next.scheduledAt ? <span className="src"> · {timeLabel(f.next.scheduledAt, tz)}</span> : null}</p>}
                <p className="src">{f.queueDepth} waiting on this Lyst{f.behindMinutes !== null ? ` · ${f.behindMinutes} min behind schedule` : ''}</p>
                {f.warnings.length > 0 && <p className="cc-warn">⚠ Not ready: {f.warnings.map(w => `${w.name} (${(w.reasons[0] ?? 'not ready').toLowerCase()})`).join(', ')}</p>}
                <Link className="btn btn-ink cc-btn" to={`${fieldHref(slug, f.name)}?from=control`}>Open Lyst Control · {fieldLabel(f.name)}</Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <nav className="panel info lo-stations" aria-label="Workstations">
        <h2 className="cc-h lo-h">Workstations</h2>
        <p className="src">Each one is a full-screen job for one person and one phone. Exit brings them back here.</p>
        <div className="lo-station-row">
          {fieldNames.map(f => <Link key={f} className="btn btn-ink" to={`${fieldHref(slug, f)}?from=control`} data-testid="station-lyst">Lyst Control · {fieldLabel(f)}</Link>)}
          <Link className="btn btn-line" to={`${deskHref(slug)}?from=control`} data-testid="station-desk">Check-in desk</Link>
          <Link className="btn btn-line" to={`/events/${slug}/announcer`}>Announcer</Link>
          <Link className="btn btn-line" to={`/events/${slug}/arena`}>Big screen</Link>
          <Link className="btn btn-line" to={`/events/${slug}/discipline`}>Cards and penalties</Link>
        </div>
      </nav>

      <Section id="cc-counters" title="Counter QR" open={fieldNames.length > 0}>
        <CounterQrCard eventId={event.id} compact />
        {organizer && <p><Link className="btn btn-line cc-btn" to={controlPath(slug, 'live', 'devices')}>Phones signed in, move or sign one out</Link></p>}
      </Section>
      {/* the organizer's device codes (Pack 18.1), folded: the day's phones are managed from the Counters and devices tool */}
      {organizer && <DevicesPanel eventId={event.id} eventName={event.name} timezone={tz} refreshKey={tick} />}

      {r && (
        <Section id="cc-fighters" title="Fighters" count={r.notReady} countLabel="not ready">
          <div className="cc-tiles">
            <Tile n={r.fighters} label="expected" href={deskHref(slug, 'all')} />
            <Tile n={r.missing} label="not here yet" href={deskHref(slug, 'missing')} warn={r.missing > 0} />
            <Tile n={r.arrived} label="arrived, not in" href={deskHref(slug, 'arrived')} warn={r.arrived > 0} />
            <Tile n={r.checkedIn} label="checked in" href={deskHref(slug, 'all')} />
            <Tile n={r.ready} label="ready" href={deskHref(slug, 'ready')} />
            <Tile n={r.notReady} label="not ready" href={deskHref(slug, 'not_ready')} warn={r.notReady > 0} />
            <Tile n={r.needsInspection} label="to inspect" href={deskHref(slug, 'needs_inspection')} />
            <Tile n={r.needsCorrection + r.failed} label="armour issues" href={deskHref(slug, 'issues')} warn={r.needsCorrection + r.failed > 0} />
          </div>
          {snap && snap.fightWarnings.length > 0 && (
            <div className="cc-sub">
              <h3>Fighting soon, not ready</h3>
              <ul className="cc-list">
                {soonestWarnings(snap.fightWarnings, boards).map(({ w, slot, field }) => (
                  <li key={w.fighterId}><b>{w.name}</b> <span className="src">{slot}{field ? `, ${field}` : ''}</span><br /><span>{w.reasons.join(' · ') || 'Not ready'}</span></li>
                ))}
              </ul>
            </div>
          )}
          <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Link className="btn btn-line cc-btn" to={`${deskHref(slug)}?from=control`}>Open the check-in desk</Link>{organizer && <Link className="btn btn-line cc-btn" to={controlPath(slug, 'live', 'checkin')}>Check-in list</Link>}</p>
        </Section>
      )}

      <ProgressPanel progress={progress} records={records} checks={checks.data ?? new Map()} runHref={controlPath(slug, 'setup', 'run')} resultsHref={controlPath(slug, 'results')} buildHref={controlPath(slug, 'setup', 'build')} closed={!!event.closedAt} allOfficial={allOfficial} onReview={organizer ? setReviewing : undefined} />
      {reviewing && competitions.some(c => c.id === reviewing) && (
        <ReviewSheet event={event} competition={competitions.find(c => c.id === reviewing)!} onClose={() => setReviewing(null)} onChanged={() => { void live.refresh(); void load(); onEventChanged(); }} />
      )}

      <Section id="cc-fights" title="Fights" count={fights.on.length} countLabel="on now">
        <FightList title="On now" rows={fights.on} warn={warnByMatch} tz={tz} empty="No fight is on." />
        <FightList title="Called next" rows={fights.called} warn={warnByMatch} tz={tz} empty="Nothing called yet." />
        <FightList title="Coming up" rows={fights.later} warn={warnByMatch} tz={tz} empty="Nothing else is ready to run." />
        <p className="src">{prog.final} of {prog.total} fights scored · {prog.remaining} to go. No finish time is estimated: the data cannot support one honestly.</p>
      </Section>

      {snap && <BroadcastPanel eventId={event.id} slug={slug} fieldNames={fieldNames} configured={snap.broadcast.configured} organizer={viewer.organizer} refreshKey={tick} />}

      {viewer.announce && (
        <Section id="cc-announce" title="Announcements">
          <AnnouncementPanel eventId={event.id} published={event.status === 'published'} />
        </Section>
      )}

      {snap && (
        <Section id="cc-staff" title="Staff" count={snap.staff.reduce((n, s) => n + s.names.length, 0)} countLabel="assigned">
          <p className="src">Who is assigned to this event. BuhurtOS does not know who is physically here.</p>
          {viewer.operator
            ? <StaffNamesPanel eventId={event.id} viewerIsOrganizer={viewer.organizer} refreshKey={tick} />
            : <dl className="cc-staff">{snap.staff.map(s => <div key={s.role}><dt>{ROLE_NAMES[s.role] ?? s.role}</dt><dd>{s.names.join(', ')}</dd></div>)}</dl>}
          {unassigned.length > 0 && <p className="src">Nobody assigned as: {unassigned.map(x => ROLE_NAMES[x] ?? x).join(', ')}.</p>}
          {organizer && <p><Link className="btn btn-line cc-btn" to={controlPath(slug, 'setup', 'staff')}>Staff and roles</Link></p>}
        </Section>
      )}
    </section>
  );
}

/** One line per fighter, at their most urgent fight (fighting now before on deck before in the hole before coming up). */
function soonestWarnings(warnings: readonly FightWarning[], boards: readonly FieldBoard[]) {
  const SLOTS = ['fighting now', 'on deck', 'in the hole', 'coming up'] as const;
  const where = (id: string) => {
    for (const b of boards) {
      const at = b.now.some(m => m.id === id) ? 0 : b.onDeck.some(m => m.id === id) ? 1 : b.inTheHole.some(m => m.id === id) ? 2 : b.upcoming.some(m => m.id === id) || b.waiting.some(x => x.match.id === id) ? 3 : -1;
      if (at >= 0) return { rank: at, field: b.name };
    }
    return { rank: 3, field: null as string | null };
  };
  const best = new Map<string, { w: FightWarning; rank: number; field: string | null }>();
  for (const w of warnings) { const p = where(w.matchId); const cur = best.get(w.fighterId); if (!cur || p.rank < cur.rank) best.set(w.fighterId, { w, ...p }); }
  return [...best.values()].sort((a, b) => a.rank - b.rank || a.w.name.localeCompare(b.w.name)).map(x => ({ w: x.w, slot: SLOTS[x.rank], field: x.field }));
}

/** The urgent items first and in full; the rest fold, so the fields are never pushed off a phone screen by a long list. */
function AttentionList({ items }: { items: CommandItem[] }) {
  const [all, setAll] = useState(false);
  const urgent = items.filter(i => i.urgency === 'now' || i.urgency === 'soon');
  const shown = all ? items : (urgent.length > 0 ? urgent.slice(0, 3) : items.slice(0, 2));
  const rest = items.length - shown.length;
  return (
    <>
      <ul className="cc-items">{shown.map(i => <Item key={i.id} item={i} />)}</ul>
      {rest > 0 && <p><button type="button" className="btn btn-line btn-sm" aria-expanded={all} onClick={() => setAll(true)} data-testid="attention-more">{rest} more</button></p>}
      {all && items.length > 3 && <p><button type="button" className="btn btn-line btn-sm" onClick={() => setAll(false)}>Fewer</button></p>}
    </>
  );
}

const URGENCY_WORD: Record<CommandItem['urgency'], string> = { now: 'Now', soon: 'Soon', later: 'Later', info: 'FYI' };
function Item({ item: i }: { item: CommandItem }) {
  const local = i.href.startsWith('#');
  return (
    <li className={`cc-item u-${i.urgency}`}>
      <span className="cc-urg">{URGENCY_WORD[i.urgency]}</span>
      <div className="cc-item-body">
        <b className="cc-what">{i.what}</b>
        {i.who && <span className="cc-who">{i.who}</span>}
        {i.where && <span className="src">{i.where}</span>}
      </div>
      {local ? <a className="btn btn-ink cc-act" href={i.href}>{i.action}</a> : <Link className="btn btn-ink cc-act" to={i.href}>{i.action}</Link>}
    </li>
  );
}

function Tile({ n, label, href, warn }: { n: number; label: string; href: string; warn?: boolean }) {
  return <Link className={`cc-tile${warn ? ' warn' : ''}`} to={href}><b>{n}</b><span>{label}</span></Link>;
}

function FightList({ title, rows, warn, tz, empty }: { title: string; rows: { match: CompetitionMatch; field: string }[]; warn: Map<string, FightWarning[]>; tz: string; empty: string }) {
  return (
    <div className="cc-sub">
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="src">{empty}</p> : (
        <ul className="cc-list">
          {rows.map(({ match: m, field }) => {
            const w = warn.get(m.id) ?? [];
            return (
              <li key={m.id}>
                <b>{matchTitle(m)}</b> <span className="src">{field}{m.scheduledAt ? ` · ${timeLabel(m.scheduledAt, tz)}` : ''}</span>
                {w.length > 0 && <><br /><span className="cc-warn">⚠ Not ready: {w.map(x => x.name).join(', ')}</span></>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
