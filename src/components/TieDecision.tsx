import { useState } from 'react';
import type { LiveCompetition } from '../data/api';
import { recordTieDecision } from '../data/matches';
import { friendlyError } from '../lib/friendlyError';
import { moveItem } from '../lib/runDraw';

const errorStyle = { color: 'var(--live)' } as const;

/** Level entries that decide who advances: the organizer puts them in order and says how it was decided. The database keeps who, when and why. */
export function TieDecision({ comp, group, nameOf, onDecided }: { comp: LiveCompetition; group: { part: string; rank: number; entryIds: string[] }; nameOf: (id: string) => string; onDecided: () => void }) {
  const [order, setOrder] = useState<string[]>(group.entryIds);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await recordTieDecision(comp.id, group.part, order, note); onDecided(); }
    catch (e) { setError(friendlyError(e, 'Could not save the order.')); } finally { setBusy(false); }
  };
  return (
    <div className="panel" role="group" aria-label={`Tie for place ${group.rank}${group.part ? ` in pool ${group.part}` : ''}`} style={{ display: 'grid', gap: 8 }}>
      <b>{group.part ? `Pool ${group.part}: ` : ''}these {order.length} are level for place {group.rank}. Put them in the order they should finish.</b>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        {order.map((id, i) => (
          <li key={id}>{nameOf(id)}{' '}
            <button type="button" className="btn btn-line btn-sm" aria-label={`Move ${nameOf(id)} up`} disabled={i === 0 || busy} onClick={() => setOrder(moveItem(order, i, -1))}>Up</button>{' '}
            <button type="button" className="btn btn-line btn-sm" aria-label={`Move ${nameOf(id)} down`} disabled={i === order.length - 1 || busy} onClick={() => setOrder(moveItem(order, i, 1))}>Down</button>
          </li>
        ))}
      </ol>
      <label className="field-in">How was this decided?
        <input type="text" value={note} maxLength={200} placeholder="e.g. head marshal drew lots" onChange={e => setNote(e.target.value)} />
      </label>
      <button type="button" className="btn btn-ink" disabled={busy || note.trim().length < 3} onClick={save}>{busy ? 'Saving…' : 'Save this order'}</button>
      {error && <p role="alert" style={errorStyle}>{error}</p>}
    </div>
  );
}
