import { useEffect, useRef, useState } from 'react';
import type { CompetitionEntry, CompetitionMatch } from '../../data/matches';
import { fetchEditableLineup, replaceMatchEntrant, saveFieldLineup } from '../../data/organizerEdits';
import { friendlyError } from '../../lib/friendlyError';
import { moveLineup } from '../../lib/lineup';
import { matchTitle } from '../../lib/eventDay';

export function FieldLineupEditor({ eventId, field, matches, entries, onClose, onChanged }: {
  eventId: string; field: string; matches: CompetitionMatch[]; entries: readonly CompetitionEntry[];
  onClose: () => void; onChanged: () => void;
}) {
  // Snapshot versions deliberately: live changes must cause a server conflict, never silently overwrite another operator.
  const snapshot = useRef(matches);
  const [rows, setRows] = useState<CompetitionMatch[]>([]);
  const [ready, setReady] = useState(false);
  const [replacement, setReplacement] = useState<{ match: CompetitionMatch; side: 'a' | 'b' } | null>(null);
  const [entry, setEntry] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const dragged = useRef<string | null>(null);
  const original = useRef<CompetitionMatch[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchEditableLineup(eventId, field).then(ids => {
      if (!alive) return;
      const editable = new Set(ids);
      const found = snapshot.current.filter(m => editable.has(m.id));
      if (found.length !== editable.size) throw new Error('The field changed. Cancel and reopen the editor to reload it.');
      original.current = found; setRows(found); setReady(true);
    }).catch(e => { if (alive) setError(friendlyError(e)); });
    return () => { alive = false; };
  }, [eventId, field]);
  const changed = rows.some((m, i) => original.current[i]?.id !== m.id);
  const move = (from: string, to: string) => {
    setRows(current => moveLineup(current, from, to));
    setMessage('Fight order changed. Save order to apply it.');
  };
  const save = async () => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      if (replacement) await replaceMatchEntrant(replacement.match, replacement.side, entry, reason);
      else await saveFieldLineup(eventId, field, rows);
      onChanged(); onClose();
    } catch (e) { setError(friendlyError(e, 'Could not save. The fight may have changed; cancel and reopen the editor to reload it.')); }
    finally { sending.current = false; setBusy(false); }
  };
  const candidates = replacement ? entries.filter(e => e.competitionId === replacement.match.competitionId && !['withdrawn', 'disqualified'].includes(e.status) && e.id !== replacement.match.entryA && e.id !== replacement.match.entryB) : [];
  return <section className="panel info lineup-editor" aria-label={`Edit upcoming fights on ${field}`}>
    <h3>{replacement ? 'Replace fighter or team' : 'Edit upcoming fights'}</h3>
    <p className="src">{replacement ? 'Choose an entrant from this competition. Started fights and bracket-fed places cannot be changed here.' : 'Drag a fight, or use Up and Down. The first two eligible fights will be next and in the hole. Save applies the whole order.'}</p>
    {!ready && !error && <p role="status">Loading editable fights…</p>}
    {error && <p role="alert">{error}</p>}
    <p className="sr-only" role="status">{message}</p>
    {replacement ? <>
      <p><b>{matchTitle(replacement.match)}</b>  ·  {replacement.side === 'a' ? 'First side' : 'Second side'}</p>
      <label>Replacement<select aria-label="Replacement" value={entry} onChange={e => setEntry(e.target.value)} disabled={busy}><option value="">Choose fighter or team</option>{candidates.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label>Reason<input value={reason} onChange={e => setReason(e.target.value)} disabled={busy} maxLength={200} /></label>
      <p className="src">The server checks eligibility and scheduling conflicts before saving. This change is recorded in event history.</p>
    </> : <ol className="lineup-list">{rows.map((m, i) => <li key={m.id} draggable={!busy} onDragStart={e => { dragged.current = m.id; e.dataTransfer.setData('text/plain', m.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { dragged.current = null; }} onDragOver={e => { if (!busy && dragged.current) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!busy && dragged.current) move(dragged.current, m.id); dragged.current = null; }}>
      <span><small>Position {i + 1}{!m.entryA || !m.entryB ? ' · Waiting for opponent' : ''}</small><br /><b>{matchTitle(m)}</b></span>
      <div className="lineup-actions">
        <button type="button" className="btn btn-line" disabled={busy || i === 0} aria-label={`Move ${matchTitle(m)} up`} onClick={() => move(m.id, rows[i - 1].id)}>Up</button>
        <button type="button" className="btn btn-line" disabled={busy || i === rows.length - 1} aria-label={`Move ${matchTitle(m)} down`} onClick={() => move(m.id, rows[i + 1].id)}>Down</button>
        {(['a', 'b'] as const).map(side => <button type="button" className="btn btn-line" key={side} disabled={busy || changed} onClick={() => { setReplacement({ match: m, side }); setEntry(''); setReason(''); }}>Replace {side === 'a' ? m.nameA ?? 'first side' : m.nameB ?? 'second side'}</button>)}
      </div>
    </li>)}</ol>}
    <div className="lineup-actions">
      <button type="button" className="btn btn-ink" disabled={!ready || busy || (replacement ? !entry || reason.trim().length < 3 : !changed)} onClick={() => void save()}>{busy ? 'Saving...' : replacement ? 'Save replacement' : 'Save order'}</button>
      <button type="button" className="btn btn-line" disabled={busy} onClick={onClose}>Cancel</button>
    </div>
  </section>;
}
