import { useState } from 'react';
import {
  ALLERGIES_MAX, BLOOD_TYPES, MEDICAL_NOTE_MAX, deleteMyPrivateData, fetchMyPrivateProfile, privateToForm, saveMyPrivateProfile, validatePrivateForm, type PrivateForm
} from '../../data/account';
import { Dialog } from '../../components/Dialog';
import { PRIVATE_COPY } from '../../lib/accountView';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import { Counter, Err, Notice } from './shared';

export function MedicalTab() {
  const saved = useAsync(fetchMyPrivateProfile, []);
  if (saved.loading) return <p className="muted">Loading…</p>;
  if (saved.error != null) return <p role="alert">{friendlyError(saved.error, 'Could not load your saved details.')}</p>;
  return <MedicalForm initial={privateToForm(saved.data ?? null)} hasSaved={saved.data != null} />;
}

function MedicalForm({ initial, hasSaved }: { initial: PrivateForm; hasSaved: boolean }) {
  const [f, setF] = useState<PrivateForm>(initial);
  const [stored, setStored] = useState(hasSaved);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const errors = validatePrivateForm(f);
  const set = <K extends keyof PrivateForm>(k: K, v: PrivateForm[K]) => { setF(x => ({ ...x, [k]: v })); setMsg(null); };
  const shown = (k: string) => (show ? errors[k] : undefined);
  const text = (label: string, k: keyof PrivateForm, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field-in">{label}<input value={f[k] as string} onChange={e => set(k, e.target.value as never)} aria-invalid={!!shown(k)} {...extra} /><Err m={shown(k)} /></label>
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setShow(true);
    if (Object.keys(errors).length) { setMsg({ kind: 'bad', text: `Please fix the ${Object.keys(errors).length} highlighted item(s).` }); return; }
    setBusy(true); setMsg(null);
    try { await saveMyPrivateProfile(f); setStored(true); setMsg({ kind: 'ok', text: 'Saved. These details will fill in your next registration.' }); }
    catch (err) { setMsg({ kind: 'bad', text: friendlyError(err, 'Could not save your details.') }); }
    finally { setBusy(false); }
  };
  const wipe = async () => {
    setBusy(true); setMsg(null);
    try {
      await deleteMyPrivateData();
      setF(privateToForm(null)); setStored(false); setConfirm(false); setShow(false);
      setMsg({ kind: 'ok', text: 'Deleted. Nothing is saved on your account any more.' });
    } catch (err) { setConfirm(false); setMsg({ kind: 'bad', text: friendlyError(err, 'Could not delete your details.') }); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} noValidate className="acct-stack">
      <section className="acct-privacy" role="note"><b>{PRIVATE_COPY.headline}</b> {PRIVATE_COPY.body.slice(PRIVATE_COPY.headline.length + 1)}</section>

      <section className="panel info acct-card">
        <h2>About you</h2>
        {text('Full legal name', 'fullName', { autoComplete: 'name' })}
        {text('Your phone', 'phone', { type: 'tel', autoComplete: 'tel', inputMode: 'tel' })}
      </section>

      <section className="panel info acct-card">
        <h2>Emergency contact</h2>
        {text('Name', 'emergencyName')}
        {text('Relationship to you', 'emergencyRelationship', { placeholder: 'for example partner, parent' })}
        {text('Phone', 'emergencyPhone', { type: 'tel', inputMode: 'tel' })}
      </section>

      <section className="panel info acct-card">
        <h2>Health</h2>
        <label className="acct-switch"><input type="checkbox" checked={f.medicallyFitDeclared} onChange={e => set('medicallyFitDeclared', e.target.checked)} />
          <span><b>I am medically fit to take part</b><br /><span className="muted">You confirm this again on each registration.</span></span></label>
        <label className="field-in">Medical note (optional)
          <textarea rows={4} value={f.medicalNote} onChange={e => set('medicalNote', e.target.value)} aria-invalid={!!shown('medicalNote')} />
          <Counter value={f.medicalNote} max={MEDICAL_NOTE_MAX} /><Err m={shown('medicalNote')} />
        </label>
        <label className="field-in">Allergies (optional)
          <textarea rows={2} value={f.allergies} onChange={e => set('allergies', e.target.value)} aria-invalid={!!shown('allergies')} />
          <Counter value={f.allergies} max={ALLERGIES_MAX} /><Err m={shown('allergies')} />
        </label>
        <label className="field-in">Blood type (optional)
          <select value={f.bloodType} onChange={e => set('bloodType', e.target.value as PrivateForm['bloodType'])}>
            <option value="">Not set</option>{BLOOD_TYPES.map(b => <option key={b} value={b}>{b === 'unknown' ? 'I do not know' : b}</option>)}
          </select><Err m={shown('bloodType')} />
        </label>
      </section>

      <div className="acct-savebar">
        <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save my details'}</button>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </div>

      <section className="panel info acct-card">
        <h2>Delete</h2>
        <p className="muted">{stored ? 'You have details saved on your account.' : 'Nothing is saved on your account right now.'}</p>
        <button type="button" className="btn btn-line acct-danger" disabled={busy || !stored} onClick={() => setConfirm(true)}>{PRIVATE_COPY.deleteLabel}</button>
      </section>

      {confirm && (
        <Dialog title="Delete your saved details?" onClose={() => setConfirm(false)} busy={busy}>
          <p>{PRIVATE_COPY.deleteConfirm}</p>
          <div className="acct-row">
            <button type="button" className="btn btn-ink" data-autofocus disabled={busy} onClick={() => void wipe()}>{busy ? 'Deleting…' : 'Yes, delete it'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirm(false)}>Keep it</button>
          </div>
        </Dialog>
      )}
    </form>
  );
}
