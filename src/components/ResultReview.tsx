import { useMemo, useState } from 'react';
import { enterOfficialResult, fetchResultConflicts, resolveResultConflict, type CompetitionMatch, type MatchResult } from '../data/matches';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const errorStyle = { color: 'var(--live)' } as const;
const word = (r: MatchResult, a: string, b: string) => (r === 'draw' ? 'Draw' : `${r === 'a' ? a : b} won`);

/**
 * "Needs review" for the head marshal and organizers: results two devices disagreed about. The official result was NOT changed; the other
 * device's result is kept as evidence. The decision is recorded with a note in the audit history.
 */
export function ResultConflicts({ eventId, onChanged }: { eventId: string; onChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const list = useAsync(() => fetchResultConflicts(eventId), [eventId, version]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (id: string, decision: 'keep_official' | 'use_proposal') => {
    setBusy(id); setError(null);
    try { await resolveResultConflict(id, decision, notes[id] ?? ''); setVersion(v => v + 1); onChanged(); }
    catch (e) { setError(friendlyError(e, 'Could not save the decision.')); } finally { setBusy(null); }
  };
  const rows = list.data ?? [];
  if (list.error != null) return <p role="alert" style={errorStyle}>{friendlyError(list.error, 'Could not load results that need review.')}</p>;
  if (rows.length === 0) return null;
  return (
    <section className="panel info" role="region" aria-label="Results that need review" style={{ display: 'grid', gap: 12 }}>
      <h3>Needs review: {rows.length} result{rows.length === 1 ? '' : 's'} two devices disagree about</h3>
      <p className="src">The official result below has NOT been changed. Compare it with the paper sheet, then keep it or use the other device's result. Both stay on record.</p>
      {rows.map(c => (
        <div key={c.proposalId} className="panel" style={{ display: 'grid', gap: 8 }}>
          <b>{c.competitionName} · {c.roundLabel}: {c.sideA} vs {c.sideB}</b>
          <span>Official now: <b>{word(c.officialResult, c.sideA, c.sideB)}, {c.officialScoreA}–{c.officialScoreB}</b></span>
          <span>Other device ({c.proposedByName}): <b>{word(c.proposedResult, c.sideA, c.sideB)}, {c.proposedScoreA}–{c.proposedScoreB}</b></span>
          <label className="field-in">How did you decide? (shown in the audit history)
            <input type="text" maxLength={200} value={notes[c.proposalId] ?? ''} placeholder="e.g. checked against paper sheet 14" onChange={e => setNotes(n => ({ ...n, [c.proposalId]: e.target.value }))} />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-line fq-big" disabled={busy !== null || (notes[c.proposalId] ?? '').trim().length < 3} onClick={() => void decide(c.proposalId, 'keep_official')}>Keep the official result</button>
            <button type="button" className="btn btn-ink fq-big" disabled={busy !== null || (notes[c.proposalId] ?? '').trim().length < 3} onClick={() => void decide(c.proposalId, 'use_proposal')}>Use the other device's result</button>
          </div>
        </div>
      ))}
      {error && <p role="alert" style={errorStyle}>{error}</p>}
    </section>
  );
}

/** Paper recovery: type in (or correct) an official result from the score sheet. Goes through the same audited path as every other result. */
export function EnterOfficialResult({ matches, names, onDone }: { matches: readonly CompetitionMatch[]; names: ReadonlyMap<string, string>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const usable = useMemo(() => matches.filter(m => m.entryA && m.entryB), [matches]);
  const [matchId, setMatchId] = useState('');
  const [result, setResult] = useState<MatchResult>('a');
  const [scoreA, setScoreA] = useState('0');
  const [scoreB, setScoreB] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const m = usable.find(x => x.id === matchId);
  const label = (x: CompetitionMatch) => `${names.get(x.competitionId) ?? 'Competition'} · ${x.roundLabel || x.stage}: ${x.nameA ?? 'Side A'} vs ${x.nameB ?? 'Side B'}${x.queueState === 'final' ? ' (already official)' : ''}`;
  const valid = m !== undefined && note.trim().length >= 3 && Number.isInteger(Number(scoreA)) && Number.isInteger(Number(scoreB)) && Number(scoreA) >= 0 && Number(scoreB) >= 0;
  const submit = async () => {
    if (!m || !valid) return;
    setBusy(true); setMessage(null);
    try {
      const r = await enterOfficialResult({ matchId: m.id, result, scoreA: Number(scoreA), scoreB: Number(scoreB), note });
      setMessage({ ok: true, text: r === 'unchanged' ? 'That is already the official result. Nothing changed.' : r === 'corrected' ? 'Official result corrected. The earlier result is kept in the history.' : 'Official result entered.' });
      setNote(''); onDone();
    } catch (e) { setMessage({ ok: false, text: friendlyError(e, 'Could not enter the result.') }); } finally { setBusy(false); }
  };
  return (
    <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-label="Enter official result from paper">
      <h3>Enter official result from paper</h3>
      {!open && <button type="button" className="btn btn-line fq-big" onClick={() => setOpen(true)}>Enter a result from the score sheet</button>}
      {open && (<>
        <p className="src">Use this when you are copying a paper score sheet, or fixing a result after device or signal trouble. It needs signal, and every entry is recorded with your name and the note below.</p>
        <label className="field-in">Match
          <select value={matchId} onChange={e => setMatchId(e.target.value)}>
            <option value="">Choose a match…</option>
            {usable.map(x => <option key={x.id} value={x.id}>{label(x)}</option>)}
          </select>
        </label>
        {m && (<>
          <label className="field-in">Result
            <select value={result} onChange={e => setResult(e.target.value as MatchResult)}>
              <option value="a">{m.nameA ?? 'Side A'} won</option><option value="b">{m.nameB ?? 'Side B'} won</option>
              {(m.stage === 'pool' || m.stage === 'round_robin') && <option value="draw">Draw</option>}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <label className="field-in">{m.nameA ?? 'Side A'} score<input type="number" inputMode="numeric" min={0} step={1} value={scoreA} onChange={e => setScoreA(e.target.value)} /></label>
            <label className="field-in">{m.nameB ?? 'Side B'} score<input type="number" inputMode="numeric" min={0} step={1} value={scoreB} onChange={e => setScoreB(e.target.value)} /></label>
          </div>
        </>)}
        <label className="field-in">Where does this come from? (e.g. paper sheet number)
          <input type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ink fq-big" disabled={busy || !valid} onClick={() => void submit()}>{busy ? 'Saving…' : 'Make this the official result'}</button>
          <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={() => setOpen(false)}>Close</button>
        </div>
        {message && <p role={message.ok ? 'status' : 'alert'} style={message.ok ? undefined : errorStyle}>{message.text}</p>}
      </>)}
    </section>
  );
}
