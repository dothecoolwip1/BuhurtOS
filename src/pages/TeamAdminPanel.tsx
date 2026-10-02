import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { approveTeam, fetchAllTeams, type TeamRow } from '../data/teams';
import { assignTeamCaptain, fetchTeamCaptains, removeTeamCaptain } from '../data/teamManager';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const bad: React.CSSProperties = { color: 'var(--live)' };
const place = (t: TeamRow) => [t.city, t.region, t.country].filter(Boolean).join(', ');
const SHOWN = 12;

/**
 * Team manager for the platform owner, organizers and organization admins: approve new teams and name captains.
 * The database decides who may do either; a person without the authority just sees its error.
 */
export function TeamAdminPanel({ canApprove }: { canApprove: boolean }) {
  const [key, setKey] = useState(0);
  const teams = useAsync(fetchAllTeams, [key]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<TeamRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const all = teams.data ?? [];
  const pending = all.filter(t => t.status === 'pending');
  const needle = q.trim().toLowerCase();
  const found = needle.length < 2 ? [] : all.filter(t => `${t.name} ${place(t)}`.toLowerCase().includes(needle));

  const approve = async (t: TeamRow) => {
    setBusyId(t.id); setProblem(null);
    try { await approveTeam(t.id); setKey(k => k + 1); } catch (e) { setProblem(friendlyError(e)); } finally { setBusyId(null); }
  };

  return (
    <section className="panel info" style={{ display: 'grid', gap: 12 }} aria-labelledby="admin-h">
      <h2 id="admin-h">Admin: teams and captains</h2>
      {teams.loading && !teams.data && <p className="muted">Loading teams…</p>}
      {teams.error != null && <p role="alert" style={bad}>{friendlyError(teams.error, 'Could not load teams.')}</p>}
      {problem && <p role="alert" style={bad}>{problem}</p>}

      {canApprove && pending.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <h3>Waiting for approval ({pending.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {pending.map(t => (
              <li key={t.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ overflowWrap: 'anywhere' }}><b>{t.name}</b>{place(t) ? <span className="src"> · {place(t)}</span> : null}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-line" onClick={() => setOpen(t)}>Captains</button>
                  <button type="button" className="btn btn-ink" disabled={busyId === t.id} onClick={() => void approve(t)}>Approve</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        <h3>Name a captain</h3>
        <label className="field-in">Find a team by name or city
          <input type="search" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
        </label>
        {needle.length >= 2 && found.length === 0 && !teams.loading && <p className="muted" role="status">No team matches.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }} aria-label="Matching teams">
          {found.slice(0, SHOWN).map(t => (
            <li key={t.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ overflowWrap: 'anywhere' }}><b>{t.name}</b>{place(t) ? <span className="src"> · {place(t)}</span> : null}</span>
              <button type="button" className="btn btn-line" onClick={() => setOpen(t)}>Captains</button>
            </li>
          ))}
        </ul>
        {found.length > SHOWN && <p className="src">Showing {SHOWN} of {found.length}. Type more to narrow it down.</p>}
      </div>

      {open && <CaptainsDialog team={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function CaptainsDialog({ team, onClose }: { team: TeamRow; onClose: () => void }) {
  const [key, setKey] = useState(0);
  const captains = useAsync(() => fetchTeamCaptains(team.id), [team.id, key]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setProblem(null); setDone(null);
    try { await fn(); setDone(ok); setKey(k => k + 1); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog title={`Captains of ${team.name}`} onClose={onClose} busy={busy}>
      {captains.loading && !captains.data && <p className="muted">Loading…</p>}
      {captains.error != null && <p role="alert" style={bad}>{friendlyError(captains.error, 'Could not load the captains.')}</p>}
      {captains.data && captains.data.length === 0 && <p className="muted">This team has no captain yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {(captains.data ?? []).map(c => (
          <li key={c.userId} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ overflowWrap: 'anywhere' }}><b>{c.name ?? c.email}</b>{c.name ? <span className="src"> · {c.email}</span> : null}</span>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => void run(() => removeTeamCaptain(team.id, c.userId), 'Captain removed.')}>Remove</button>
          </li>
        ))}
      </ul>
      <form onSubmit={e => { e.preventDefault(); if (email.trim()) void run(async () => { await assignTeamCaptain(team.id, email); setEmail(''); }, 'Captain added.'); }} style={{ display: 'grid', gap: 8 }}>
        <label className="field-in">Sign-in email of the new captain
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" data-autofocus />
          <span>They must have signed in to BuhurtOS at least once.</span>
        </label>
        {problem && <p role="alert" style={bad}>{problem}</p>}
        {done && <p role="status" style={{ color: 'var(--win)' }}>{done}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn btn-line" disabled={busy} onClick={onClose}>Close</button>
          <button type="submit" className="btn btn-ink" disabled={busy || !email.trim()}>{busy ? 'Saving…' : 'Make captain'}</button>
        </div>
      </form>
    </Dialog>
  );
}
