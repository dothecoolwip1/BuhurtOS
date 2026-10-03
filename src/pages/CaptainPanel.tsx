import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip } from '../components/ui';
import type { InboxRequest, JoinDecision } from '../data/teamManager';
import { decideTeamJoin } from '../data/teamManager';
import { captainRows, type CaptainTeamRow } from '../lib/captainView';
import { friendlyError } from '../lib/friendlyError';
import type { Reloadable } from '../lib/useAsync';
import { lookupState } from '../lib/lookupState';
import type { CaptainedTeam } from '../data/myTeams';

const bad: React.CSSProperties = { color: 'var(--live)' };
const list: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 };
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The teams this person captains, with the actions that matter first. Whether someone is a captain comes from the database
 * (team_roles); the edit page and every change are checked there again, so these buttons are convenience, not authority.
 */
export function CaptainTeams({ teams, inbox }: { teams: CaptainedTeam[]; inbox: InboxRequest[] }) {
  const rows = captainRows(teams, inbox);
  return (
    <section className="panel info" style={{ display: 'grid', gap: 14 }} aria-labelledby="cap-h">
      <h2 id="cap-h">{rows.length === 1 ? 'Your team' : 'Your teams'}</h2>
      <ul style={list}>
        {rows.map(r => <CaptainTeamItem key={r.teamId} r={r} />)}
      </ul>
    </section>
  );
}

function CaptainTeamItem({ r }: { r: CaptainTeamRow }) {
  return (
    <li style={{ display: 'grid', gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ overflowWrap: 'anywhere' }}>{r.name}</b>
        <Chip>Captain</Chip>
        {r.awaitingApproval && <Chip tone="brass">Awaiting approval</Chip>}
        {!r.awaitingApproval && r.waiting > 0 && <Chip tone="steel">{r.waiting} pending</Chip>}
      </div>
      {r.awaitingApproval && <p className="src">An organizer has to approve this team before it is public. Until then it is private, and nobody can ask to join it. You can still edit its page.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn btn-ink" to={`/teams/${r.slug}/edit`}>Edit team</Link>
        <Link className="btn btn-line" to={`/teams/${r.slug}`}>Team page</Link>
        {!r.awaitingApproval && <Link className="btn btn-line" to={`/teams/${r.slug}#roster`}>Roster</Link>}
      </div>
    </li>
  );
}

/**
 * Join requests waiting for this captain. Has four visible states: loading, error with Retry, empty, populated.
 * `quiet` (used for the platform owner's console) shows nothing until there is something to answer.
 */
export function JoinRequestInbox({ inbox, onDone, quiet = false }: { inbox: Reloadable<InboxRequest[]>; onDone: () => void; quiet?: boolean }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const state = lookupState(inbox);
  const items = inbox.data ?? [];

  const decide = async (r: InboxRequest, d: JoinDecision) => {
    if (inFlight.current) return;   // a second tap before the first answer arrives does nothing
    inFlight.current = true;
    setBusyId(r.id); setResult(null); setProblems(p => ({ ...p, [r.id]: '' }));
    try {
      await decideTeamJoin(r.id, d);
      setResult(d === 'approved' ? `${r.requesterName} is now on ${r.teamName}. They have been told.` : `Declined ${r.requesterName}'s request for ${r.teamName}. They have been told.`);
      onDone();
      // The row that held focus is gone; put focus on the confirmation so keyboard and screen reader users keep their place.
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (e) { setProblems(p => ({ ...p, [r.id]: friendlyError(e) })); } finally { inFlight.current = false; setBusyId(null); }
  };

  if (quiet && state !== 'found' && !result) return state === 'error' ? <p role="alert" style={bad}>{friendlyError(inbox.error, 'Could not load join requests.')}</p> : null;

  return (
    <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="inbox-h" aria-busy={state === 'loading'}>
      <h2 id="inbox-h">Join requests{state === 'found' || state === 'none' ? ` (${items.length})` : ''}</h2>
      {state === 'loading' && <p className="muted" role="status">Loading join requests…</p>}
      {state === 'error' && (
        <p role="alert" style={bad}>
          {friendlyError(inbox.error, 'Could not load join requests.')}{' '}
          <button type="button" className="btn btn-line" onClick={inbox.reload}>Retry</button>
        </p>
      )}
      {state === 'none' && <p className="muted">No pending join requests. When a fighter asks to join your team, it appears here and in your notifications.</p>}
      <p ref={resultRef} tabIndex={-1} role="status" style={{ color: 'var(--win)', margin: 0 }}>{result}</p>
      {state === 'found' && (
        <ul style={list} aria-label="Pending join requests">
          {items.map(r => (
            <li key={r.id} style={{ display: 'grid', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
              <span style={{ overflowWrap: 'anywhere' }}><b>{r.requesterName}</b> wants to join <b>{r.teamName}</b> <span className="src">· {when(r.createdAt)}</span></span>
              {r.message && <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: '3px solid var(--line)', overflowWrap: 'anywhere' }}>{r.message}</blockquote>}
              {problems[r.id] && <p role="alert" style={bad}>{problems[r.id]}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ink" disabled={busyId !== null} aria-label={`Accept ${r.requesterName}`} onClick={() => void decide(r, 'approved')}>{busyId === r.id ? 'Saving…' : 'Accept'}</button>
                <button type="button" className="btn btn-line" disabled={busyId !== null} aria-label={`Decline ${r.requesterName}`} onClick={() => void decide(r, 'declined')}>Decline</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {state === 'found' && <p className="src">Accepting adds the person to the team's roster. Declining lets them know. Either way they get a notification.</p>}
    </section>
  );
}
