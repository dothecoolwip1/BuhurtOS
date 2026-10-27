import { useState } from 'react';
import { Dialog } from '../Dialog';

export function CounterRoundConfirmation({ round, total, standing, maximum = 1000, fighter, busy, message, onConfirm, onClose }: {
  round: number; total: number; standing: boolean; maximum?: number; fighter: string; busy: boolean; message: string | null;
  onConfirm: (total: number) => void; onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(total));
  const value = /^\d+$/.test(draft) ? Number(draft) : NaN;
  const valid = Number.isInteger(value) && value >= 0 && value <= maximum;
  return (
    <Dialog title={`Round ${round} · confirm score`} onClose={onClose} busy={busy}>
      <p className="src">{fighter}{standing ? ' · fighters standing' : ' · your count'}</p>
      {editing ? <label className="field-in">{standing ? 'Fighters standing' : 'Your score'}<input autoFocus type="text" inputMode="numeric" pattern="[0-9]*" value={draft} disabled={busy} aria-invalid={!valid} onChange={e=>setDraft(e.target.value)} /></label>
        : <output className="cp-confirm-total" aria-label={`${standing ? 'Standing' : 'Your count'} ${total}`}>{total}</output>}
      {editing && !valid && <p role="alert">Enter a whole number from 0 to {maximum}.</p>}
      <p className="src">Confirm your count. The marshal confirms the official score.</p>
      {editing && value !== total && <p className="src">Your original taps stay saved. This correction goes to the marshal for review.</p>}
      {message && <p className="ly-note" role="alert">{message}</p>}
      <div className="dlg-actions">
        <button type="button" className="btn btn-line" disabled={busy} onClick={()=>editing ? onClose() : setEditing(true)}>{editing ? 'Cancel' : 'Edit score'}</button>
        <button type="button" className="btn btn-win" disabled={busy || !valid} onClick={()=>onConfirm(value)}>{busy ? 'Confirming…' : 'Confirm score'}</button>
      </div>
    </Dialog>
  );
}
