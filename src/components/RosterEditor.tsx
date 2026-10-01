import { useEffect, useMemo, useState } from 'react';
import { Chip } from './ui';
import { fetchEntryRoster, setEntryRoster, type EntryRosterRow, type RosterRole } from '../data/fighters';
import { fetchTeamFighters, searchFighters, type FighterOption } from '../data/runSchedule';
import { friendlyError } from '../lib/friendlyError';
import { canAdd, formatSize, homeTeamNotice, roleChoices, rosterRefusal, validateRoster } from '../lib/rosterRules';
import { useAsync } from '../lib/useAsync';

const errorStyle = { color: 'var(--live)' } as const;
const ROLE_TEXT: Record<RosterRole, string> = { fighter: 'Team member', mercenary: 'Mercenary', guest: 'Guest' };

/** Who stands on the field for one team entry. Changes save at once; the home team of a mercenary or guest never changes. */
export function RosterEditor({ entryId, entryName, teamId, category, locked, onChanged }: {
  entryId: string; entryName: string; teamId: string | null; category: string; locked: boolean; onChanged: () => void;
}) {
  const [reload, setReload] = useState(0);
  const roster = useAsync(() => fetchEntryRoster(entryId), [entryId, reload]);
  const members = useAsync(() => (teamId ? fetchTeamFighters(teamId) : Promise.resolve([] as FighterOption[])), [teamId]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FighterOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<FighterOption | null>(null);
  const [role, setRole] = useState<RosterRole>('mercenary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: EntryRosterRow[] = roster.data ?? [];
  const size = formatSize(category);
  const check = useMemo(() => validateRoster(rows.map(r => ({ fighterId: r.fighterId, role: r.role })), size), [rows, size]);

  useEffect(() => {
    if (query.trim().length < 2) { setFound([]); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchFighters(query).then(r => { if (live) { setFound(r); setSearching(false); } }, e => { if (live) { setError(friendlyError(e, 'Search failed.')); setSearching(false); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  const save = async (next: Array<{ fighterId: string; role: RosterRole }>) => {
    setBusy(true); setError(null);
    try { await setEntryRoster(entryId, next); setPick(null); setQuery(''); setReload(k => k + 1); onChanged(); }
    catch (e) { setError(rosterRefusal((e as { message?: string })?.message) ?? friendlyError(e, 'Could not save the roster.')); } finally { setBusy(false); }
  };
  const current = rows.map(r => ({ fighterId: r.fighterId, role: r.role }));
  const add = (f: FighterOption, r: RosterRole) => {
    const ok = canAdd(current, f.fighterId);
    if (!ok.ok) { setError(ok.reason); return; }
    return save([...current, { fighterId: f.fighterId, role: r }]);
  };
  const remove = (fighterId: string) => save(current.filter(c => c.fighterId !== fighterId));

  const onRoster = new Set(rows.map(r => r.fighterId));
  const teamLeft = (members.data ?? []).filter(f => !onRoster.has(f.fighterId));
  const choose = (f: FighterOption) => { setPick(f); setRole(roleChoices(f, teamId)[0]); setError(null); };
  const pickChoices = pick ? roleChoices(pick, teamId) : [];
  const notice = pick ? homeTeamNotice(pick, role, entryName) : null;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>{entryName}</b>
        <Chip tone={size !== null && rows.length >= size ? 'win' : 'steel'}>{size !== null ? `${rows.length} of ${size}` : `${rows.length} on the roster`}</Chip>
      </div>
      {roster.error != null && <p role="alert" style={errorStyle}>{friendlyError(roster.error, 'Could not load the roster.')}</p>}
      {roster.loading && !roster.data && <p className="muted">Loading roster…</p>}
      {roster.data && rows.length === 0 && <p className="src">No roster yet. Add the fighters who will take the field.</p>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {rows.map((r, i) => (
          <li key={r.fighterId} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 160px', overflowWrap: 'anywhere' }}>
              {r.displayName}
              {size !== null && i >= size && <span className="src"> (substitute)</span>}
              {r.role !== 'fighter' && <span className="src"> {ROLE_TEXT[r.role]}{r.permanentTeamName ? `, home team ${r.permanentTeamName}` : ', no home team'}</span>}
            </span>
            {!locked && <button type="button" className="btn btn-line" disabled={busy} aria-label={`Remove ${r.displayName} from ${entryName}`} onClick={() => remove(r.fighterId)}>Remove</button>}
          </li>
        ))}
      </ul>
      {check.notes.map(n => <p key={n} className="src">{n}</p>)}
      {check.errors.map(n => <p key={n} role="alert" style={errorStyle}>{n}</p>)}
      {locked && <p className="src">This competition is finished, so the roster is locked. Reopen a match to change it.</p>}

      {!locked && (<>
        {teamLeft.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            <span>Add from {entryName}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {teamLeft.map(f => <button key={f.fighterId} type="button" className="btn btn-line" disabled={busy} onClick={() => add(f, 'fighter')}>{f.displayName}</button>)}
            </div>
          </div>
        )}
        <label className="field-in">Add someone from another team, or a guest (search by name)
          <input type="search" value={query} placeholder="Start typing a name" onChange={e => { setQuery(e.target.value); setPick(null); }} />
        </label>
        {searching && <p className="muted">Searching…</p>}
        {!searching && query.trim().length >= 2 && found.length === 0 && <p className="src">No fighters match that name.</p>}
        {found.filter(f => !onRoster.has(f.fighterId)).map(f => (
          <div key={f.fighterId} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 160px', overflowWrap: 'anywhere' }}>{f.displayName} <span className="src">{f.homeTeamName ? `home team ${f.homeTeamName}` : 'no home team'}</span></span>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => choose(f)}>Choose</button>
          </div>
        ))}
        {pick && (
          <div className="panel info" style={{ display: 'grid', gap: 8 }} role="group" aria-label={`Add ${pick.displayName}`}>
            <b>Add {pick.displayName} to {entryName}</b>
            {pickChoices.length > 1 && (
              <div className="seg" role="group" aria-label="Role">
                {pickChoices.map(c => <button key={c} type="button" aria-pressed={role === c} onClick={() => setRole(c)}>{ROLE_TEXT[c]}</button>)}
              </div>
            )}
            {notice && <p>{notice}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ink" disabled={busy} onClick={() => add(pick, role)}>{busy ? 'Saving…' : 'Add to roster'}</button>
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => setPick(null)}>Cancel</button>
            </div>
          </div>
        )}
      </>)}
      {error && <p role="alert" style={errorStyle}>{error}</p>}
    </div>
  );
}
