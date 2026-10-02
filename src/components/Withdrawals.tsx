import { useState } from 'react';
import { Chip } from './ui';
import { recordWalkovers, reinstateEntry, walkoverTargets, withdrawEntry, type CompetitionEntry, type CompetitionMatch } from '../data/matches';
import { friendlyError } from '../lib/friendlyError';

const errorStyle = { color: 'var(--live)' } as const;

/**
 * Entrants of one competition, and taking one out (injured, or no longer wants to fight).
 * Before the event day the draw is rebuilt without them (the caller opens the draw builder). From the event day on the draw stays as it
 * is and their unplayed matches become walkovers for the opponent, so nobody else's schedule moves.
 */
export function Withdrawals({ entries, matches, eventDay, onChanged, onRedraw }: {
  entries: CompetitionEntry[]; matches: CompetitionMatch[]; eventDay: boolean; onChanged: () => void; onRedraw: (name: string) => void;
}) {
  const [picked, setPicked] = useState<CompetitionEntry | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const out = entries.filter(e => e.status === 'withdrawn' || e.status === 'disqualified');
  const inList = entries.filter(e => e.status !== 'withdrawn' && e.status !== 'disqualified');
  const why = reason.trim() || 'Withdrawn';
  const targets = picked ? walkoverTargets(matches, picked.id) : [];

  const confirm = async () => {
    if (!picked) return;
    setBusy(true); setError(null); setNote(null);
    try {
      await withdrawEntry(picked.id);
      if (eventDay) {
        const n = await recordWalkovers(matches, picked.id, why);
        setNote(`${picked.name} is out. ${n === 0 ? 'They had no match left with a known opponent.' : `${n} ${n === 1 ? 'match was' : 'matches were'} recorded as a walkover for the opponent.`}`);
      } else {
        setNote(`${picked.name} is out. Build the new draw below so the pools stay even.`);
        onRedraw(picked.name);
      }
      setPicked(null); setReason('');
      onChanged();
    } catch (e) { setError(friendlyError(e, 'Could not take them out.')); onChanged(); } finally { setBusy(false); }
  };
  const back = async (e: CompetitionEntry) => {
    setBusy(true); setError(null); setNote(null);
    try { await reinstateEntry(e.id); setNote(`${e.name} is back in. ${eventDay ? 'Walkovers already recorded stay; reopen them if needed.' : 'Build a new draw to include them.'}`); onChanged(); }
    catch (x) { setError(friendlyError(x)); } finally { setBusy(false); }
  };

  return (
    <details>
      <summary><b>Entrants</b> ({inList.length}{out.length ? `, ${out.length} out` : ''}) · injured or pulling out</summary>
      <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
        <p className="src">{eventDay
          ? 'It is the event day: taking someone out keeps the draw and gives their remaining matches to the opponent as walkovers.'
          : 'Before the event day: taking someone out rebuilds the draw without them.'}</p>
        {note && <p role="status" style={{ color: 'var(--win)' }}>{note}</p>}
        {error && <p role="alert" style={errorStyle}>{error}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {inList.map(e => (
            <li key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ overflowWrap: 'anywhere' }}>{e.name}</span>
              <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => { setPicked(e); setError(null); setNote(null); }}>Take out</button>
            </li>
          ))}
          {out.map(e => (
            <li key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ overflowWrap: 'anywhere' }}><s>{e.name}</s> <Chip>{e.status === 'disqualified' ? 'Disqualified' : 'Withdrawn'}</Chip></span>
              {e.status === 'withdrawn' && <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void back(e)}>Put back in</button>}
            </li>
          ))}
        </ul>
        {picked && (
          <div className="panel info" role="alertdialog" aria-label={`Take out ${picked.name}`} style={{ display: 'grid', gap: 8 }}>
            <p><b>Take {picked.name} out of this competition?</b> {eventDay
              ? (targets.length > 0 ? `${targets.length} unplayed ${targets.length === 1 ? 'match becomes a walkover' : 'matches become walkovers'} for the opponent.` : 'They have no match left with a known opponent.')
              : 'You then build a new draw without them.'}</p>
            <label className="field-in">Reason (kept with the walkover)
              <input value={reason} maxLength={120} placeholder="For example: injured" onChange={e => setReason(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void confirm()}>{busy ? 'Saving…' : 'Take them out'}</button>
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => setPicked(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
