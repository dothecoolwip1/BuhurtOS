import { useState } from 'react';
import { Dialog } from '../Dialog';
import type { DisciplineKind, LystSettings } from '../../lib/lyst/rounds';
import { RulePicker } from '../rules/RulesSheet';

export interface DisciplineDraft { kind: DisciplineKind; side: 'a' | 'b'; label: string | null; amount: number; reason: string | null; calledBy: string | null; alsoDeduct: number; /** Pack 22: the official rule it was for, if the operator picked one. */ ruleId: string | null }

const KINDS: { kind: DisciplineKind; word: string; hint: string }[] = [
  { kind: 'warning', word: 'Warning', hint: 'Recorded, no points taken' },
  { kind: 'card', word: 'Card', hint: "From this event's card list" },
  { kind: 'deduction', word: 'Take off points', hint: 'An official deduction' },
  { kind: 'dq', word: 'Disqualify', hint: 'Removes the fighter' }
];

/**
 * The marshal's penalties, recorded by the operator from the marshal's call. Progressive: pick what, pick who, add detail only if wanted, record.
 * Cards come from the event's own list (nothing is invented). A deduction is an OFFICIAL act that stays on the record; fixing a scoring mistake is a different thing
 * (correct the round, or void a record with a reason in the Log).
 */
export function DisciplineSheet({ names, round, settings, calledByDefault, busy, onClose, onRecord }: {
  names: { a: string; b: string }; round: number; settings: LystSettings; calledByDefault: string; busy: boolean; onClose: () => void; onRecord: (d: DisciplineDraft) => void;
}) {
  const [kind, setKind] = useState<DisciplineKind | null>(null);
  const [side, setSide] = useState<'a' | 'b' | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [also, setAlso] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [calledBy, setCalledBy] = useState(calledByDefault);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const cards = settings.cards ?? [];
  const needsLabel = kind === 'card';
  const needsAmount = kind === 'deduction';
  const ready = kind !== null && side !== null && (!needsLabel || label !== null) && (!needsAmount || amount !== null) && !busy;
  const who = side ? names[side] : '…';
  return (
    <Dialog title={`Marshal's call · Round ${round}`} variant="drawer" onClose={onClose} busy={busy}>
      <div className="ly-sheet">
        <div className="ly-sheet-step"><b>1. What did the marshal call?</b>
          <div className="ly-grid2" role="group" aria-label="What was called">
            {KINDS.map(k => <button key={k.kind} type="button" className="ly-big" aria-pressed={kind === k.kind} onClick={() => { setKind(k.kind); setLabel(null); setAmount(null); setAlso(0); }}><b>{k.word}</b><span>{k.hint}</span></button>)}
          </div>
        </div>
        <div className="ly-sheet-step"><b>2. Against whom?</b>
          <div className="ly-grid2" role="group" aria-label="Against which fighter">
            {(['a', 'b'] as const).map(k => <button key={k} type="button" className={`ly-big ly-side-${k}`} aria-pressed={side === k} onClick={() => setSide(k)}><b>{names[k]}</b><span>Fighter {k.toUpperCase()}</span></button>)}
          </div>
        </div>
        {needsLabel && (
          <div className="ly-sheet-step"><b>Card</b>
            {cards.length === 0
              ? <p className="ly-note" role="status">No cards are set up for this event. The head marshal or an organizer adds them in Lyst settings.</p>
              : <div className="ly-chips" role="group" aria-label="Card type">{cards.map(c => <button key={c.key} type="button" className="ly-chip" aria-pressed={label === c.label} onClick={() => setLabel(c.label)}>{c.label}</button>)}</div>}
            {cards.length > 0 && settings.deduction_amounts.length > 0 && (
              <div className="ly-chips" role="group" aria-label="Also take off points"><span className="src">Also take off:</span>
                <button type="button" className="ly-chip" aria-pressed={also === 0} onClick={() => setAlso(0)}>No points</button>
                {settings.deduction_amounts.map(n => <button key={n} type="button" className="ly-chip" aria-pressed={also === n} onClick={() => setAlso(n)}>−{n}</button>)}
              </div>)}
          </div>
        )}
        {needsAmount && (
          <div className="ly-sheet-step"><b>Points to take off {side ? `from ${who}` : ''}</b>
            <div className="ly-chips" role="group" aria-label="Points to take off">{settings.deduction_amounts.map(n => <button key={n} type="button" className="ly-chip" aria-pressed={amount === n} onClick={() => setAmount(n)}>−{n}</button>)}</div>
            <p className="src">This is an official deduction: it lowers {side ? who + "'s" : 'the'} score for round {round} and stays on the record. To fix a scoring mistake, correct the round instead.</p>
          </div>
        )}
        {kind && (
          <div className="ly-sheet-step"><b>Reason (optional)</b>
            <div className="ly-chips" role="group" aria-label="Reason">{settings.reasons.map(r => <button key={r} type="button" className="ly-chip" aria-pressed={reason === r} onClick={() => setReason(reason === r ? null : r)}>{r}</button>)}</div>
            <label className="ly-reason"><span>Marshal who made the call (optional)</span><input value={calledBy} maxLength={60} onChange={e => setCalledBy(e.target.value)} /></label>
            <RulePicker value={ruleId} onChange={setRuleId} />
          </div>
        )}
        <button type="button" className="btn btn-win fq-big" disabled={!ready}
          onClick={() => kind && side && onRecord({ kind, side, label: needsLabel ? label : null, amount: needsAmount ? amount ?? 0 : 0, reason, calledBy: calledBy.trim() || null, alsoDeduct: kind === 'card' ? also : 0, ruleId })}>
          {busy ? 'Recording…' : kind && side ? `Record ${kind === 'card' ? (label ?? 'card') : kind === 'deduction' ? `−${amount ?? '?'} points` : kind === 'dq' ? 'disqualification' : 'warning'} · ${who}` : 'Choose what and who'}
        </button>
      </div>
    </Dialog>
  );
}
