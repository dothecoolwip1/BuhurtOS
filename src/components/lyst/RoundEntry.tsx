import { useEffect, useMemo, useState } from 'react';
import { bump, clampScore } from '../../lib/lyst/rounds';

export interface Hint { slot: string; total: number }
const QUICK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** One side's number: the marshal's awarded score. A tap on a number sets it; − / + fine tune beyond nine. Nothing is pre-filled (an unchosen side shows "–"). */
function Picker({ label, value, onChange, hints, onUseHint, name, side }: { label: string; value: number | null; onChange: (n: number) => void; hints: Hint[]; onUseHint: (h: Hint) => void; name: string; side: 'a' | 'b' }) {
  return (
    <fieldset className={`ly-pick ly-pick-${side}`}>
      <legend className="sr-only">{label}: awarded score</legend>
      <span className="ly-pick-name">{name}</span>
      <output className="ly-pick-val mono" aria-label={`${name}: ${value === null ? 'not chosen' : value}`}>{value === null ? '–' : value}</output>
      <div className="ly-quick" role="group" aria-label={`Quick score for ${name}`}>
        {QUICK.map(n => <button key={n} type="button" className="ly-q" aria-pressed={value === n} onClick={() => onChange(n)}>{n}</button>)}
      </div>
      <div className="ly-step">
        <button type="button" className="btn btn-line" aria-label={`One less for ${name}`} onClick={() => onChange(bump(value ?? 0, -1))}>−</button>
        <button type="button" className="btn btn-line" aria-label={`One more for ${name}`} onClick={() => onChange(bump(value ?? 0, 1))}>+</button>
      </div>
      {hints.length > 0 && (
        <div className="ly-hints" aria-label={`What the counters for ${name} tallied`}>
          <span className="src">Counters</span>
          {hints.map(h => <button key={h.slot} type="button" className="ly-hint" onClick={() => onUseHint(h)} aria-label={`Use counter ${h.slot}'s count of ${h.total} for ${name}`}>{h.slot} · {h.total}</button>)}
        </div>
      )}
    </fieldset>
  );
}

/**
 * THE MARSHAL'S CALL. The operator types what the marshal awarded for the round; CONFIRM ROUND records it. Counters' tallies are shown beside each side as
 * evidence the marshal may look at: they are never combined, averaged or pre-selected, and using one is an explicit tap (recorded only as a "recommended" note).
 * A correction to a confirmed round needs a reason, and the old numbers stay on the record.
 */
export function RoundEntry({ round, names, initial, correcting, hintsA, hintsB, busy, disabledReason, requireReason, onConfirm, onCancel, onReturn, secretary = false }: {
  secretary?: boolean;
  round: number; names: { a: string; b: string }; initial: { a: number; b: number } | null; correcting: boolean; hintsA: Hint[]; hintsB: Hint[]; busy: boolean; disabledReason?: string | null;
  onConfirm: (a: number, b: number, extra: { reason: string | null; recommendedA: number | null; recommendedB: number | null }) => void; onCancel?: () => void;
  onReturn?: (reason: string) => void;
  requireReason?: string | null;
}) {
  const [a, setA] = useState<number | null>(initial ? initial.a : null);
  const [b, setB] = useState<number | null>(initial ? initial.b : null);
  const [recA, setRecA] = useState<number | null>(null);
  const [recB, setRecB] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [returnReason, setReturnReason] = useState('');
  // a different round (or a fresh start) begins from nothing chosen, never from the last round's numbers
  useEffect(() => { setA(initial ? initial.a : null); setB(initial ? initial.b : null); setRecA(null); setRecB(null); setReason(''); }, [round, initial?.a, initial?.b, correcting]);   // eslint-disable-line react-hooks/exhaustive-deps
  const changed = useMemo(() => !correcting || !initial || a !== initial.a || b !== initial.b, [correcting, initial, a, b]);
  const overriding = (a !== null && hintsA.length > 0 && !hintsA.some(h => h.total === a)) || (b !== null && hintsB.length > 0 && !hintsB.some(h => h.total === b));
  const needsReason = correcting || overriding || !!requireReason;
  const reasonOk = !needsReason || reason.trim().length >= 3;
  const ready = a !== null && b !== null && changed && reasonOk && !busy && !disabledReason;
  return (
    <section className="ly-entry panel" aria-label={correcting ? `Correct round ${round}` : `Confirm round ${round}`}>
      <h2 className="ly-h">{correcting ? `Correct round ${round}` : `Round ${round}: the marshal's call`}</h2>
      <p className="src">{correcting ? 'The old score stays on the record. Say why it is being changed.' : 'Enter the score the marshal awards for this round.'}</p>
      {requireReason && <p className="ly-note" role="status">{requireReason}</p>}
      <div className="ly-picks">
        <Picker label="Fighter A" side="a" name={names.a} value={a} onChange={v => { setA(clampScore(v)); setRecA(null); }} hints={hintsA} onUseHint={h => { setA(clampScore(h.total)); setRecA(h.total); }} />
        <Picker label="Fighter B" side="b" name={names.b} value={b} onChange={v => { setB(clampScore(v)); setRecB(null); }} hints={hintsB} onUseHint={h => { setB(clampScore(h.total)); setRecB(h.total); }} />
      </div>
      {needsReason && (
        <label className="ly-reason"><span>{requireReason ? 'Reason for the marshal’s score' : 'Reason for the score change'}</span>
          <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="For example: marshal re-counted after the break" aria-required="true" />
        </label>
      )}
      {disabledReason && <p className="ly-note" role="status">{disabledReason}</p>}
      <div className="ly-confirm-row">
        {onCancel && <button type="button" className="btn btn-line fq-big" disabled={busy} onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn btn-win fq-big ly-confirm" disabled={!ready}
          onClick={() => a !== null && b !== null && onConfirm(a, b, { reason: needsReason ? reason.trim() : null, recommendedA: recA, recommendedB: recB })}>
          {busy ? 'Saving…' : a === null || b === null ? 'Choose both scores' : correcting ? `Save correction ${a}–${b}` : `${secretary ? 'Accept scores' : 'Confirm round'} ${a}–${b}`}
        </button>
      </div>
      {onReturn && <details className="ly-return"><summary className="btn btn-line">Return for recount</summary>
        <label className="ly-reason">Reason<input value={returnReason} onChange={e => setReturnReason(e.target.value)} maxLength={200} disabled={busy} /></label>
        <button type="button" className="btn btn-line fq-big" disabled={busy || !!disabledReason || returnReason.trim().length < 3} onClick={() => onReturn(returnReason.trim())}>Return scores to counters</button>
      </details>}
    </section>
  );
}
