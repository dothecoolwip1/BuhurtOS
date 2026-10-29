import { useState } from 'react';
import { Dialog } from '../Dialog';
import { OutranceSheetDialog } from './OutranceSheetDialog';
import { MARKS, emptyTally, type Tally } from '../../lib/lyst/lineMarshal';
import type { CriteriaCalls } from '../../lib/outrance';
import type { EventSides } from '../../lib/lyst/counters';
import type { OutranceSheet } from '../../data/lyst';

const ROW: Record<(typeof MARKS)[number], string> = { strike: 'Effective strikes', takedown: 'Effective takedowns', weapon_loss: 'Loss of weapon', armour_failure: 'Armour failures' };
const fromSheet = (s: OutranceSheet): Tally => ({ strike: { ...s.strikes }, takedown: { ...s.takedowns }, weapon_loss: { ...s.weapon_losses }, armour_failure: { ...s.armour_failures } });
const asCount = (v: string) => (/^\d{1,3}$/.test(v) ? Number(v) : null);

/**
 * A line marshal without a phone keeps the p.25 paper sheet; the secretary types it in here (owner decision 2026-10-29: phones are not
 * mandatory). Step 1 is the marshal's name and totals; step 2 is the same criteria questions the phone asks, in priority order (§15.2).
 * Fixing a typed sheet replaces it with a reason; the old one is kept.
 */
export function PaperSheetDialog({ round, names, sides, fixing, knownNames, busy, message, onSave, onRemove, onClose }: {
  round: number; names: { a: string; b: string }; sides: EventSides; fixing: OutranceSheet | null; knownNames: string[]; busy: boolean; message: string | null;
  onSave: (v: { marshal: string; tally: Tally; calls: CriteriaCalls; reason: string | null }) => void; onRemove: (reason: string) => void; onClose: () => void;
}) {
  const [marshal, setMarshal] = useState(fixing?.operator ?? '');
  const [text, setText] = useState<Record<string, string>>(() => {
    const t = fixing ? fromSheet(fixing) : emptyTally();
    return Object.fromEntries(MARKS.flatMap(m => (['a', 'b'] as const).map(k => [`${m}.${k}`, fixing ? String(t[m][k]) : ''])));
  });
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'totals' | 'criteria'>('totals');
  const counts = MARKS.flatMap(m => (['a', 'b'] as const).map(k => asCount(text[`${m}.${k}`] === '' ? '0' : text[`${m}.${k}`])));
  const valid = counts.every(c => c !== null);
  const tally: Tally = emptyTally();
  MARKS.forEach(m => (['a', 'b'] as const).forEach(k => { tally[m][k] = asCount(text[`${m}.${k}`] || '0') ?? 0; }));
  const nameOk = marshal.trim().length >= 2 && marshal.trim().length <= 60;
  const reasonOk = !fixing || reason.trim().length >= 3;
  const ready = valid && nameOk && reasonOk;

  if (step === 'criteria') {
    return (
      <OutranceSheetDialog round={round} tally={tally} names={names} sides={sides} busy={busy} message={message} title={`Round ${round} · ${marshal.trim()}'s paper sheet`}
        aria={`${marshal.trim()}'s round ${round} paper sheet`} backLabel="Back to the totals" submitLabel={fixing ? 'Save the corrected sheet' : 'Add the sheet'}
        onClose={() => setStep('totals')} onSubmit={calls => onSave({ marshal: marshal.trim(), tally, calls, reason: fixing ? reason.trim() : null })} />
    );
  }
  return (
    <Dialog title={fixing ? `Fix ${fixing.operator ?? 'the'} paper sheet · round ${round}` : `Round ${round} · type in a paper sheet`} onClose={onClose} busy={busy} dismissOnBackdrop={false}>
      <p className="src">For a line marshal scoring on paper. Copy the totals from their sheet; it counts the same as a phone's.</p>
      <label className="ly-reason"><span>Line marshal</span>
        <input value={marshal} maxLength={60} list="om-paper-names" autoComplete="off" onChange={e => setMarshal(e.target.value)} placeholder="Name on the sheet" data-testid="om-paper-name" disabled={!!fixing} />
      </label>
      <datalist id="om-paper-names">{knownNames.map(n => <option key={n} value={n} />)}</datalist>
      <table className="om-sheet om-paper" aria-label="Paper sheet totals">
        <thead><tr><th scope="col"></th><th scope="col" className="om-a">{sides.a.name}</th><th scope="col" className="om-b">{sides.b.name}</th></tr></thead>
        <tbody>
          {MARKS.map(m => (
            <tr key={m}>
              <th scope="row">{ROW[m]}</th>
              {(['a', 'b'] as const).map(k => (
                <td key={k}>
                  <input className="mono om-paper-n" inputMode="numeric" pattern="[0-9]*" maxLength={3} placeholder="0" value={text[`${m}.${k}`]}
                    aria-label={`${ROW[m]}, ${sides[k].name} ${names[k]}`} data-testid={`om-paper-${m}-${k}`}
                    onChange={e => setText(v => ({ ...v, [`${m}.${k}`]: e.target.value.replace(/\D/g, '') }))} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {fixing && <label className="ly-reason"><span>Why it is being fixed</span><input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="For example: Red and Blue swapped" data-testid="om-paper-reason" /></label>}
      {message && <p className="ly-note" role="alert">{message}</p>}
      <div className="dlg-actions">
        <button type="button" className="btn btn-line" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-win" disabled={busy || !ready} onClick={() => setStep('criteria')} data-testid="om-paper-next">Next: check the sheet</button>
      </div>
      {fixing && (
        <button type="button" className="ly-link" disabled={busy || reason.trim().length < 3} onClick={() => onRemove(reason.trim())} data-testid="om-paper-remove">
          Remove this sheet instead{reason.trim().length < 3 ? ' (write the reason first)' : ''}
        </button>
      )}
    </Dialog>
  );
}
