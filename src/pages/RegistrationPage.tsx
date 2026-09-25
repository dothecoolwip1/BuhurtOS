import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import {
  createRegistrationCheckout, listRegistrationDivisions, submitRegistration, uploadWaiver,
  withdrawRegistration, type RegistrationDivisionOption, type RegistrationResult
} from '../lib/registration';

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function RegistrationPage() {
  const { event } = useAppState();
  const [divisions, setDivisions] = useState<RegistrationDivisionOption[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [form, setForm] = useState({
    email: '', displayName: '', teamName: '', teamRosterText: '', phone: '', emergencyContact: '',
    ageYears: '', weightKg: '', experienceYears: '', waiverAcknowledged: false
  });
  const [declarations, setDeclarations] = useState<Record<string, boolean>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!event) return;
    setMessage('');
    listRegistrationDivisions(event.id).then(rows => {
      setDivisions(rows);
      setDivisionId(current => current && rows.some(row => row.id === current) ? current : (rows[0]?.id ?? ''));
    }).catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load registration divisions.'));
  }, [event?.id]);

  const selected = useMemo(() => divisions.find(row => row.id === divisionId), [divisions, divisionId]);
  const expectedTeamSize = Number(selected?.divisionSnapshot?.teamSize ?? selected?.teamSize ?? 1);
  const registrationKind = expectedTeamSize > 1 ? 'team' as const : 'individual' as const;
  const rules = Array.isArray(selected?.divisionSnapshot?.eligibilityRules) ? selected!.divisionSnapshot.eligibilityRules : [];
  const set = (key: keyof typeof form, value: string | boolean) => setForm(f => ({ ...f, [key]: value }));

  if (!event) return <main className="public-form-shell"><div className="state-card">Loading event…</div></main>;

  const windowClosed = event.registrationClosesAt ? Date.now() > new Date(event.registrationClosesAt).getTime() : false;
  const windowNotOpen = event.registrationOpensAt ? Date.now() < new Date(event.registrationOpensAt).getTime() : false;
  const unavailable = !event.registrationOpen || event.status === 'cancelled' || windowClosed || windowNotOpen || !selected;

  const submit = async () => {
    if (!selected) return;
    setBusy(true); setMessage('');
    try {
      const teamRoster = registrationKind === 'team'
        ? form.teamRosterText.split('\n').map(value => value.trim()).filter(Boolean)
        : [];
      const created = await submitRegistration({
        eventId: event.id,
        eventDivisionId: selected.id,
        registrationKind,
        email: form.email,
        displayName: form.displayName,
        teamName: form.teamName,
        teamRoster,
        ageYears: numberOrUndefined(form.ageYears),
        weightKg: numberOrUndefined(form.weightKg),
        experienceYears: numberOrUndefined(form.experienceYears),
        declarations,
        customValues,
        phone: form.phone,
        emergencyContact: form.emergencyContact,
        waiverAcknowledged: form.waiverAcknowledged
      }, selected);
      if (file) await uploadWaiver(created, file);
      setResult(created);
      setMessage(created.status === 'waitlisted' ? 'Registration saved to the waitlist.' : 'Registration saved for organizer review.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Registration failed.'); }
    finally { setBusy(false); }
  };

  const pay = async () => {
    if (!result) return;
    setBusy(true); setMessage('');
    try {
      const url = await createRegistrationCheckout(result);
      if (url === 'demo://checkout') setMessage('Demo mode: no real charge is made.');
      else if (url) window.location.assign(url);
      else setMessage('No payment is required for this registration.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to start payment.'); }
    finally { setBusy(false); }
  };

  const withdraw = async () => {
    if (!result) return;
    setBusy(true); setMessage('');
    try {
      await withdrawRegistration(result);
      setResult({ ...result, status: 'withdrawn' });
      setMessage('Registration withdrawn.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to withdraw registration.'); }
    finally { setBusy(false); }
  };

  return <main className="public-form-shell"><section className="registration-card">
    <span className="eyebrow">Event registration</span>
    <h1>{event.name}</h1>
    <p>{event.venue} · {new Date(event.startsAt).toLocaleString()}</p>
    {event.publicDescription && <p>{event.publicDescription}</p>}
    {event.registrationClosesAt && <div className="state-card">Registration closes {new Date(event.registrationClosesAt).toLocaleString()}.</div>}
    {event.status === 'cancelled' && <div className="validation-errors">This event has been cancelled.</div>}
    {!event.registrationOpen && event.status !== 'cancelled' && <div className="validation-errors">Registration is currently closed.</div>}
    {windowNotOpen && <div className="validation-errors">Registration has not opened yet.</div>}
    {windowClosed && <div className="validation-errors">The registration deadline has passed.</div>}

    {!result ? <div className="form-grid">
      <label className="full">Division<select value={divisionId} onChange={e => { setDivisionId(e.target.value); setDeclarations({}); setCustomValues({}); }}>
        {divisions.length === 0 && <option value="">No open divisions</option>}
        {divisions.map(row => <option key={row.id} value={row.id}>{row.name}{row.teamSize && row.teamSize > 1 ? ` · ${row.teamSize} person team` : ''}</option>)}
      </select></label>
      {selected?.registrationLimit && <div className="state-card full">Division capacity: {selected.registrationLimit} approved entries.</div>}
      <label>{registrationKind === 'team' ? 'Primary contact name' : 'Full name'}<input value={form.displayName} onChange={e => set('displayName', e.target.value)}/></label>
      <label>Email<input type="email" value={form.email} onChange={e => set('email', e.target.value)}/></label>
      {registrationKind === 'team' && <>
        <label className="full">Team name<input value={form.teamName} onChange={e => set('teamName', e.target.value)}/></label>
        <label className="full">Team roster <span className="hint">One fighter per line. This division requires exactly {expectedTeamSize}.</span>
          <textarea value={form.teamRosterText} onChange={e => set('teamRosterText', e.target.value)} rows={Math.max(4, expectedTeamSize)}/>
        </label>
      </>}
      {registrationKind === 'individual' && <>
        {(selected?.divisionSnapshot?.ageMin != null || selected?.divisionSnapshot?.ageMax != null) && <label>Age at event<input inputMode="numeric" value={form.ageYears} onChange={e => set('ageYears', e.target.value)}/></label>}
        {(selected?.divisionSnapshot?.minWeightKg != null || selected?.divisionSnapshot?.maxWeightKg != null) && <label>Weight (kg)<input inputMode="decimal" value={form.weightKg} onChange={e => set('weightKg', e.target.value)}/></label>}
        {(selected?.divisionSnapshot?.minExperienceYears != null || selected?.divisionSnapshot?.maxExperienceYears != null) && <label>Experience (years)<input inputMode="decimal" value={form.experienceYears} onChange={e => set('experienceYears', e.target.value)}/></label>}
      </>}
      {rules.map((rule: any, index: number) => rule.kind === 'declaration' && rule.key
        ? <label className="checkbox-line full" key={rule.key}><input type="checkbox" checked={Boolean(declarations[rule.key])} onChange={e => setDeclarations(current => ({ ...current, [rule.key]: e.target.checked }))}/><span>{rule.label ?? rule.key}</span></label>
        : rule.kind === 'custom' && rule.key
          ? <label className="full" key={rule.key}>{rule.label ?? rule.key}<input value={customValues[rule.key] ?? ''} onChange={e => setCustomValues(current => ({ ...current, [rule.key]: e.target.value }))}/></label>
          : <span key={index}/>)}
      <label>Phone<input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}/></label>
      <label>Emergency contact<input value={form.emergencyContact} onChange={e => set('emergencyContact', e.target.value)}/></label>
      <label className="full">Waiver file <span className="hint">PDF, JPG, or PNG up to 10 MB</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e => setFile(e.target.files?.[0] ?? null)}/></label>
      <label className="checkbox-line full"><input type="checkbox" checked={form.waiverAcknowledged} onChange={e => set('waiverAcknowledged', e.target.checked)}/><span>I confirm I have read and accept the event waiver.</span></label>
      <button className="primary big full" disabled={busy || unavailable || !form.displayName.trim() || !form.email.trim() || !form.waiverAcknowledged || (registrationKind === 'team' && !form.teamName.trim())} onClick={submit}>{busy ? 'Saving…' : 'Submit Registration'}</button>
    </div> : <div className="success-box">
      <h2>{result.status === 'waitlisted' ? 'Waitlist entry received' : result.status === 'withdrawn' ? 'Registration withdrawn' : 'Registration received'}</h2>
      <p>Your registration ID is <code>{result.registrationId}</code>.</p>
      <p>Status: <b>{result.status.replaceAll('_',' ')}</b> · Eligibility: <b>{result.eligibilityStatus.replaceAll('_',' ')}</b></p>
      {result.eligibilityReasons.length > 0 && <div className="validation-errors">{result.eligibilityReasons.map(reason => <div key={reason}>{reason}</div>)}</div>}
      {result.paymentRequired && result.status !== 'withdrawn' ? <><p>Registration fee: {(result.amountCents / 100).toLocaleString(undefined,{style:'currency',currency:result.currency})}</p><button className="primary big" onClick={pay} disabled={busy}>Continue to Payment</button></> : result.status !== 'withdrawn' && <p>No payment is required.</p>}
      {result.status !== 'withdrawn' && result.status !== 'rejected' && <button onClick={withdraw} disabled={busy}>Withdraw Registration</button>}
    </div>}
    {message && <div className="auth-message">{message}</div>}
  </section></main>;
}
