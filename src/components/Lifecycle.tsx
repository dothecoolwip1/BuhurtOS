import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Dialog } from './Dialog';
import { Chip } from './ui';
import type { LiveEvent } from '../data/api';
import {
  archiveEvent, canManageFighter, DELETE_BLOCKER_TEXT, deleteEvent, eventDeleteCheck, excludeEventFromStats, fetchFighterLifecycle, fetchManagedRoster, restoreEventStats,
  setFighterActive, setRosterVisibility, unarchiveEvent
} from '../data/lifecycle';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

type Ask = 'archive' | 'exclude' | 'restore' | 'delete' | null;

/**
 * Event settings › Archive and statistics (Pack 09D). Kept away from the event-day controls. Each action says what it does before it is confirmed; the
 * database decides who may (archive: the event's organizers; statistics: the platform administrator or the organization's administrator; delete: only a
 * disposable draft) and audits it.
 */
export function EventLifecycle({ event, onChanged }: { event: LiveEvent; onChanged: () => void }) {
  const nav = useNavigate();
  const [ask, setAsk] = useState<Ask>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const check = useAsync(() => eventDeleteCheck(event.id).catch(() => null), [event.id, event.status, event.closedAt]);
  const deletable = check.data ? check.data.blockers.length === 0 : false;

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); setAsk(null); setText(''); if (after) after(); else onChanged(); }
    catch (e) { setMsg({ ok: false, text: friendlyError(e) }); }
    finally { setBusy(false); }
  };

  return (
    <section id="lifecycle" className="panel info lc" aria-labelledby="lc-h" style={{ display: 'grid', gap: 12, scrollMarginTop: 96 }}>
      <h3 id="lc-h">Archive and statistics</h3>
      <ul className="lc-state" aria-label="Event status">
        <li>{event.closedAt ? <><Chip tone="win">Closed</Chip> Finished: the results are official history.</> : <><Chip>Open</Chip> Not closed yet.</>}</li>
        {event.testDeleteAfter ? <>
          <li><Chip tone="brass">Test event</Chip> Only this event's staff can see it; it is never shown with current or upcoming events.</li>
          <li><Chip tone="live">Never counts</Chip> Its results are test data: kept out of rankings, records and statistics.</li>
        </> : <>
        <li>{event.archivedAt ? <><Chip tone="brass">Archived</Chip> Hidden from current events. Results still count.</> : <><Chip>Current</Chip> Shown with current and upcoming events.</>}</li>
        <li>{event.statsExcludedAt ? <><Chip tone="live">Not counted</Chip> Left out of official statistics: {event.statsExcludedReason}</> : <><Chip tone="steel">Counts</Chip> Its official results count in rankings and statistics.</>}</li>
        </>}
      </ul>

      <div className="lc-actions">
        <div>
          <b>{event.archivedAt ? 'Restore from the archive' : 'Archive event'}</b>
          <p className="src">{event.archivedAt ? 'Shows it again with current and upcoming events.' : 'Hides this event from normal event browsing. Its page and official results stay, and its statistics keep counting.'}</p>
          {event.archivedAt
            ? <button type="button" className="btn btn-line" disabled={busy} onClick={() => void run(() => unarchiveEvent(event.id), 'Restored from the archive.')}>Restore from archive</button>
            : <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setAsk('archive'); setMsg(null); }}>Archive event…</button>}
        </div>
        <div>
          <b>{event.statsExcludedAt ? 'Count in official statistics again' : 'Exclude from official statistics'}</b>
          <p className="src">{event.statsExcludedAt ? 'Its official results go back into rankings, medals and career statistics, exactly once.' : 'Keeps the tournament and its results, but removes them from rankings, medals and career statistics. For a test event, a wrong import, or an event that turned out not to be eligible.'} Only the platform administrator or an administrator of the event’s organization can do this.</p>
          <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setAsk(event.statsExcludedAt ? 'restore' : 'exclude'); setMsg(null); }}>{event.statsExcludedAt ? 'Count it again…' : 'Exclude from statistics…'}</button>
        </div>
        <div className="lc-danger">
          <b>Delete event</b>
          {deletable
            ? <p className="src">This event has no sporting history, so it can be deleted for good, with its {check.data!.competitions} competition{check.data!.competitions === 1 ? '' : 's'}{check.data!.registrations > 0 ? ` and ${check.data!.registrations} registration${check.data!.registrations === 1 ? '' : 's'}` : ''}. This cannot be undone.</p>
            : <p className="src">{check.data ? `It cannot be deleted because ${check.data.blockers.map(b => DELETE_BLOCKER_TEXT[b] ?? b).join(', ')}. Archive it or exclude it from statistics instead.` : 'Only a disposable draft with no sporting history can be deleted.'}</p>}
          {deletable && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { setAsk('delete'); setMsg(null); }}>Delete event…</button>}
        </div>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={msg.ok ? undefined : { color: 'var(--live)' }}>{msg.text}</p>}

      {ask === 'archive' && (
        <Dialog title="Archive this event?" onClose={() => setAsk(null)} busy={busy}>
          <p>It disappears from current and upcoming events. Its page, its official results and its statistics stay exactly as they are. You can restore it at any time.</p>
          <label className="field-in">Note (optional)<input value={text} maxLength={200} onChange={e => setText(e.target.value)} /></label>
          <div className="dlg-actions"><button type="button" className="btn btn-ink" disabled={busy} onClick={() => void run(() => archiveEvent(event.id, text.trim() || null), 'Archived. It is hidden from current events and still counts.')}>Archive event</button><button type="button" className="btn btn-line" onClick={() => setAsk(null)}>Cancel</button></div>
        </Dialog>
      )}
      {(ask === 'exclude' || ask === 'restore') && (
        <Dialog title={ask === 'exclude' ? 'Exclude from official statistics?' : 'Count in official statistics again?'} onClose={() => setAsk(null)} busy={busy}>
          <p>{ask === 'exclude' ? 'The event, its fights and its results stay stored and visible. They stop counting in fighter and team rankings, medal counts, team discipline totals and career statistics. This is recorded with your reason and can be reversed.' : 'Its official results count again in rankings, medals and statistics. Nothing is duplicated. This is recorded with your reason.'}</p>
          <label className="field-in">Reason (required)<input value={text} maxLength={500} onChange={e => setText(e.target.value)} data-autofocus /></label>
          <div className="dlg-actions">
            <button type="button" className={ask === 'exclude' ? 'btn btn-danger' : 'btn btn-ink'} disabled={busy || text.trim().length < 3}
              onClick={() => void run(() => (ask === 'exclude' ? excludeEventFromStats(event.id, text) : restoreEventStats(event.id, text)), ask === 'exclude' ? 'Excluded from official statistics.' : 'Counted in official statistics again.')}>
              {ask === 'exclude' ? 'Exclude from statistics' : 'Count it again'}
            </button>
            <button type="button" className="btn btn-line" onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {ask === 'delete' && (
        <Dialog title="Delete this event for good?" onClose={() => setAsk(null)} busy={busy}>
          <p>The event, its competitions and its registrations are removed. This cannot be undone. Type <b>{event.slug}</b> to confirm.</p>
          <label className="field-in">Web address name<input value={text} onChange={e => setText(e.target.value)} autoCapitalize="none" spellCheck={false} data-autofocus /></label>
          <div className="dlg-actions">
            <button type="button" className="btn btn-danger" disabled={busy || text.trim() !== event.slug} onClick={() => void run(() => deleteEvent(event.id, text), 'Deleted.', () => nav('/events'))}>Delete event</button>
            <button type="button" className="btn btn-line" onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/**
 * Fighter page: Active / Inactive (Pack 09D). Shown only to the people the database lets change it (the fighter, their captain or team administrator, the
 * platform owner). An inactive fighter keeps every result, medal and team history; they just stop appearing as a current competitor.
 */
export function FighterLifecycle({ fighterId, name }: { fighterId: string; name: string }) {
  const [key, setKey] = useState(0);
  const state = useAsync(() => fetchFighterLifecycle(fighterId), [fighterId, key]);
  const { session } = useAuth();
  // signed out nobody can change it: do not ask the database (it would answer 401 on every public fighter page)
  const can = useAsync(() => (session ? canManageFighter(fighterId) : Promise.resolve(false)), [fighterId, !!session]);
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inactive = !!state.data?.inactiveAt;
  const change = async (active: boolean) => {
    setBusy(true); setProblem(null);
    try { await setFighterActive(fighterId, active, active ? null : reason.trim() || null); setAsk(false); setReason(''); setKey(k => k + 1); }
    catch (e) { setProblem(friendlyError(e)); }
    finally { setBusy(false); }
  };
  if (!state.data) return null;
  return (
    <div className="lc-fighter">
      {inactive && <p role="status" style={{ margin: 0 }}><Chip>Inactive</Chip> {name} is not competing at the moment. Past results and team history stay.</p>}
      {can.data && (inactive
        ? <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void change(true)}>Make active again</button>
        : <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => setAsk(true)}>Set as inactive…</button>)}
      {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
      {ask && (
        <Dialog title={`Set ${name} as inactive?`} onClose={() => setAsk(false)} busy={busy}>
          <p>{name} stops showing in entrant search and on current team rosters. Every past result, medal, ranking point and team history stays. You can make them active again at any time; it is the same fighter.</p>
          <label className="field-in">Note (optional)<input value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></label>
          <div className="dlg-actions"><button type="button" className="btn btn-ink" disabled={busy} onClick={() => void change(false)}>Set as inactive</button><button type="button" className="btn btn-line" onClick={() => setAsk(false)}>Cancel</button></div>
          {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
        </Dialog>
      )}
    </div>
  );
}

/** Team page › Current roster, for the team's managers (Pack 09D): show or hide a member on the public roster. History never changes. */
export function RosterVisibility({ teamId, onChanged }: { teamId: string; onChanged: () => void }) {
  const [key, setKey] = useState(0);
  const roster = useAsync(() => fetchManagedRoster(teamId).catch(() => null), [teamId, key]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!roster.data || roster.data.length === 0) return null;
  const flip = async (fighterId: string, visible: boolean) => {
    setBusy(fighterId); setProblem(null);
    try { await setRosterVisibility(teamId, fighterId, visible); setKey(k => k + 1); onChanged(); }
    catch (e) { setProblem(friendlyError(e)); }
    finally { setBusy(null); }
  };
  return (
    <details className="panel info lc-roster">
      <summary>Manage the public roster</summary>
      <p className="src">Choose who shows on this team’s current public roster. Hiding someone never changes the team they represented at past events, their results or rankings.</p>
      <ul>
        {roster.data.map(m => (
          <li key={m.fighterId}>
            <span><b>{m.displayName}</b>{m.inactive && <span className="src"> · inactive</span>}{m.hidden && <span className="src"> · hidden</span>}</span>
            <button type="button" className="btn btn-line btn-sm" disabled={busy === m.fighterId} aria-label={`${m.hidden ? 'Show' : 'Hide'} ${m.displayName} ${m.hidden ? 'on' : 'from'} the public roster`} onClick={() => void flip(m.fighterId, m.hidden)}>
              {m.hidden ? 'Show on public roster' : 'Hide from public roster'}
            </button>
          </li>
        ))}
      </ul>
      {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
    </details>
  );
}
