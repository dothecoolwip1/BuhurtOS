import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip } from '../components/ui';
import { EVENT_TYPES, REGISTRATION_MODES, type EventType, type RegistrationMode } from '../data/eventTypes';
import type { LiveEvent } from '../data/api';
import { addWaiverVersion, fetchLatestWaiver, fetchPublishFacts, setEventStatus, updateEvent } from '../data/setup';
import { isoToLocal } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { PROVINCES } from '../registration/model';
import { publishChecklist, toPatch, validateSetup, type SetupForm } from '../registration/setup';

const fromEvent = (e: LiveEvent): SetupForm => ({
  name: e.name, description: e.description, venue: e.venue ?? '', address: e.address ?? '', city: e.city ?? '', region: e.region ?? '',
  startsOn: e.startsOn, endsOn: e.endsOn, opensLocal: isoToLocal(e.registrationOpensAt), closesLocal: isoToLocal(e.registrationClosesAt),
  feeDollars: e.feeCents ? String(e.feeCents / 100) : '', feeProvince: e.feeCents ? (e.feeProvince ?? 'ALL') : '', feeNote: e.feeNote ?? '',
  eventType: e.eventType as EventType, registrationMode: e.registrationMode, externalUrl: e.externalUrl ?? '', timeNote: e.timeNote ?? '', volunteerInfo: e.volunteerInfo ?? ''
});

export function SetupTab({ event, onChanged }: { event: LiveEvent; onChanged: () => void }) {
  const [f, setF] = useState<SetupForm>(() => fromEvent(event));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [factsKey, setFactsKey] = useState(0);
  const facts = useAsync(() => fetchPublishFacts(event.id), [event.id, factsKey]);
  const errors = validateSetup(f);
  const set = <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: string) => (show && errors[k] ? <span role="alert" style={{ color: 'var(--live)' }}>{errors[k]}</span> : null);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); onChanged(); } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); setConfirm(false); }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setShow(true);
    if (Object.keys(errors).length) return;
    void run(() => updateEvent(event.id, toPatch(f)), 'Saved.');
  };

  const checks = publishChecklist({ eventType: event.eventType as EventType, registrationMode: event.registrationMode, competitions: facts.data?.competitions ?? 0, waivers: facts.data?.waivers ?? 0, hasClose: Boolean(event.registrationClosesAt), hasVenue: Boolean(event.venue || event.address), hasLink: Boolean(event.externalUrl) });
  const blocked = checks.some(c => c.blocking && !c.ok) || !facts.data;
  const published = event.status === 'published';

  const text = (k: keyof SetupForm, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field-in">{label}<input value={f[k]} onChange={e => set(k, e.target.value)} aria-invalid={Boolean(show && errors[k])} {...extra} />{err(k)}</label>
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="panel info" aria-labelledby="pub-h" style={{ display: 'grid', gap: 10 }}>
        <h3 id="pub-h">{published ? 'This event is public' : 'This event is a draft'}</h3>
        <p><Chip tone={published ? 'win' : 'brass'}>{published ? 'Published' : 'Draft: only organizers can see it'}</Chip></p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
          {checks.map(c => (
            <li key={c.label} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{c.ok ? '✓' : c.blocking ? '✗' : '!'} {c.ok || c.key !== 'competitions' ? c.label : 'No competitions yet'}{!c.ok && !c.blocking ? ' (recommended)' : ''}</span>
              {!c.ok && c.key === 'competitions' && <Link className="btn btn-ink btn-sm" to={`/events/${event.slug}/manage?tab=competitions`}>+ Add competition</Link>}
            </li>
          ))}
        </ul>
        {!published && !confirm && <button type="button" className="btn btn-ink" disabled={busy || blocked} onClick={() => setConfirm(true)}>Publish event</button>}
        {!published && facts.data && blocked && (
          <p role="status" style={{ color: 'var(--live)' }}>
            Publish is off until: {checks.filter(c => c.blocking && !c.ok).map(c => (c.key === 'competitions' ? 'a competition is added' : c.label.replace(/ \(.*\)$/, '').toLowerCase())).join('; ')}.
            {checks.some(c => c.blocking && !c.ok && c.key === 'waiver') && <> Add the waiver below.</>}
            {checks.some(c => c.blocking && !c.ok && c.key === 'competitions') && <> Use the Competitions tab (button above).</>}
          </p>
        )}
        {!published && confirm && (
          <div className="panel info" role="alertdialog" aria-label="Confirm publish" style={{ display: 'grid', gap: 8 }}>
            <p><b>Publishing makes the event, its competitions and registration public.</b> Anyone can then register. You can take it back to draft, but people who registered keep their registration.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ink" disabled={busy} onClick={() => run(() => setEventStatus(event.id, 'published'), 'Published.')}>Yes, publish</button>
              <button type="button" className="btn btn-line" onClick={() => setConfirm(false)}>Not yet</button>
            </div>
          </div>
        )}
        {published && !confirm && <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirm(true)}>Take back to draft</button>}
        {published && confirm && (
          <div className="panel info" role="alertdialog" aria-label="Confirm unpublish" style={{ display: 'grid', gap: 8 }}>
            <p><b>The event will disappear from the public pages and registration will stop.</b> Existing registrations are kept.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ink" disabled={busy} onClick={() => run(() => setEventStatus(event.id, 'draft'), 'Back to draft.')}>Yes, take it down</button>
              <button type="button" className="btn btn-line" onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {event.registrationMode === 'buhuros' && <WaiverSection eventId={event.id} onAdded={() => setFactsKey(k => k + 1)} />}

      <form onSubmit={save} noValidate className="panel info" style={{ display: 'grid', gap: 14 }}>
        <h3>Event details</h3>
        <label className="field-in">What kind of event is it
          <select value={f.eventType} onChange={e => set('eventType', e.target.value as EventType)}>{EVENT_TYPES.map(([k, n, d]) => <option key={k} value={k}>{n}: {d}</option>)}</select>
        </label>
        {text('name', 'Name')}
        <label className="field-in">Description (optional)<textarea rows={4} maxLength={4000} value={f.description} onChange={e => set('description', e.target.value)} />{err('description')}</label>
        {text('startsOn', 'First day', { type: 'date' })}
        {text('endsOn', 'Last day', { type: 'date' })}
        {text('venue', 'Venue')}
        {text('address', 'Address')}
        {text('city', 'City')}
        {text('region', 'Province or state')}
        {text('timeNote', 'Times to show (for example "Doors 6 pm, karaoke 9:30 pm")')}
        <label className="field-in">How do people sign up
          <select value={f.registrationMode} onChange={e => set('registrationMode', e.target.value as RegistrationMode)}>{REGISTRATION_MODES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
        {f.registrationMode === 'external' && text('externalUrl', 'Link to sign up or buy tickets (https://…)', { type: 'url', inputMode: 'url' })}
        {f.registrationMode === 'buhuros' && (<>
          {text('opensLocal', 'Registration opens (Mountain time, optional)', { type: 'datetime-local' })}
          {text('closesLocal', 'Registration closes (Mountain time)', { type: 'datetime-local' })}
        </>)}
        <label className="field-in">{f.registrationMode === 'buhuros' ? 'Entry fee in dollars (0 or empty for none)' : 'Price to show, in dollars (optional, for example the lowest ticket price)'}<input inputMode="decimal" value={f.feeDollars} onChange={e => set('feeDollars', e.target.value)} aria-invalid={Boolean(show && errors.feeDollars)} />{err('feeDollars')}</label>
        {f.registrationMode === 'buhuros' && (
          <label className="field-in">Who pays the fee
            <select value={f.feeProvince} onChange={e => set('feeProvince', e.target.value)}>
              <option value="">Choose…</option><option value="ALL">Everyone (volunteers never pay)</option>
              {PROVINCES.map(([k, n]) => <option key={k} value={k}>Only people from {n}</option>)}
            </select>{err('feeProvince')}
          </label>
        )}
        {f.registrationMode === 'buhuros' && <label className="field-in">Volunteer information (shown to volunteers; for example where to find the separate volunteer safety, liability and tracking form)<textarea rows={4} maxLength={2000} value={f.volunteerInfo} onChange={e => set('volunteerInfo', e.target.value)} />{err('volunteerInfo')}</label>}
        {text('feeNote', 'Note about payment (for example how to pay)')}
        <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--win)' : 'var(--live)' }}>{msg.text}</p>}
      </form>
    </div>
  );
}

/** The waiver people accept when they register. A change is a new version; older signatures stay tied to the version they signed. */
function WaiverSection({ eventId, onAdded }: { eventId: string; onAdded: () => void }) {
  const [key, setKey] = useState(0);
  const latest = useAsync(() => fetchLatestWaiver(eventId), [eventId, key]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const w = latest.data;
  const start = () => { setTitle(w?.title ?? 'Waiver and release'); setBody(w?.body ?? ''); setProblem(null); setOpen(true); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setProblem(null);
    try { await addWaiverVersion(eventId, title, body, w?.version ?? 0); setOpen(false); setKey(k => k + 1); onAdded(); }
    catch (x) { setProblem(x instanceof Error && !('code' in x) ? x.message : friendlyError(x)); } finally { setBusy(false); }
  };
  return (
    <section className="panel info" aria-labelledby="waiver-h" style={{ display: 'grid', gap: 10 }}>
      <h3 id="waiver-h">Waiver</h3>
      {latest.loading && !w && <p className="muted">Loading…</p>}
      {latest.error != null && <p role="alert" style={{ color: 'var(--live)' }}>{friendlyError(latest.error, 'Could not load the waiver.')}</p>}
      {!latest.loading && !w && !open && <p>No waiver yet. Everyone who registers must accept one, so the event cannot be published without it. Paste the text your event uses.</p>}
      {w && !open && (
        <>
          <p><b>{w.title}</b> <span className="src">· version {w.version}</span></p>
          <details><summary>Read the text</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>{w.body}</p></details>
        </>
      )}
      {!open && <div><button type="button" className="btn btn-line" onClick={start}>{w ? 'Change the waiver (new version)' : 'Add the waiver'}</button></div>}
      {open && (
        <form onSubmit={e => void save(e)} style={{ display: 'grid', gap: 10 }}>
          <label className="field-in">Title<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} /></label>
          <label className="field-in">Full text people agree to
            <textarea rows={10} value={body} onChange={e => setBody(e.target.value)} />
            <span>BuhurtOS does not write or check waiver wording. Use the text your organization or insurer gives you.</span>
          </label>
          {w && <p className="src">Saving makes this version {w.version + 1}. People who already registered keep the version they signed; new registrations accept this one.</p>}
          {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Saving…' : 'Save waiver'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
