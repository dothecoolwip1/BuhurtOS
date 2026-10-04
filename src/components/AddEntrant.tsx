import { useEffect, useMemo, useRef, useState } from 'react';
import { Chip } from './ui';
import { addEntrant, createUnclaimedEntrant, searchEntrants, type EntrantCandidate } from '../data/entrants';
import type { LiveCompetition } from '../data/api';
import type { CompetitionEntry } from '../data/matches';
import { fetchApprovedTeams, type TeamChoice } from '../data/myTeams';
import { addedMessage, candidateContext, defaultEntryTeam, isLookAlikeRefusal, newEntrantProblem, sameNameCandidates } from '../lib/entrants';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { PROVINCES } from '../registration/model';

const errorStyle = { color: 'var(--live)' } as const;

/**
 * Add entrant: search the fighters BuhurtOS already knows, pick the right person, or create a new profile for someone with no account.
 * The new profile is a normal permanent fighter record (they can claim it when they sign up). Adding never merges two people: a
 * same-name match is shown with team and place, and creating a separate fighter needs a deliberate second tap.
 */
export function AddEntrant({ comp, eventId, entries, drawExists, onAdded }: {
  comp: LiveCompetition; eventId: string; entries: CompetitionEntry[]; drawExists: boolean; onAdded: () => void;
}) {
  const teamComp = comp.league === 'buhurt';
  const finished = comp.status === 'finished';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<EntrantCandidate[]>([]);
  const [searched, setSearched] = useState('');
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [homeTeam, setHomeTeam] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [gender, setGender] = useState('');
  const [entryTeam, setEntryTeam] = useState('');
  const [confirmSame, setConfirmSame] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const teams = useAsync(() => (open ? fetchApprovedTeams() : Promise.resolve([] as TeamChoice[])), [open]);

  const entered = useMemo(() => entries.filter(e => e.teamId && e.status !== 'withdrawn' && e.status !== 'disqualified').map(e => ({ id: e.teamId as string, name: e.name })), [entries]);
  const allTeams = useMemo(() => (teams.data ?? []).map(t => ({ id: t.id, name: t.name })), [teams.data]);
  const otherTeams = allTeams.filter(t => !entered.some(e => e.id === t.id));

  useEffect(() => { if (open) first.current?.focus(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) { setFound([]); setSearched(''); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchEntrants(comp.id, q).then(
        r => { if (live) { setFound(r); setSearched(q); setSearching(false); } },
        e => { if (live) { setError(friendlyError(e, 'Search failed.')); setSearching(false); } }
      );
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, query, comp.id]);

  const teamFor = (candidateTeam: string | null) => entryTeam || defaultEntryTeam(candidateTeam, entered, allTeams);
  const needsTeam = (team: string) => teamComp && !team;

  const finish = (who: string, already: boolean) => {
    setNote(addedMessage(who, already, drawExists));
    setQuery(''); setFound([]); setSearched(''); setCreating(false); setConfirmSame(false); setName('');
    onAdded();
  };
  const addExisting = async (c: EntrantCandidate) => {
    if (needsTeam(teamFor(c.team))) { setError('Choose the team this fighter fights for in this group fight.'); return; }
    setBusy(true); setError(null); setNote(null);
    try { const r = await addEntrant(comp.id, c.fighterId, teamComp ? teamFor(c.team) : null); finish(c.name, r.already); }
    catch (e) { setError(friendlyError(e, 'Could not add them.')); } finally { setBusy(false); }
  };

  const startCreate = () => { setName(query.trim()); setCreating(true); setConfirmSame(false); setError(null); setNote(null); };
  const lookAlikes = sameNameCandidates(found, name);
  const create = async () => {
    const p = newEntrantProblem(name);
    if (p) { setError(p); return; }
    const createTeam = entryTeam || homeTeam;
    if (needsTeam(createTeam)) { setError('Choose the team this fighter fights for in this group fight.'); return; }
    if (lookAlikes.length > 0 && !confirmSame) { setConfirmSame(true); return; }
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await createUnclaimedEntrant(eventId, comp.id, { name, homeTeamId: homeTeam || null, city, region, gender }, teamComp ? createTeam : null, confirmSame);
      finish(name.trim(), r.already);
    } catch (e) {
      if (isLookAlikeRefusal(e)) { setConfirmSame(true); setError('A fighter with this name already exists. Check the list, or confirm this is a different person.'); }
      else setError(friendlyError(e, 'Could not create the fighter.'));
    } finally { setBusy(false); }
  };

  if (finished) return null;
  if (!open) {
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <button type="button" className="btn btn-line" data-testid={`add-entrant-${comp.id}`} onClick={() => { setOpen(true); setNote(null); }}>+ Add entrant</button>
        {note && <p role="status" style={{ color: 'var(--win)' }}>{note}</p>}
      </div>
    );
  }
  const noMatch = searched === query.trim() && query.trim().length >= 2 && !searching && found.length === 0;
  return (
    <div className="panel" role="group" aria-label={`Add entrant to ${comp.name}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, minWidth: 0 }} data-testid="add-entrant-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <b>Add entrant</b>
        <button type="button" className="btn btn-line btn-sm" onClick={() => { setOpen(false); setCreating(false); setError(null); }}>Done</button>
      </div>
      {note && <p role="status" style={{ color: 'var(--win)' }} data-testid="add-entrant-note">{note}</p>}
      {error && <p role="alert" style={errorStyle}>{error}</p>}

      {teamComp && (
        <label className="field-in">Team they fight for in this group fight
          <select value={entryTeam} onChange={e => setEntryTeam(e.target.value)} data-testid="entry-team">
            <option value="">{creating ? 'Same as their home team' : 'Their own team (if listed)'}</option>
            {entered.length > 0 && <optgroup label="Teams in this competition">{entered.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
            {otherTeams.length > 0 && <optgroup label="Other teams">{otherTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
          </select>
        </label>
      )}

      {!creating && (
        <>
          <label className="field-in">Find the fighter first (name, team or city)
            <input ref={first} type="search" inputMode="search" autoComplete="off" value={query} onChange={e => { setQuery(e.target.value); setNote(null); setError(null); }} data-testid="entrant-search" placeholder="For example: Zed Newcomer" />
          </label>
          {searching && <p className="src">Searching…</p>}
          {found.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }} data-testid="entrant-results">
              {found.map(c => (
                <li key={c.fighterId} className="panel" style={{ display: 'grid', gap: 6, padding: 12 }}>
                  <div style={{ overflowWrap: 'anywhere' }}><b>{c.name}</b> {!c.claimed && <Chip>Unclaimed profile</Chip>}</div>
                  <span className="src">{candidateContext(c)}{c.inEvent && !c.inCompetition ? ' · already at this event' : ''}</span>
                  {c.inCompetition
                    ? <Chip tone="win">Already in this competition</Chip>
                    : <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void addExisting(c)} aria-label={`Add ${c.name}`}>{busy ? 'Adding…' : 'Add'}</button>}
                </li>
              ))}
            </ul>
          )}
          {noMatch && <p className="src">No fighter found for “{query.trim()}”.</p>}
          <button type="button" className="btn btn-line" style={{ whiteSpace: 'normal', height: 'auto', padding: '10px 14px', overflowWrap: 'anywhere' }} data-testid="create-new" onClick={startCreate} disabled={query.trim().length < 2 && !creating}>
            {query.trim().length >= 2 ? `Not them? Create “${query.trim()}” as a new fighter` : 'Create a new fighter'}
          </button>
          {query.trim().length < 2 && <p className="src">Search first so nobody ends up with two profiles. Type at least 2 letters.</p>}
        </>
      )}

      {creating && (
        <form onSubmit={e => { e.preventDefault(); void create(); }} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }} aria-label="New fighter">
          <p className="src">This makes a real fighter record. If they create a BuhurtOS account later they can claim it and keep their history. No email is needed.</p>
          <label className="field-in">Name<input value={name} maxLength={80} onChange={e => { setName(e.target.value); setConfirmSame(false); }} data-testid="new-name" autoComplete="off" /></label>
          <label className="field-in">Home team (optional)
            <select value={homeTeam} onChange={e => setHomeTeam(e.target.value)}>
              <option value="">No team</option>
              {(teams.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}{t.city ? ` · ${t.city}` : ''}</option>)}
            </select>
          </label>
          <label className="field-in">City (optional)<input value={city} maxLength={80} onChange={e => setCity(e.target.value)} autoComplete="off" /></label>
          <label className="field-in">Province or state (optional)
            <select value={region} onChange={e => setRegion(e.target.value)}><option value="">Not given</option>{PROVINCES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          </label>
          <label className="field-in">Gender (optional)
            <select value={gender} onChange={e => setGender(e.target.value)}><option value="">Not given</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
          </label>
          {lookAlikes.length > 0 && (
            <div className="panel info" role="alert" style={{ display: 'grid', gap: 8 }} data-testid="same-name-warning">
              <b>{lookAlikes.length === 1 ? 'A fighter with this name already exists:' : `${lookAlikes.length} fighters with this name already exist:`}</b>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{lookAlikes.map(c => <li key={c.fighterId}>{c.name} · {candidateContext(c)}</li>)}</ul>
              <span>Names can match without being the same person. If this is one of them, go back and add them instead.</span>
              {confirmSame && <span>Tap again to create a separate fighter. The administrator is asked to double-check the two.</span>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-ink" disabled={busy} data-testid="create-entrant">
              {busy ? 'Saving…' : lookAlikes.length > 0 ? (confirmSame ? 'Create a separate fighter and add' : 'This is a different person') : 'Create and add to this competition'}
            </button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setCreating(false); setConfirmSame(false); setError(null); }}>Back to search</button>
          </div>
        </form>
      )}
    </div>
  );
}
