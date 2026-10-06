import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { PageHead, Seg } from '../components/ui';
import { fetchEvent } from '../data/api';
import {
  clearReadinessOverride, fetchEventReadiness, fetchInspectionHistory, fetchMyDeskRoles, recordInspection, recordWeighIn, setAttendance, setReadinessOverride,
  type DeskRoles, type InspectionRecord
} from '../data/readiness';
import { friendlyError } from '../lib/friendlyError';
import { timeAgo } from '../lib/notificationView';
import {
  ATTENDANCE_LABEL, FILTER_LABEL, disciplineBlock, INSPECTION_LABEL, ISSUES, deskCounts, filterDesk, filterOptions, issueLabel, sortDesk,
  type InspectionIssue, type ReadinessFilter, type ReadinessRow
} from '../lib/readiness';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const REFRESH_MS = 20_000;

/**
 * The event-day desk (Pack 16): check-in, armour inspection, weigh-in and readiness, for the check-in desk, armour inspectors, the head marshal
 * and organizers. Phone first. Nothing is shown as saved until the server confirms it; every action is checked again by the database.
 * A scanned check-in QR opens this page with ?r=<registration>, which only pins that person to the top: it grants nothing.
 */
export function CheckinDeskPage() {
  const { eventId: slug = '' } = useParams();
  const [params] = useSearchParams();
  const pinned = params.get('r');
  const { session } = useAuth();
  const ev = useAsync(() => fetchEvent(slug), [slug]);
  const event = ev.data?.event;
  const roles = useAsync(() => (event && session ? fetchMyDeskRoles(event.id) : Promise.resolve(null)), [event?.id, session?.user.id]);
  useDocumentTitle(event ? `Check-in · ${event.name}` : 'Check-in');

  if (!session) return <><PageHead eyebrow="Event day" title="Check-in desk" /><SignIn reason="Sign in with the account you use as event staff." /></>;
  if (ev.loading || (event && roles.loading)) return <p className="muted">Loading…</p>;
  if (ev.error != null || !event) return <p role="alert">{friendlyError(ev.error, 'Could not load this event.')}</p>;
  if (!roles.data?.detail) {
    return (
      <section className="panel info" role="status" style={{ display: 'grid', gap: 10 }}>
        <PageHead eyebrow="Event day" title="Check-in desk" />
        <p><b>This screen is for {event.name}'s check-in desk and armour inspectors.</b> A check-in code does not open it by itself: an organizer adds staff under Manage › People.</p>
        <p><Link className="btn btn-line" to={`/events/${event.slug}`}>Back to the event</Link></p>
      </section>
    );
  }
  return <ReadinessDesk eventId={event.id} slug={event.slug} name={event.name} roles={roles.data} pinned={pinned} />;
}

export function ReadinessDesk({ eventId, slug, name, roles, pinned }: { eventId: string; slug: string; name: string; roles: DeskRoles; pinned: string | null }) {
  const [rows, setRows] = useState<ReadinessRow[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  // ?f=<filter> opens the desk on one list (the Command Centre links here); anything unknown falls back to the default
  const [params] = useSearchParams();
  const asked = params.get('f');
  const [filter, setFilter] = useState<ReadinessFilter>(asked && asked in FILTER_LABEL ? asked as ReadinessFilter : pinned ? 'all' : 'not_ready');
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('');
  const [comp, setComp] = useState('');
  // A card the desk just acted on stays in view until the filter or search changes, even if it no longer matches (e.g. passed under "Not ready").
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setTouched(new Set()); }, [filter, query, team, comp]);

  const load = useCallback(async () => {
    try { setRows(await fetchEventReadiness(eventId)); setLoadError(null); } catch (e) { setLoadError(e); }
  }, [eventId]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    const again = () => void load();   // back from a dead zone, or back to this tab: read the truth again
    window.addEventListener('online', again); window.addEventListener('focus', again);
    return () => { window.clearInterval(t); window.removeEventListener('online', again); window.removeEventListener('focus', again); };
  }, [load]);

  const counts = deskCounts(rows ?? []);
  const options = useMemo(() => filterOptions(rows ?? []), [rows]);
  const shown = useMemo(() => {
    const hit = new Set(filterDesk(rows ?? [], { filter, query, team: team || null, competition: comp || null }).map(r => r.registrationId));
    return sortDesk((rows ?? []).filter(r => hit.has(r.registrationId) || touched.has(r.registrationId)), pinned);
  }, [rows, filter, query, team, comp, pinned, touched]);
  const pinnedRow = pinned ? rows?.find(r => r.registrationId === pinned) ?? null : null;

  return (
    <section style={{ display: 'grid', gap: 12 }} className="desk">
      <PageHead eyebrow="Event day" title="Check-in desk" lede={name} />
      <div className="desk-counts" aria-live="polite">
        <button type="button" onClick={() => setFilter('all')}><b>{counts.expected}</b><span>expected</span></button>
        <button type="button" onClick={() => setFilter('missing')}><b>{counts.missing}</b><span>not here yet</span></button>
        <button type="button" onClick={() => setFilter('all')}><b>{counts.checkedIn}</b><span>checked in</span></button>
        <button type="button" onClick={() => setFilter('needs_inspection')}><b>{counts.needsInspection}</b><span>to inspect</span></button>
        <button type="button" onClick={() => setFilter('issues')}><b>{counts.issues}</b><span>armour issues</span></button>
        <button type="button" onClick={() => setFilter('ready')}><b>{counts.ready}</b><span>ready</span></button>
      </div>
      {pinned && !pinnedRow && rows && <p role="alert" className="panel info">That check-in code is not a registration for this event.</p>}
      <label className="field-in">Find a fighter (name, team or competition)
        <input type="search" inputMode="search" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} style={{ minHeight: 52, fontSize: 18 }} />
      </label>
      <Seg scroll label="Show" value={filter} onChange={setFilter} options={(Object.keys(FILTER_LABEL) as ReadinessFilter[]).map(k => [k, FILTER_LABEL[k]] as const)} />
      {(options.teams.length > 0 || options.competitions.length > 0) && (
        <div className="desk-menus">
          {options.teams.length > 0 && <label className="field-in">Team<select value={team} onChange={e => setTeam(e.target.value)}><option value="">All teams</option>{options.teams.map(t => <option key={t}>{t}</option>)}</select></label>}
          {options.competitions.length > 0 && <label className="field-in">Competition<select value={comp} onChange={e => setComp(e.target.value)}><option value="">All competitions</option>{options.competitions.map(c => <option key={c}>{c}</option>)}</select></label>}
        </div>
      )}
      {loadError != null && <p role="alert">{rows ? 'Could not refresh just now. Showing the last list; trying again.' : friendlyError(loadError, 'Could not load the check-in list.')}</p>}
      {!rows && loadError == null && <p className="muted">Loading the list…</p>}
      {rows && shown.length === 0 && <p className="panel info">{rows.length === 0 ? 'Nobody is registered yet.' : 'Nobody matches.'}</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {shown.map(r => <DeskCard key={r.registrationId} row={r} roles={roles} pinned={r.registrationId === pinned} onSaved={async () => { setTouched(t => new Set(t).add(r.registrationId)); await load(); }} />)}
      </div>
      <p className="src">Readiness is a warning for the lists and the Lyst screen. It never stops or reorders a fight. <Link to={`/events/${slug}`}>Back to the event</Link></p>
    </section>
  );
}

function DeskCard({ row: r, roles, pinned, onSaved }: { row: ReadinessRow; roles: DeskRoles; pinned: boolean; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<'conditional' | 'failed' | null>(null);
  const [issues, setIssues] = useState<InspectionIssue[]>([]);
  const [note, setNote] = useState('');
  const [kg, setKg] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<InspectionRecord[] | null>(null);
  const accepted = r.status === 'accepted';
  const blocked = disciplineBlock(r.reasons);

  // Nothing is shown as done until the server says so; a failure says so plainly and the button can be pressed again.
  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(label); setProblem(null);
    try { await fn(); await onSaved(); setMode(null); setIssues([]); setNote(''); setKg(''); setReason(''); setHistory(null); }
    catch (e) { setProblem(`Not saved: ${friendlyError(e)}`); }
    finally { setBusy(null); }
  };

  return (
    <article className={`panel info desk-card${pinned ? ' is-pinned' : ''}`} aria-label={r.fullName} data-ready={r.ready ? 'yes' : 'no'}>
      <div className="desk-head">
        <h3>{r.fullName}</h3>
        <span className={`desk-badge ${r.ready ? 'ok' : 'no'}`} role="status">{r.ready ? '✓ READY' : '✕ NOT READY'}</span>
      </div>
      <p className="src" style={{ margin: 0 }}>{[r.teamName ?? (r.isVolunteer ? 'Volunteer' : 'No team'), ...r.competitions].join(' · ')}{r.status === 'pending' ? ' · registration not accepted yet' : ''}</p>
      {blocked && <p className="desk-block" role="alert"><b>Blocked:</b> {blocked}. No check-in and no entry until it is lifted; a readiness override does not clear it. Ask the head marshal.</p>}
      {r.reasons.length > 0 && <ul className="desk-reasons">{r.reasons.filter(x => x !== blocked).map(x => <li key={x}>{x}</li>)}</ul>}
      {r.overrideActive && <p className="desk-override"><b>Override:</b> {r.overrideReason ?? 'set by the head marshal or an organizer'}</p>}

      {roles.checkIn && accepted && (
        <div className="desk-row">
          <span className="desk-state">{ATTENDANCE_LABEL[r.attendance]}</span>
          {r.attendance === 'expected' && <button type="button" className="btn btn-line" disabled={!!busy} onClick={() => run('arrived', () => setAttendance(r.registrationId, 'arrived'))}>{busy === 'arrived' ? 'Saving…' : 'Arrived'}</button>}
          {r.attendance !== 'checked_in' && !blocked && <button type="button" className="btn btn-ink" disabled={!!busy} onClick={() => run('in', () => setAttendance(r.registrationId, 'checked_in'))}>{busy === 'in' ? 'Saving…' : 'Check in'}</button>}
          {r.attendance !== 'expected' && <button type="button" className="btn btn-line" disabled={!!busy} onClick={() => run('undo', () => setAttendance(r.registrationId, r.attendance === 'checked_in' ? 'arrived' : 'expected'))}>{busy === 'undo' ? 'Saving…' : 'Undo'}</button>}
        </div>
      )}
      {!roles.checkIn && <p className="desk-state" style={{ margin: 0 }}>{ATTENDANCE_LABEL[r.attendance]}</p>}

      {!r.isVolunteer && accepted && (
        <div style={{ display: 'grid', gap: 8 }}>
          <p className="desk-state" style={{ margin: 0 }}>{INSPECTION_LABEL[r.inspection]}{r.issues.length > 0 ? `: ${r.issues.map(issueLabel).join(', ')}` : ''}{r.reinspected ? ' (after reinspection)' : ''}
            {r.inspectedAt && <span className="src"> · {timeAgo(r.inspectedAt)}{r.inspectedBy ? ` by ${r.inspectedBy}` : ''}</span>}</p>
          {r.note && <p className="desk-note"><b>Inspector's note:</b> {r.note}</p>}
          {roles.inspect && (
            <div className="desk-row">
              <button type="button" className="btn btn-ink" disabled={!!busy} onClick={() => run('pass', () => recordInspection(r.registrationId, 'passed'))}>{busy === 'pass' ? 'Saving…' : r.inspection === 'passed' ? 'Pass again' : 'Pass armour'}</button>
              <button type="button" className={`btn ${mode === 'conditional' ? 'btn-ink' : 'btn-line'}`} disabled={!!busy} aria-pressed={mode === 'conditional'} onClick={() => setMode(mode === 'conditional' ? null : 'conditional')}>Needs correction</button>
              <button type="button" className={`btn ${mode === 'failed' ? 'btn-ink' : 'btn-line'}`} disabled={!!busy} aria-pressed={mode === 'failed'} onClick={() => setMode(mode === 'failed' ? null : 'failed')}>Fail</button>
            </div>
          )}
          {roles.inspect && mode && (
            <div className="desk-issue" role="group" aria-label="What needs fixing">
              <div className="desk-chips">
                {ISSUES.map(([k, label]) => (
                  <button key={k} type="button" className={`chip-btn${issues.includes(k) ? ' on' : ''}`} aria-pressed={issues.includes(k)} onClick={() => setIssues(s => (s.includes(k) ? s.filter(x => x !== k) : [...s, k]))}>{label}</button>
                ))}
              </div>
              <label className="field-in">Note (optional, staff only)<input value={note} maxLength={200} onChange={e => setNote(e.target.value)} /></label>
              <button type="button" className="btn btn-ink" disabled={!!busy || issues.length === 0} onClick={() => run('save', () => recordInspection(r.registrationId, mode, issues, note.trim() || null))}>
                {busy === 'save' ? 'Saving…' : mode === 'failed' ? 'Save: failed' : 'Save: needs correction'}
              </button>
              {issues.length === 0 && <span className="src">Pick what needs fixing.</span>}
            </div>
          )}
        </div>
      )}

      {r.profight && accepted && (roles.checkIn || roles.inspect) && (
        <div className="desk-row">
          <span className="desk-state">Weigh-in: {r.weightKg !== null ? `${r.weightKg} kg` : 'not recorded'}{r.declaredWeight ? ` (declared ${r.declaredWeight})` : ''}</span>
          <input aria-label={`Weight of ${r.fullName} in kg`} inputMode="decimal" placeholder="kg" value={kg} onChange={e => setKg(e.target.value.replace(/[^0-9.]/g, ''))} style={{ width: 90, minHeight: 44, fontSize: 17 }} />
          <button type="button" className="btn btn-line" disabled={!!busy || !kg} onClick={() => run('kg', () => recordWeighIn(r.registrationId, Number(kg)))}>{busy === 'kg' ? 'Saving…' : 'Save weight'}</button>
        </div>
      )}

      {roles.override && accepted && !blocked && (r.overrideActive || !r.ready) && (
        <details className="desk-more">
          <summary>{r.overrideActive ? 'Override in place' : 'Override (exception only)'}</summary>
          {r.overrideActive
            ? <button type="button" className="btn btn-line" disabled={!!busy} onClick={() => run('clear', () => clearReadinessOverride(r.registrationId))}>{busy === 'clear' ? 'Saving…' : 'Withdraw override'}</button>
            : <div style={{ display: 'grid', gap: 8 }}>
                <label className="field-in">Reason (recorded with your name)<input value={reason} maxLength={140} onChange={e => setReason(e.target.value)} /></label>
                <button type="button" className="btn btn-line" disabled={!!busy || reason.trim().length < 5} onClick={() => run('override', () => setReadinessOverride(r.registrationId, reason.trim()))}>{busy === 'override' ? 'Saving…' : 'Mark ready anyway'}</button>
              </div>}
        </details>
      )}
      {!r.isVolunteer && accepted && r.inspectedAt && (
        <details className="desk-more" onToggle={e => { if ((e.target as HTMLDetailsElement).open && !history) void fetchInspectionHistory(r.registrationId).then(setHistory).catch(() => setHistory([])); }}>
          <summary>Inspection history</summary>
          {!history ? <p className="muted">Loading…</p> : (
            <ol className="desk-history">{history.map((h, i) => <li key={i}><b>{h.result === 'reset' ? 'Reset' : INSPECTION_LABEL[h.result as keyof typeof INSPECTION_LABEL] ?? h.result}</b>{h.issues.length ? `: ${h.issues.map(issueLabel).join(', ')}` : ''}{h.note ? `: ${h.note}` : ''} <span className="src">· {timeAgo(h.at)}{h.by ? ` · ${h.by}` : ''}</span></li>)}</ol>
          )}
        </details>
      )}
      {busy && <p className="src" role="status" style={{ margin: 0 }}>Saving… (not saved until this goes away)</p>}
      {problem && <p role="alert" style={{ color: 'var(--live)', margin: 0, fontWeight: 600 }}>{problem}</p>}
    </article>
  );
}
