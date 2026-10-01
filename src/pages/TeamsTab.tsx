import { useState } from 'react';
import { Chip } from '../components/ui';
import { approveTeam, fetchAllTeams, mergeTeams, type TeamRow } from '../data/teams';
import { friendlyError } from '../lib/friendlyError';
import { likelyDuplicates, mergeProblem } from '../lib/teamMerge';
import { useAsync } from '../lib/useAsync';

const place = (t: TeamRow) => [t.city, t.region, t.country].filter(Boolean).join(', ');

/** Organizer area: approve new teams, see the approved list, and merge duplicates. Teams belong to the platform, not one event. */
export function TeamsTab() {
  const [key, setKey] = useState(0);
  const teams = useAsync(fetchAllTeams, [key]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [keepId, setKeepId] = useState('');
  const [removeId, setRemoveId] = useState('');

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); setKey(k => k + 1); } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); }
  };

  const all = teams.data ?? [];
  const pending = all.filter(t => t.status === 'pending');
  const approved = all.filter(t => t.status === 'approved');
  const keep = all.find(t => t.id === keepId);
  const remove = all.find(t => t.id === removeId);
  const problem = mergeProblem(keep, remove);
  const dupes = likelyDuplicates(all);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--win)' : 'var(--live)' }}>{msg.text}</p>}
      {teams.loading && !teams.data && <p className="muted">Loading teams…</p>}
      {teams.error != null && <p role="alert">{friendlyError(teams.error, 'Could not load teams.')}</p>}

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="teams-pending-h">
        <h3 id="teams-pending-h">Waiting for approval ({pending.length})</h3>
        <p className="src">New teams stay private until you approve them. Captains see their own team meanwhile.</p>
        {!teams.loading && pending.length === 0 && <p className="muted">No teams are waiting.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {pending.map(t => (
            <li key={t.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ overflowWrap: 'anywhere' }}><b>{t.name}</b>{place(t) ? ` · ${place(t)}` : ''}</span>
              <button type="button" className="btn btn-ink" disabled={busy} onClick={() => run(() => approveTeam(t.id), `Approved ${t.name}.`)}>Approve</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="teams-approved-h">
        <h3 id="teams-approved-h">Approved teams ({approved.length})</h3>
        {!teams.loading && approved.length === 0 && <p className="muted">No approved teams yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {approved.map(t => <li key={t.id} style={{ overflowWrap: 'anywhere' }}><b>{t.name}</b>{place(t) ? <span style={{ color: 'var(--muted)' }}> · {place(t)}</span> : null}</li>)}
        </ul>
      </section>

      <section className="panel info" style={{ display: 'grid', gap: 12 }} aria-labelledby="teams-merge-h">
        <h3 id="teams-merge-h">Merge duplicate teams</h3>
        <p className="src">Everything on the duplicate (entries, registrations, roster, captains, affiliations) moves to the team you keep, and the duplicate is deleted. This cannot be undone. It is refused if both teams are entered in the same competition.</p>
        {dupes.length > 0 && (
          <div>
            <p><b>Names that look the same</b></p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {dupes.map(g => <li key={g.map(t => t.id).join()}>{g.map(t => `${t.name} (${t.status})`).join(' · ')}</li>)}
            </ul>
          </div>
        )}
        <label className="field-in">Keep this team
          <select value={keepId} onChange={e => setKeepId(e.target.value)}>
            <option value="">Choose…</option>
            {all.map(t => <option key={t.id} value={t.id}>{t.name} ({t.status})</option>)}
          </select>
        </label>
        <label className="field-in">Merge this duplicate into it (then delete it)
          <select value={removeId} onChange={e => setRemoveId(e.target.value)}>
            <option value="">Choose…</option>
            {all.filter(t => t.id !== keepId).map(t => <option key={t.id} value={t.id}>{t.name} ({t.status})</option>)}
          </select>
        </label>
        {keep && remove && !problem && <p>This will merge <b>{remove.name}</b> into <b>{keep.name}</b>. <Chip tone="brass">Permanent</Chip></p>}
        {problem && keepId && removeId && <p role="status" style={{ color: 'var(--muted)' }}>{problem}</p>}
        <div>
          <button type="button" className="btn btn-ink" disabled={busy || problem !== null}
            onClick={() => {
              if (!keep || !remove) return;
              if (!window.confirm(`Merge "${remove.name}" into "${keep.name}"? "${remove.name}" will be deleted and this cannot be undone.`)) return;
              void run(async () => { await mergeTeams(keep.id, remove.id); setKeepId(''); setRemoveId(''); }, `Merged ${remove.name} into ${keep.name}.`);
            }}>Merge teams</button>
        </div>
      </section>
    </div>
  );
}
