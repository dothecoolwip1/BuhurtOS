import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chip } from '../components/ui';
import { VenuePicker, type VenueFields } from '../components/VenuePicker';
import { EVENT_TYPES, REGISTRATION_MODES, type EventType, type RegistrationMode } from '../data/eventTypes';
import type { LiveEvent } from '../data/api';
import { fetchPublishFacts, setEventStatus, updateEvent } from '../data/setup';
import { isoToLocal } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { PROVINCES } from '../registration/model';
import { publishChecklist, toPatch, validateSetup, type SetupForm } from '../registration/setup';
import { CompetitionsSection } from './CompetitionsSection';
import { WaiverSection } from './WaiverSection';

const fromEvent = (e: LiveEvent): SetupForm => ({
  name: e.name, description: e.description, venue: e.venue ?? '', address: e.address ?? '', city: e.city ?? '', region: e.region ?? '', country: e.country ?? '', latitude: e.latitude, longitude: e.longitude,
  startsOn: e.startsOn, endsOn: e.endsOn, opensLocal: isoToLocal(e.registrationOpensAt), closesLocal: isoToLocal(e.registrationClosesAt),
  feeDollars: e.feeCents ? String(e.feeCents / 100) : '', feeProvince: e.feeCents ? (e.feeProvince ?? 'ALL') : '', feeNote: e.feeNote ?? '',
  eventType: e.eventType as EventType, registrationMode: e.registrationMode, externalUrl: e.externalUrl ?? '', timeNote: e.timeNote ?? '', volunteerInfo: e.volunteerInfo ?? ''
});

/** Where each blocking requirement is satisfied, so the checklist can point straight at it. */
const FIX_TARGET: Array<{ test: (label: string) => boolean; id: string; action: string }> = [
  { test: l => l.startsWith('At least one competition'), id: 'competitions', action: '+ Add competition' },
  { test: l => l.startsWith('A waiver'), id: 'waiver', action: 'Add the waiver' },
  { test: l => l.startsWith('The sign-up'), id: 'details', action: 'Set the link' },
  { test: l => l.startsWith('A venue'), id: 'details', action: 'Add the venue' }
];

export function SetupTab({ event, onChanged }: { event: LiveEvent; onChanged: () => void }) {
  const [params] = useSearchParams();
  const [f, setF] = useState<SetupForm>(() => fromEvent(event));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [factsKey, setFactsKey] = useState(0);
  const [openCompetition, setOpenCompetition] = useState(params.get('add') === 'competition');
  const facts = useAsync(() => fetchPublishFacts(event.id), [event.id, factsKey]);
  const errors = validateSetup(f);
  const set = <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: string) => (show && errors[k] ? <span role="alert" style={{ color: 'var(--live)' }}>{errors[k]}</span> : null);

  // ?focus=competitions (from the Run tab or the event page) lands on that section.
  useEffect(() => {
    const id = params.get('focus') ?? (params.get('add') === 'competition' ? 'competitions' : null);
    if (!id) return;
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => window.clearTimeout(t);
  }, [params]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); onChanged(); } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); setConfirm(false); }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setShow(true);
    if (Object.keys(errors).length) return;
    void run(() => updateEvent(event.id, toPatch(f)), 'Saved.');
  };
  const refresh = () => { setFactsKey(k => k + 1); onChanged(); };

  const checks = publishChecklist({ eventType: event.eventType as EventType, registrationMode: event.registrationMode, competitions: facts.data?.competitions ?? 0, waivers: facts.data?.waivers ?? 0, hasClose: Boolean(event.registrationClosesAt), hasVenue: Boolean(event.venue || event.address), hasLink: Boolean(event.externalUrl) });
  const blocked = checks.some(c => c.blocking && !c.ok) || !facts.data;
  const published = event.status === 'published';
  const fixFor = (label: string) => FIX_TARGET.find(t => t.test(label));
  const jump = (id: string) => {
    if (id === 'competitions') setOpenCompetition(true);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const text = (k: keyof SetupForm, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field-in">{label}<input value={f[k] as string} onChange={e => set(k, e.target.value as never)} aria-invalid={Boolean(show && errors[k])} {...extra} />{err(k)}</label>
  );
  const venue: VenueFields = { venue: f.venue, address: f.address, city: f.city, region: f.region, country: f.country, latitude: f.latitude, longitude: f.longitude };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="panel info" aria-labelledby="pub-h" style={{ display: 'grid', gap: 10 }}>
        <h3 id="pub-h">{published ? 'This event is public' : 'This event is a draft'}</h3>
        <p><Chip tone={published ? 'win' : 'brass'}>{published ? 'Published' : 'Draft: only organizers can see it'}</Chip></p>
        <ul className="plain checklist" aria-label="Publish checklist">
          {checks.map(c => {
            const fix = !c.ok ? fixFor(c.label) : null;
            return (
              <li key={c.label} className="checkrow">
                <span>{c.ok ? '✓' : c.blocking ? '✗' : '!'} {c.label}{!c.ok && !c.blocking ? ' (recommended)' : ''}</span>
                {fix && <button type="button" className={`btn btn-sm ${c.blocking ? 'btn-ink' : 'btn-line'}`} data-testid={`fix-${fix.id}`} onClick={() => jump(fix.id)}>{fix.action}</button>}
              </li>
            );
          })}
        </ul>
        {!published && !confirm && <button type="button" className="btn btn-ink" disabled={busy || blocked} onClick={() => setConfirm(true)}>Publish event</button>}
        {!published && facts.data && blocked && (
          <p role="status" style={{ color: 'var(--live)' }}>
            Publish is off until: {checks.filter(c => c.blocking && !c.ok).map(c => c.label.replace(/ \(.*\)$/, '').toLowerCase()).join('; ')}. Use the buttons beside each item.
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
        {msg && !confirm && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--win)' : 'var(--live)' }}>{msg.text}</p>}
      </section>

      <CompetitionsSection key={`${event.id}-${openCompetition}`} eventId={event.id} eventType={event.eventType} onChanged={refresh} autoOpen={openCompetition} />

      {event.registrationMode === 'buhuros' && <WaiverSection eventId={event.id} onAdded={refresh} />}

      <form onSubmit={save} noValidate className="panel info" id="details" style={{ display: 'grid', gap: 14, scrollMarginTop: 96 }}>
        <h3>Event details</h3>
        <label className="field-in">What kind of event is it
          <select value={f.eventType} onChange={e => set('eventType', e.target.value as EventType)}>{EVENT_TYPES.map(([k, n, d]) => <option key={k} value={k}>{n}: {d}</option>)}</select>
        </label>
        {text('name', 'Name')}
        <label className="field-in">Description (optional)<textarea rows={4} maxLength={4000} value={f.description} onChange={e => set('description', e.target.value)} />{err('description')}</label>
        {text('startsOn', 'First day', { type: 'date' })}
        {text('endsOn', 'Last day', { type: 'date' })}
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Where</legend>
          <VenuePicker value={venue} onChange={v => setF(p => ({ ...p, ...v }))} />
        </fieldset>
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
