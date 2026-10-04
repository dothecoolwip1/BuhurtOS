import { useState } from 'react';
import { fetchRepresentedTeams, setRepresentedTeam, type RepresentedTeamRow } from '../data/matches';
import { fetchApprovedTeams, type TeamChoice } from '../data/myTeams';
import { friendlyError } from '../lib/friendlyError';
import { basisLabel, correctionProblem, REASON_MAX, savedText } from '../lib/representedTeams';
import { useAsync } from '../lib/useAsync';

const errorStyle = { color: 'var(--live)' } as const;

/**
 * Manage > Run, individual competitions: the team each fighter represented here. Their points count toward that team's discipline totals.
 * An organizer of the event (or the platform owner) can correct one entry with a reason; the database checks who may and records the change.
 * It changes this competition only: the fighter's current team and memberships are never touched, and nothing is filled in automatically.
 */
export function RepresentedTeams({ competitionId, competitionName, reloadKey }: { competitionId: string; competitionName: string; reloadKey: number }) {
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const rows = useAsync(() => (open ? fetchRepresentedTeams(competitionId) : Promise.resolve([] as RepresentedTeamRow[])), [open, competitionId, reloadKey, version]);
  const teams = useAsync(() => (open ? fetchApprovedTeams() : Promise.resolve([] as TeamChoice[])), [open]);
  const [editing, setEditing] = useState<string | null>(null);
  const [team, setTeam] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const start = (r: RepresentedTeamRow) => { setEditing(r.entryId); setTeam(r.teamId ?? ''); setReason(''); setError(null); setDone(null); };
  const save = async (r: RepresentedTeamRow) => {
    const problem = correctionProblem(r.teamId, team, reason);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      await setRepresentedTeam(r.entryId, team || null, reason);
      setDone(savedText(r.fighterName, team ? (teams.data ?? []).find(t => t.id === team)?.name ?? 'the chosen team' : null, competitionName));
      setEditing(null); setVersion(v => v + 1);
    } catch (e) { setError(friendlyError(e, 'Could not save the team.')); } finally { setBusy(false); }
  };

  const list = rows.data ?? [];
  const unrecorded = list.filter(r => !r.teamId).length;
  return (
    <details onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><b>Teams represented</b>{open && rows.data ? ` (${list.length}${unrecorded ? `, ${unrecorded} without a team` : ''})` : ''} · for team discipline totals</summary>
      <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
        <p className="src">The team each fighter fought for in this competition. Their ranking points here count toward that team's discipline totals.
          Changing it corrects this competition only: it does not change the fighter's current team, and every change is kept with your reason.</p>
        {done && <p role="status" className="panel" style={{ padding: '10px 12px' }}>{done}</p>}
        {rows.loading && <p className="muted">Loading…</p>}
        {rows.error != null && <p role="alert" style={errorStyle}>{friendlyError(rows.error, 'Could not load the entrants.')}</p>}
        {rows.data && list.length === 0 && <p className="muted">No individual entrants yet.</p>}
        <ul className="reprteams">
          {list.map(r => (
            <li key={r.entryId} className="panel">
              <div className="reprteam-line">
                <span style={{ minWidth: 0 }}>
                  <b>{r.fighterName}</b>{r.status === 'withdrawn' || r.status === 'disqualified' ? <span className="muted"> · {r.status}</span> : null}
                  <span className="l">{r.teamName ?? 'No team'} · {basisLabel(r.basis, !!r.teamId)}</span>
                </span>
                {editing !== r.entryId && (
                  <button type="button" className="btn btn-line" aria-label={`Change the team ${r.fighterName} represented`} onClick={() => start(r)} disabled={busy}>Change</button>
                )}
              </div>
              {editing === r.entryId && (
                <form className="reprteam-form" onSubmit={e => { e.preventDefault(); void save(r); }}>
                  <label className="field-in">Team {r.fighterName} fought for in this competition
                    <select value={team} onChange={e => setTeam(e.target.value)} disabled={busy || teams.loading}>
                      <option value="">No team (fought independently)</option>
                      {r.teamId && !(teams.data ?? []).some(t => t.id === r.teamId) && <option value={r.teamId}>{r.teamName ?? 'Current team'}</option>}
                      {(teams.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}{t.city ? ` · ${t.city}` : ''}</option>)}
                    </select>
                  </label>
                  <label className="field-in">Why is it changing? (kept in the history)
                    <input type="text" value={reason} maxLength={REASON_MAX} placeholder="e.g. checked the entry list: fought for Ankle Biters" onChange={e => setReason(e.target.value)} disabled={busy} />
                  </label>
                  {teams.error != null && <p role="alert" style={errorStyle}>{friendlyError(teams.error, 'Could not load the teams.')}</p>}
                  {error && <p role="alert" style={errorStyle}>{error}</p>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="submit" className="btn btn-ink" disabled={busy || correctionProblem(r.teamId, team, reason) !== null}>{busy ? 'Saving…' : 'Save team'}</button>
                    <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setEditing(null); setError(null); }}>Cancel</button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
