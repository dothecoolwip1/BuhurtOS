import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { CareerResult } from '../data/careerProfile';
import { fetchMyFighterId } from '../data/fighters';
import { addPastMedal, fetchDisciplines, fetchPastMedalEvents, fetchPastMedalRecords, withdrawPastMedal } from '../data/pastMedals';
import { friendlyError } from '../lib/friendlyError';
import {
  EMPTY_DRAFT, MEDAL_PLACES, NOTE_MAX, draftProblem, eventWhen, eventWhere, medalsAtPastTournaments, placeName, reportStatusText, reportableDisciplines, sortPastMedalEvents,
  type PastMedalDraft
} from '../lib/pastMedals';
import { medalOf } from '../lib/careerView';
import { useAsync } from '../lib/useAsync';
import { MedalChip } from './CareerBlocks';
import { Chip } from './ui';

/**
 * A fighter's own past medals: podium places from tournaments that were not run in BuhurtOS (medals-only tournaments). The fighter adds them
 * themself; each shows as "reported, not verified" and earns no ranking points. Shown on the fighter's own profile only. The database decides
 * who may add what (add_past_medal / withdraw_past_medal); this is the form and the list.
 */
export function PastMedals({ fighterId, results, onChanged }: { fighterId: string; results: readonly CareerResult[]; onChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const events = useAsync(fetchPastMedalEvents, []);
  const disciplines = useAsync(fetchDisciplines, []);
  const records = useAsync(() => fetchPastMedalRecords(fighterId), [fighterId], [version]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PastMedalDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const tournaments = useMemo(() => sortPastMedalEvents(events.data ?? []), [events.data]);
  const options = useMemo(() => reportableDisciplines(disciplines.data ?? []), [disciplines.data]);
  const groups = useMemo(() => medalsAtPastTournaments(results, tournaments, records.data ?? []), [results, tournaments, records.data]);
  const problem = draftProblem(draft, tournaments, options, results);
  const changed = () => { setVersion(v => v + 1); onChanged(); };

  const send = async () => {
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await addPastMedal({ eventId: draft.eventId, category: draft.category, place: draft.place, note: draft.note });
      const ev = tournaments.find(e => e.id === draft.eventId);
      const disc = options.find(d => d.code === draft.category);
      setDone(r.status === 'already_recorded' ? `That ${placeName(draft.place).toLowerCase()} was already on your profile.` : `${placeName(draft.place)} in ${disc?.name ?? draft.category} at ${ev?.name ?? 'the tournament'} added.`);
      setDraft(d => ({ ...d, category: '', place: 0, note: '' }));
      changed();
    } catch (e) { setError(friendlyError(e, 'Could not add the medal.')); } finally { setBusy(false); }
  };
  const remove = async (resultId: string, label: string) => {
    if (!window.confirm(`Remove ${label} from your profile? This is kept in the record as withdrawn.`)) return;
    setRemoving(resultId); setError(null); setDone(null);
    try { await withdrawPastMedal(resultId); setDone(`${label} removed.`); changed(); }
    catch (e) { setError(friendlyError(e, 'Could not remove the medal.')); } finally { setRemoving(null); }
  };

  return (
    <section className="panel info" id="past-medals" aria-labelledby="pm-h" style={{ scrollMarginTop: 80 }} data-testid="past-medals">
      <div className="rowline"><h2 id="pm-h" className="h3">Past medals</h2></div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Medals from tournaments that were not run in BuhurtOS. They show on your profile and the tournament's page as reported by you, not verified, and earn no ranking points.
      </p>
      {records.error != null && <p role="alert">{friendlyError(records.error, 'Could not load your past medals.')}</p>}
      {groups.length === 0 && !events.loading && <p className="muted">No past medals added yet.</p>}
      {groups.map(g => (
        <div key={g.event.id} style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
          <p style={{ margin: 0 }}><Link to={`/events/${g.event.slug}/results`}><b>{g.event.name}</b></Link> <span className="src">{eventWhen(g.event)}{eventWhere(g.event) ? ` · ${eventWhere(g.event)}` : ''}</span></p>
          <ul className="plain" style={{ margin: 0 }}>
            {g.medals.map(({ result: r, record }) => {
              const label = `${placeName(r.finalPlace)} in ${r.categoryName}`;
              return (
                <li key={r.competitionId} className="rowline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span><MedalChip medal={medalOf(r.finalPlace)} place={r.finalPlace} /> {r.categoryName}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {record && <Chip>{reportStatusText(record.status)}</Chip>}
                    {record?.status === 'unverified' && (
                      <button type="button" className="linklike" disabled={removing === record.resultId} onClick={() => void remove(record.resultId, label)} aria-label={`Remove ${label} at ${g.event.name}`}>
                        {removing === record.resultId ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {done && <p role="status" style={{ color: 'var(--win)' }} data-testid="past-medal-done">{done}</p>}
      {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
      {!open && <p style={{ margin: 0 }}><button type="button" className="btn btn-ink" onClick={() => { setOpen(true); setDone(null); }} data-testid="past-medal-add">Add a past medal</button></p>}
      {open && (
        <form style={{ display: 'grid', gap: 8 }} onSubmit={e => { e.preventDefault(); void send(); }} aria-label="Add a past medal">
          {(events.error != null || disciplines.error != null) && <p role="alert">{friendlyError(events.error ?? disciplines.error, 'Could not load the tournaments.')}</p>}
          <label className="field-in">Tournament
            <select value={draft.eventId} onChange={e => setDraft(d => ({ ...d, eventId: e.target.value }))} required data-testid="past-medal-event">
              <option value="">{events.loading ? 'Loading…' : 'Choose a tournament'}</option>
              {tournaments.map(e => <option key={e.id} value={e.id}>{e.name} · {eventWhen(e)}</option>)}
            </select>
          </label>
          <label className="field-in">Discipline
            <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} required data-testid="past-medal-discipline">
              <option value="">{disciplines.loading ? 'Loading…' : 'Choose a discipline'}</option>
              {options.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
            </select>
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-in" style={{ marginBottom: 4 }}>Medal</legend>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {MEDAL_PLACES.map(([place, name]) => (
                <button key={place} type="button" className={draft.place === place ? 'btn btn-ink' : 'btn btn-line'} aria-pressed={draft.place === place} onClick={() => setDraft(d => ({ ...d, place }))} data-testid={`past-medal-place-${place}`}>{name}</button>
              ))}
            </div>
          </fieldset>
          <label className="field-in">Note (optional)
            <input type="text" maxLength={NOTE_MAX} value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} placeholder="For example: open division, 12 fighters" data-testid="past-medal-note" />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-ink" disabled={busy || !!problem} title={problem ?? undefined} data-testid="past-medal-send">{busy ? 'Adding…' : 'Add medal'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Done</button>
          </div>
          <p className="src" style={{ margin: 0 }}>Your tournament is not in the list? Ask the BuhurtOS owner to add it; then you and everyone who fought there can add their medals to it.</p>
        </form>
      )}
    </section>
  );
}

/** On a medals-only tournament's page: the way to one's own profile to add a medal there (or to sign in first). */
export function AddMyMedalLink() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const mine = useAsync(() => (userId ? fetchMyFighterId() : Promise.resolve(null)), [userId]);
  if (!session) return <Link className="btn btn-line" to="/account">Sign in to add your medal</Link>;
  if (mine.loading) return null;
  if (!mine.data) return <Link className="btn btn-line" to="/claim-profile">Find your fighter profile to add your medal</Link>;
  return <Link className="btn btn-ink" to={`/fighters/${mine.data}#past-medals`}>Add my medal</Link>;
}
