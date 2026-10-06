import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { AnnouncementPanel } from '../components/AnnouncementPanel';
import { Chip, PageHead } from '../components/ui';
import { fetchEvent, type LiveCompetition, type LiveEvent } from '../data/api';
import { fetchCommandSnapshot } from '../data/command';
import { fetchScheduleConflicts } from '../data/conflicts';
import { fetchResultConflicts } from '../data/matches';
import {
  commandAttention, deskHref, eventProgress, FIELD_STATE_LABEL, fieldHref, fieldSummaries, fightsOverview, freshness, manageHref, overallState, ROLE_NAMES,
  unassignedRoles, type CommandItem, type CommandSnapshot, type FightWarning
} from '../lib/commandCentre';
import { buildFieldBoards, competitionProgress, competitionSorts, matchTitle, withdrawnEntryIds } from '../lib/eventDay';
import { friendlyError } from '../lib/friendlyError';
import { useLystPublic } from '../lib/lyst/useLystPublic';
import { timeLabel } from '../lib/runSchedule';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useEventDayData } from '../lib/useEventDayData';

const SNAPSHOT_MS = 20_000;

/**
 * Pack 18: the Organizer Command Centre. "If I am running the tournament, what needs my attention right now?"
 * Read-only by design: it reads the authoritative event-day state (queue, Lyst Control, readiness, result conflicts) and links to the existing
 * screen that fixes each thing. It never writes, never runs a clock, never scores, never reorders a queue. Organizers and the head marshal only;
 * the database decides that (event_command_snapshot refuses everyone else).
 */
export function CommandCentrePage() {
  const { eventId: slug = '' } = useParams();
  const { session, loading: authLoading } = useAuth();
  const ev = useAsync(() => fetchEvent(slug), [slug]);
  useDocumentTitle(ev.data ? `Command Centre · ${ev.data.event.name}` : 'Command Centre');
  if (authLoading || (ev.loading && !ev.data)) return <p className="muted" role="status">Loading…</p>;
  if (ev.error != null) return <p role="alert">{friendlyError(ev.error, 'Could not load this event.')}</p>;
  if (!ev.data) return <><PageHead eyebrow="Command Centre" title="Event not found" /><p>This event does not exist, or is not visible to you.</p></>;
  if (!session) return <><PageHead eyebrow="Command Centre" title={ev.data.event.name} /><SignIn reason="Sign in with the account that organizes this event, or as its head marshal." /></>;
  return <Command key={ev.data.event.id} event={ev.data.event} competitions={ev.data.competitions} />;
}

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

function Command({ event, competitions }: { event: LiveEvent; competitions: LiveCompetition[] }) {
  // ---- the private part (readiness, staff), from the database, every 20 s, after a live change, and on reconnect / focus
  const [snap, setSnap] = useState<CommandSnapshot | null>(null);
  const [snapError, setSnapError] = useState<unknown>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [refused, setRefused] = useState(false);
  const [tick, setTick] = useState(0);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try { const s = await fetchCommandSnapshot(event.id); setSnap(s); setSnapError(null); setLastOk(Date.now()); setTick(k => k + 1); }
    catch (e) { if ((e as { code?: string } | null)?.code === '42501') setRefused(true); setSnapError(e); }
    finally { busy.current = false; }
  }, [event.id]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, SNAPSHOT_MS);
    const again = () => void load();
    window.addEventListener('online', again); window.addEventListener('focus', again);
    return () => { window.clearInterval(t); window.removeEventListener('online', again); window.removeEventListener('focus', again); };
  }, [load]);

  const allowed = snap !== null && !refused;
  // ---- the public live part (shared machinery: realtime with unique channels, polling fallback). Only once the database said yes.
  const ids = useMemo(() => (allowed ? competitions.map(c => c.id) : []), [allowed, competitions]);
  const live = useEventDayData(ids);
  const lyst = useLystPublic(event.id, allowed);
  useEffect(() => { if (live.updatedAt === null) return; const t = window.setTimeout(() => void load(), 1500); return () => window.clearTimeout(t); }, [live.updatedAt, load]);
  const conflicts = useAsync(() => (allowed ? fetchResultConflicts(event.id) : Promise.resolve([])), [allowed, event.id], [tick]);
  const clashes = useAsync(() => (allowed ? fetchScheduleConflicts(event.id) : Promise.resolve([])), [allowed, event.id], [tick]);

  const now = useNow(5000);
  const online = useOnline();
  const fresh = freshness(lastOk, now, online);

  const sorts = useMemo(() => competitionSorts(competitions), [competitions]);
  const withdrawn = useMemo(() => withdrawnEntryIds(live.entries), [live.entries]);
  const boards = useMemo(() => buildFieldBoards(live.matches, sorts, withdrawn), [live.matches, sorts, withdrawn]);
  const progress = useMemo(() => competitions.map(c => competitionProgress(c, live.matches.filter(m => m.competitionId === c.id))), [competitions, live.matches]);
  const names = useMemo(() => new Map(competitions.map(c => [c.id, c.name])), [competitions]);
  const fields = useMemo(() => (snap ? fieldSummaries(boards, lyst.rows, snap.fightWarnings, new Date(now)) : []), [boards, lyst.rows, snap, now]);
  const items = useMemo(() => (snap ? commandAttention({
    snapshot: snap, boards, progress, clashes: clashes.data ?? [], conflicts: conflicts.data ?? [], fields, withdrawn, competitionNames: names, now: new Date(now),
    links: { slug: event.slug, organizer: snap.viewer.organizer }
  }) : []), [snap, boards, progress, clashes.data, conflicts.data, fields, withdrawn, names, now, event.slug]);

  if (refused) {
    return (
      <section className="panel info" role="status" style={{ display: 'grid', gap: 10 }}>
        <PageHead eyebrow="Command Centre" title={event.name} />
        <p><b>The Command Centre is for this event's organizers and head marshal.</b> Your account does not have either role here.</p>
        <p><Link className="btn btn-line" to={`/events/${event.slug}`}>Back to the event</Link></p>
      </section>
    );
  }
  if (!snap) {
    return snapError != null
      ? <section className="panel info" style={{ display: 'grid', gap: 10 }}><PageHead eyebrow="Command Centre" title={event.name} /><p role="alert">{friendlyError(snapError, 'Could not load the Command Centre.')}</p><button type="button" className="btn btn-line" onClick={() => void load()}>Try again</button></section>
      : <p className="muted" role="status">Loading the Command Centre…</p>;
  }

  const tz = snap.event.timezone;
  const organizer = snap.viewer.organizer;
  const overall = overallState(items);
  const clockText = new Intl.DateTimeFormat('en-CA', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
  const stamp = lastOk ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(lastOk)) : '—';
  const warnByMatch = new Map<string, FightWarning[]>();
  for (const w of snap.fightWarnings) warnByMatch.set(w.matchId, [...(warnByMatch.get(w.matchId) ?? []), w]);
  const fights = fightsOverview(boards);
  const prog = eventProgress(progress);
  const r = snap.readiness;
  const statusWord = snap.event.closed ? 'Complete' : snap.event.status === 'published' ? 'Published' : snap.event.status === 'draft' ? 'Draft' : snap.event.status;
  const unassigned = unassignedRoles(snap.staff);

  return (
    <section className="cmd-centre" aria-label="Command Centre">
      <header className={`cc-head tone-${overall.tone}`}>
        <p className="eyebrow">Command Centre</p>
        <h1 className="cc-title">{snap.event.name}</h1>
        <p className="cc-meta"><Chip tone={snap.event.closed ? 'win' : snap.event.status === 'published' ? 'steel' : 'brass'}>{statusWord}</Chip> <span>{clockText} at the event</span></p>
        <p className="cc-overall" role="status" aria-live="polite">{overall.tone === 'ok' ? '✓ ' : '⚠ '}{overall.headline}</p>
        <p className={`cc-fresh is-${fresh}`} data-testid="cc-fresh">
          {fresh === 'live' ? `Live · updated ${stamp}` : fresh === 'offline' ? `Offline · last updated ${stamp}. This may be out of date.` : `Not updating · last updated ${stamp}. This may be out of date.`}
          {fresh !== 'live' && <button type="button" className="linklike" onClick={() => void load()}>Try now</button>}
        </p>
      </header>

      <Section id="cc-attention" title="Needs attention" count={items.filter(i => i.urgency !== 'info').length} open>
        {items.length === 0 ? <p className="cc-empty">Nothing needs you right now. Fights, check-in and armour are in order.</p> : (
          <ul className="cc-items">{items.map(i => <Item key={i.id} item={i} />)}</ul>
        )}
      </Section>

      <Section id="cc-fighters" title="Fighters" count={r.notReady} countLabel="not ready" open>
        <div className="cc-tiles">
          <Tile n={r.fighters} label="expected" href={deskHref(event.slug, 'all')} />
          <Tile n={r.missing} label="not here yet" href={deskHref(event.slug, 'missing')} warn={r.missing > 0} />
          <Tile n={r.arrived} label="arrived, not in" href={deskHref(event.slug, 'arrived')} warn={r.arrived > 0} />
          <Tile n={r.checkedIn} label="checked in" href={deskHref(event.slug, 'all')} />
          <Tile n={r.ready} label="ready" href={deskHref(event.slug, 'ready')} />
          <Tile n={r.notReady} label="not ready" href={deskHref(event.slug, 'not_ready')} warn={r.notReady > 0} />
          <Tile n={r.needsInspection} label="to inspect" href={deskHref(event.slug, 'needs_inspection')} />
          <Tile n={r.needsCorrection + r.failed} label="armour issues" href={deskHref(event.slug, 'issues')} warn={r.needsCorrection + r.failed > 0} />
        </div>
        {snap.fightWarnings.length > 0 && (
          <div className="cc-sub">
            <h3>Fighting soon, not ready</h3>
            <ul className="cc-list">
              {soonestWarnings(snap.fightWarnings, boards).map(({ w, slot, field }) => (
                <li key={w.fighterId}><b>{w.name}</b> <span className="src">{slot}{field ? `, ${field}` : ''}</span><br /><span>{w.reasons.join(' · ') || 'Not ready'}</span></li>
              ))}
            </ul>
          </div>
        )}
        <p><Link className="btn btn-line cc-btn" to={deskHref(event.slug)}>Open the check-in desk</Link></p>
      </Section>

      <Section id="cc-fields" title="Fields" count={fields.length} countLabel={fields.length === 1 ? 'field' : 'fields'} open>
        {fields.length === 0 ? <p className="cc-empty">No fights are scheduled on a field yet.</p> : (
          <div className="cc-fields">
            {fields.map(f => (
              <article key={f.key} className={`cc-field state-${f.state}`} aria-label={f.name}>
                <div className="cc-field-head"><h3>{f.name}</h3><span className="cc-state">{FIELD_STATE_LABEL[f.state]}{f.round ? ` · round ${f.round}` : ''}</span></div>
                {f.current && <p><span className="src">On now</span><br /><b>{matchTitle(f.current)}</b></p>}
                {f.next && <p><span className="src">Next</span><br />{matchTitle(f.next)}{f.next.scheduledAt ? <span className="src"> · {timeLabel(f.next.scheduledAt, tz)}</span> : null}</p>}
                <p className="src">{f.queueDepth} waiting on this field{f.behindMinutes !== null ? ` · ${f.behindMinutes} min behind schedule` : ''}</p>
                {f.warnings.length > 0 && <p className="cc-warn">⚠ Not ready: {f.warnings.map(w => `${w.name} (${(w.reasons[0] ?? 'not ready').toLowerCase()})`).join(', ')}</p>}
                <Link className="btn btn-ink cc-btn" to={fieldHref(event.slug, f.name)}>Open Lyst Control · {f.name}</Link>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section id="cc-fights" title="Fights" count={fights.on.length} countLabel="on now">
        <FightList title="On now" rows={fights.on} warn={warnByMatch} tz={tz} empty="No fight is on." />
        <FightList title="Called next" rows={fights.called} warn={warnByMatch} tz={tz} empty="Nothing called yet." />
        <FightList title="Coming up" rows={fights.later} warn={warnByMatch} tz={tz} empty="Nothing else is ready to run." />
      </Section>

      <Section id="cc-progress" title="Progress" count={prog.final} countLabel={`of ${prog.total} fights`}>
        <p><b>{prog.final}</b> of <b>{prog.total}</b> fights scored · <b>{prog.remaining}</b> to go</p>
        <p className="src">Competitions: {prog.done} done · {prog.running} under way · {prog.notStarted} not started{prog.noDraw ? ` · ${prog.noDraw} without a draw` : ''}. No finish time is estimated: the data cannot support one honestly.</p>
        <ul className="cc-list">{progress.map(p => <li key={p.id}><b>{p.name}</b> <span className="src">{p.label}{p.detail ? ` · ${p.detail}` : ''}</span></li>)}</ul>
      </Section>

      <Section id="cc-staff" title="Staff" count={snap.staff.reduce((n, s) => n + s.names.length, 0)} countLabel="assigned">
        <p className="src">Who is assigned to this event. BuhurtOS does not know who is physically here.</p>
        <dl className="cc-staff">{snap.staff.map(s => <div key={s.role}><dt>{ROLE_NAMES[s.role] ?? s.role}</dt><dd>{s.names.join(', ')}</dd></div>)}</dl>
        {unassigned.length > 0 && <p className="src">Nobody assigned as: {unassigned.map(x => ROLE_NAMES[x] ?? x).join(', ')}.</p>}
        {organizer && <p><Link className="btn btn-line cc-btn" to={manageHref(event.slug, 'people')}>Manage people and roles</Link></p>}
      </Section>

      {organizer && (
        <Section id="cc-announce" title="Announcements">
          <AnnouncementPanel eventId={event.id} published={event.status === 'published'} />
        </Section>
      )}

      <Section id="cc-broadcast" title="Broadcast">
        <p>{snap.broadcast.configured ? 'A livestream address is set for this event.' : 'No livestream address is set.'}</p>
        {organizer ? <p><Link className="btn btn-line cc-btn" to={manageHref(event.slug, 'broadcast')}>Manage › Broadcast</Link></p> : <p className="src">Organizers manage the broadcast.</p>}
      </Section>

      <nav className="cc-quick" aria-label="Quick actions">
        <h2 className="cc-h">Quick actions</h2>
        <div>
          <Link className="btn btn-line" to={deskHref(event.slug)}>Check-in desk</Link>
          {fields.map(f => <Link key={f.key} className="btn btn-line" to={fieldHref(event.slug, f.name)}>Lyst Control · {f.name}</Link>)}
          {organizer && <Link className="btn btn-line" to={manageHref(event.slug, 'eventday')}>Event day (call fights, results)</Link>}
          {organizer && <a className="btn btn-line" href="#cc-announce">Send an announcement</a>}
          {organizer && <Link className="btn btn-line" to={manageHref(event.slug, 'review')}>Registrations</Link>}
          {organizer && <Link className="btn btn-line" to={manageHref(event.slug, 'people')}>People and roles</Link>}
          {organizer && <Link className="btn btn-line" to={manageHref(event.slug, 'broadcast')}>Broadcast</Link>}
          <Link className="btn btn-line" to={`/events/${event.slug}/arena`}>Live display</Link>
          <Link className="btn btn-line" to={`/events/${event.slug}`}>Public event page</Link>
        </div>
      </nav>
    </section>
  );
}

/** One line per fighter, at their most urgent fight (fighting now before on deck before in the hole before coming up). */
function soonestWarnings(warnings: readonly FightWarning[], boards: readonly import('../lib/eventDay').FieldBoard[]) {
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

function Section({ id, title, count, countLabel, open, children }: { id: string; title: string; count?: number; countLabel?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="cc-sec panel" id={id} open={open}>
      <summary><h2 className="cc-h">{title}</h2>{count !== undefined && <span className="cc-count">{count}{countLabel ? ` ${countLabel}` : ''}</span>}</summary>
      <div className="cc-body">{children}</div>
    </details>
  );
}

const URGENCY_WORD: Record<CommandItem['urgency'], string> = { now: 'Now', soon: 'Soon', later: 'Later', info: 'FYI' };
function Item({ item: i }: { item: CommandItem }) {
  return (
    <li className={`cc-item u-${i.urgency}`}>
      <span className="cc-urg">{URGENCY_WORD[i.urgency]}</span>
      <div className="cc-item-body">
        <b className="cc-what">{i.what}</b>
        {i.who && <span className="cc-who">{i.who}</span>}
        {i.where && <span className="src">{i.where}</span>}
      </div>
      <Link className="btn btn-ink cc-act" to={i.href}>{i.action}</Link>
    </li>
  );
}

function Tile({ n, label, href, warn }: { n: number; label: string; href: string; warn?: boolean }) {
  return <Link className={`cc-tile${warn ? ' warn' : ''}`} to={href}><b>{n}</b><span>{label}</span></Link>;
}

function FightList({ title, rows, warn, tz, empty }: { title: string; rows: { match: import('../data/matches').CompetitionMatch; field: string }[]; warn: Map<string, FightWarning[]>; tz: string; empty: string }) {
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
