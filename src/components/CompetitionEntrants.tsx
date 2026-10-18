import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AddEntrant } from './AddEntrant';
import { Chip } from './ui';
import { Withdrawals } from './Withdrawals';
import type { LiveCompetition } from '../data/api';
import { fetchClaimStates } from '../data/entrants';
import { fetchCompetitionMatches, fetchEntries } from '../data/matches';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const errorStyle = { color: 'var(--live)' } as const;

/**
 * One competition's entrants, entered by hand: the organizer searches the fighters BuhurtOS knows, or creates a profile for someone with
 * no account, and they are in. Nobody has to register on BuhurtOS first. The same database rules as the draw tools apply (add_entrant,
 * create_unclaimed_fighter), and taking someone out is the same Withdrawals flow.
 */
export function CompetitionEntrants({ comp, eventId, eventDay, drawsTo }: { comp: LiveCompetition; eventId: string; eventDay: boolean; drawsTo: string | null }) {
  const [reload, setReload] = useState(0);
  const [redrawFor, setRedrawFor] = useState<string | null>(null);
  const entries = useAsync(() => fetchEntries(comp.id), [comp.id, reload]);
  const matches = useAsync(() => fetchCompetitionMatches(comp.id), [comp.id, reload]);
  const fighterIds = (entries.data ?? []).map(e => e.fighterId).filter((x): x is string => !!x);
  const claims = useAsync(() => fetchClaimStates(fighterIds), [fighterIds.join(',')], [reload]);
  const unclaimed = useMemo(() => new Set(fighterIds.filter(id => claims.data?.get(id) === false)), [claims.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = entries.data ?? [];
  const list = matches.data ?? [];
  const inList = all.filter(e => e.status !== 'withdrawn' && e.status !== 'disqualified');
  const changed = () => setReload(k => k + 1);

  return (
    <section className="panel" style={{ display: 'grid', gap: 10, padding: 14 }} aria-label={`${comp.name} entrants`} data-testid={`competition-entrants-${comp.id}`}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>{comp.name}</h4>
        <Chip tone="steel">{entries.loading && !entries.data ? 'Counting…' : `${inList.length} ${inList.length === 1 ? 'entrant' : 'entrants'}`}</Chip>
        {comp.status === 'finished' && <Chip tone="win">Finished</Chip>}
      </div>
      {entries.error != null && <p role="alert" style={errorStyle}>{friendlyError(entries.error, 'Could not load entrants.')}</p>}
      {comp.status === 'finished' && <p className="src">This competition is finished. Reopen a match on the Results side before changing its entrants.</p>}
      {redrawFor && (
        <p role="status" className="src">
          {redrawFor} is out. The draw still has them: {drawsTo ? <Link to={drawsTo}>build a new draw</Link> : 'build a new draw'} when you are ready.
        </p>
      )}
      <AddEntrant comp={comp} eventId={eventId} entries={all} drawExists={list.length > 0} onAdded={changed} />
      {all.length > 0 && (
        <Withdrawals entries={all} unclaimed={unclaimed} matches={list} eventDay={eventDay} onChanged={changed} onRedraw={name => setRedrawFor(name)} />
      )}
      {all.length === 0 && entries.data && <p className="muted">Nobody is entered yet.</p>}
    </section>
  );
}
