import { useMemo, useState } from 'react';
import type { MatchRecord, RosterEntry, ScoreRound } from '../types';
import { validateScore } from '../lib/scoring';

export function ScoreDialog({ match, roster, onClose, onSubmit }: { match: MatchRecord; roster: RosterEntry[]; onClose: () => void; onSubmit: (rounds: ScoreRound[], forfeit?: { side: 1 | 2; reason: string }) => Promise<void> }) {
  const [rounds, setRounds] = useState<ScoreRound[]>(Array.from({ length: match.scoringConfig.roundsRequired }, (_, i) => ({ roundNumber: i + 1, side1Score: 0, side2Score: 0 })));
  const [forfeitSide, setForfeitSide] = useState<'' | '1' | '2'>('');
  const [forfeitReason, setForfeitReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const validation = useMemo(() => validateScore(match.scoringConfig, rounds, forfeitSide ? { side: Number(forfeitSide) as 1 | 2, reason: forfeitReason } : undefined), [match.scoringConfig, rounds, forfeitSide, forfeitReason]);
  const name = (side: 1 | 2) => {
    const p = match.participants.find(x => x.sideIndex === side);
    return roster.find(r => r.id === p?.rosterEntryId)?.displayName ?? p?.placeholderLabel ?? `Side ${side}`;
  };
  const change = (index: number, side: 1 | 2, value: number) => setRounds(current => current.map((r, i) => i === index ? { ...r, [side === 1 ? 'side1Score' : 'side2Score']: value } : r));
  const submit = async () => {
    if (!validation.valid) return;
    setSubmitting(true); setServerError('');
    try { await onSubmit(rounds, forfeitSide ? { side: Number(forfeitSide) as 1 | 2, reason: forfeitReason } : undefined); onClose(); }
    catch (e) { setServerError(e instanceof Error ? e.message : 'Unable to submit result.'); }
    finally { setSubmitting(false); }
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={e => e.currentTarget === e.target && onClose()}>
    <section className="dialog" role="dialog" aria-modal="true" aria-label={`Score ${match.label}`}>
      <div className="dialog-head"><div><span className="eyebrow">Guided scoring</span><h2>{match.label}</h2></div><button className="icon-btn" onClick={onClose}>×</button></div>
      <div className="score-names"><strong>{name(1)}</strong><span>vs</span><strong>{name(2)}</strong></div>
      {!forfeitSide && <div className="round-list">{rounds.map((round, index) => <div className="round-row" key={round.roundNumber}><b>Round {round.roundNumber}</b><input type="number" min="0" inputMode="numeric" value={round.side1Score} onChange={e => change(index, 1, Number(e.target.value))}/><span>:</span><input type="number" min="0" inputMode="numeric" value={round.side2Score} onChange={e => change(index, 2, Number(e.target.value))}/></div>)}</div>}
      <div className="forfeit-box"><label>Forfeit side<select value={forfeitSide} onChange={e => setForfeitSide(e.target.value as '' | '1' | '2')}><option value="">No forfeit</option><option value="1">{name(1)}</option><option value="2">{name(2)}</option></select></label>{forfeitSide && <label>Reason<input value={forfeitReason} onChange={e => setForfeitReason(e.target.value)} placeholder="Required reason"/></label>}</div>
      {!validation.valid && <div className="validation-errors">{validation.errors.map(error => <div key={error}>{error}</div>)}</div>}
      {validation.valid && validation.result && <div className="result-preview"><b>Auto result:</b> {validation.result.winnerSide ? `${name(validation.result.winnerSide)} wins` : 'Draw'} • {validation.result.side1Total} : {validation.result.side2Total}</div>}
      {serverError && <div className="validation-errors">{serverError}</div>}
      <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!validation.valid || submitting} onClick={submit}>{submitting ? 'Saving…' : 'Finalize Result'}</button></div>
    </section>
  </div>;
}
