import { useState } from 'react';
import { useAppState } from '../features/AppState';
import { createRegistrationCheckout, submitRegistration, uploadWaiver, type RegistrationResult } from '../lib/registration';
import { competitionFormats } from '../lib/competitionFormats';

export function RegistrationPage() {
  const { event } = useAppState();
  const [form, setForm] = useState({ email: '', displayName: '', teamName: '', category: competitionFormats[0].name, phone: '', emergencyContact: '', waiverAcknowledged: false });
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (!event) return <main className="public-form-shell"><div className="state-card">Loading event…</div></main>;
  const set = (key: keyof typeof form, value: string | boolean) => setForm(f => ({ ...f, [key]: value }));
  const submit = async () => {
    setBusy(true); setMessage('');
    try {
      const created = await submitRegistration({ eventId: event.id, ...form });
      if (file) await uploadWaiver(created, file);
      setResult(created);
      setMessage('Registration saved.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Registration failed.'); }
    finally { setBusy(false); }
  };
  const pay = async () => {
    if (!result) return;
    setBusy(true); setMessage('');
    try {
      const url = await createRegistrationCheckout(result);
      if (url === 'demo://checkout') setMessage('Demo mode: payment checkout is configured but no real charge is made.');
      else if (url) window.location.assign(url);
      else setMessage('No payment is required for this registration.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to start payment.'); }
    finally { setBusy(false); }
  };
  return <main className="public-form-shell"><section className="registration-card"><span className="eyebrow">Event registration</span><h1>{event.name}</h1><p>{event.venue}</p>{!event.registrationOpen && <div className="validation-errors">Registration is currently closed.</div>}{!result ? <div className="form-grid"><label>Full name<input value={form.displayName} onChange={e => set('displayName', e.target.value)}/></label><label>Email<input type="email" value={form.email} onChange={e => set('email', e.target.value)}/></label><label>Team<input value={form.teamName} onChange={e => set('teamName', e.target.value)}/></label><label>Category<select value={form.category} onChange={e => set('category', e.target.value)}>{competitionFormats.map(format => <option key={format.id} value={format.name}>{format.name}</option>)}</select></label><label>Phone<input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}/></label><label>Emergency contact<input value={form.emergencyContact} onChange={e => set('emergencyContact', e.target.value)}/></label><label className="full">Waiver file <span className="hint">PDF, JPG, or PNG up to 10 MB</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e => setFile(e.target.files?.[0] ?? null)}/></label><label className="checkbox-line full"><input type="checkbox" checked={form.waiverAcknowledged} onChange={e => set('waiverAcknowledged', e.target.checked)}/><span>I confirm I have read and accept the event waiver.</span></label><button className="primary big full" disabled={busy || !event.registrationOpen || !form.displayName || !form.email || !form.waiverAcknowledged} onClick={submit}>{busy ? 'Saving…' : 'Submit Registration'}</button></div> : <div className="success-box"><h2>Registration received</h2><p>Your registration ID is <code>{result.registrationId}</code>.</p>{result.paymentRequired ? <><p>Registration fee: {(result.amountCents / 100).toLocaleString(undefined,{style:'currency',currency:result.currency})}</p><button className="primary big" onClick={pay} disabled={busy}>Continue to Payment</button></> : <p>No payment is required.</p>}</div>}{message && <div className="auth-message">{message}</div>}</section></main>;
}
