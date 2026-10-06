import { useState } from 'react';
import { Dialog } from '../Dialog';
import type { LystState } from '../../data/lyst';
import { describeDiscipline } from '../../lib/lyst/rounds';
import { citationLabel, RulePicker } from '../rules/RulesSheet';
import { useRules } from '../../lib/rules/useRules';

/** The record: every confirmed round and correction, every card, warning, deduction and DQ, with who it was against. Voiding keeps the record and needs a reason. */
export function LogPanel({ state, names, busy, onVoid, onClose, citations, onCite }: {
  state: LystState; names: { a: string; b: string }; busy: boolean; onVoid: (id: string, reason: string) => void; onClose: () => void;
  /** Pack 22: the rule cited on each record (latest), and citing / changing it. */
  citations?: Map<string, string | null>; onCite?: (disciplineId: string, provisionId: string | null) => void;
}) {
  const [voiding, setVoiding] = useState<string | null>(null);
  const [citing, setCiting] = useState<string | null>(null);
  const { index } = useRules();
  const [reason, setReason] = useState('');
  return (
    <Dialog title="Record of this match" variant="drawer" onClose={onClose}>
      <div className="ly-log">
        <b>Rounds</b>
        {state.revisions.length === 0 ? <p className="src">Nothing confirmed yet.</p> : (
          <ul className="ly-list">
            {state.revisions.map((r, i) => (
              <li key={i} className="ly-log-row">
                <span><b>Round {r.round_no}</b> · {r.kind === 'correct' ? 'corrected' : 'confirmed'} {r.awarded_a}–{r.awarded_b}{r.kind === 'correct' && r.previous_a !== null ? ` (was ${r.previous_a}–${r.previous_b})` : ''}</span>
                {r.reason && <span className="src">{r.reason}</span>}
              </li>
            ))}
          </ul>
        )}
        <b>Cards, warnings and points taken off</b>
        {state.discipline.length === 0 ? <p className="src">None recorded.</p> : (
          <ul className="ly-list">
            {state.discipline.map(d => (
              <li key={d.id} className={`ly-log-row ${d.voided_at ? 'is-void' : ''}`}>
                <span>{describeDiscipline(d, names)}{d.voided_at ? ' · voided' : ''}</span>
                {(d.reason || d.called_by) && <span className="src">{[d.reason, d.called_by ? `called by ${d.called_by}` : null].filter(Boolean).join(' · ')}</span>}
                {d.voided_at && d.void_reason && <span className="src">Voided: {d.void_reason}</span>}
                {citationLabel(index, citations?.get(d.id)) && <span className="rl-cite">{citationLabel(index, citations?.get(d.id))}</span>}
                {!d.voided_at && onCite && (citing === d.id
                  ? <div className="rl-pick"><RulePicker startOpen value={citations?.get(d.id) ?? null} onChange={id => { onCite(d.id, id); setCiting(null); }} /><button type="button" className="lnk" onClick={() => setCiting(null)}>Done</button></div>
                  : index && index.entries.some(e => e.version.status === 'published') && <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => setCiting(d.id)}>{citations?.get(d.id) ? 'Change the rule' : 'Add the rule'}</button>)}
                {!d.voided_at && (voiding === d.id
                  ? (
                    <div className="ly-void">
                      <input aria-label="Why is this being voided?" placeholder="Why is this being voided?" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} />
                      <button type="button" className="btn btn-ink" disabled={busy || reason.trim().length < 3} onClick={() => { onVoid(d.id, reason.trim()); setVoiding(null); setReason(''); }}>Void it</button>
                      <button type="button" className="btn btn-line" onClick={() => { setVoiding(null); setReason(''); }}>Keep it</button>
                    </div>)
                  : <button type="button" className="btn btn-line btn-sm" onClick={() => setVoiding(d.id)}>Void with a reason</button>)}
              </li>
            ))}
          </ul>
        )}
        <p className="src">Nothing here is deleted. A voided record stays visible with its reason.</p>
      </div>
    </Dialog>
  );
}
