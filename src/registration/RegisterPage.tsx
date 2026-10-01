import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { PageHead, Seg } from '../components/ui';
import {
  INSURANCE_OPTIONS, PROVINCES, VOLUNTEER_ROLES, buildPayload, emptyForm, feeFor, formatMoney, validate,
  type CompetitionOption, type EventFee, type LeagueKey, type RegForm
} from './model';

interface Loaded {
  eventId: string; name: string; fee: EventFee; closesAt: string | null; mode: 'buhuros' | 'external' | 'none'; externalUrl: string | null;
  comps: CompetitionOption[]; teams: { id: string; name: string }[];
  waiver: { id: string; version: number; title: string; body: string };
}

/** Shown only with ?preview=1, so the form can be reviewed before the event is published. Not real data. */
const PREVIEW: Loaded = {
  eventId: 'preview', name: 'Red Deer Rumble 2026 (preview of the form)', fee: { feeCents: 4000, feeProvince: 'AB' }, closesAt: '2026-11-09T06:59:00Z', mode: 'buhuros', externalUrl: null,
  comps: [
    ['Melee 3v3 (men)', '3v3', 'buhurt', 'men'], ['Melee 5v5 (men)', '5v5', 'buhurt', 'men'], ['Melee (women)', '5v5', 'buhurt', 'women'],
    ['Longsword (men)', 'longsword', 'duels', 'men'], ['Longsword (women)', 'longsword', 'duels', 'women'],
    ['Sword and Shield (men)', 'sword_shield', 'duels', 'men'], ['Sword and Shield (women)', 'sword_shield', 'duels', 'women'],
    ['Sword and Buckler (men)', 'buckler', 'duels', 'men'], ['Sword and Buckler (women)', 'buckler', 'duels', 'women'],
    ['Polearm (men)', 'polearm', 'duels', 'men'], ['Polearm (women)', 'polearm', 'duels', 'women'],
    ['Sabre (men)', 'sabre', 'hacsa', 'men'], ['Sabre (women)', 'sabre', 'hacsa', 'women'], ['Triathlon', 'triathlon', 'hacsa', 'open'],
    ['Marathon relay', 'marathon', 'hacsa', 'open'], ['Profight (men)', 'profight', 'outrance', 'men'], ['Profight (women)', 'profight', 'outrance', 'women']
  ].map(([name, category, league, gender], i) => ({ id: `p${i}`, name, category, league: league as LeagueKey, gender: gender as CompetitionOption['gender'] })),
  teams: [],
  waiver: { id: 'preview', version: 0, title: 'Waiver', body: '(The real waiver text is loaded from the database.)' }
};

async function load(slug: string): Promise<Loaded> {
  const { data: ev, error } = await supabase.from('events').select('id,name,fee_cents,fee_province,registration_closes_at,status,registration_mode,external_url').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!ev) throw new Error('This event is not open yet.');
  if (ev.registration_mode && ev.registration_mode !== 'buhuros') {
    // Sign-up happens elsewhere (or not at all): no form, so no competitions, teams or waiver are needed.
    return { eventId: ev.id, name: ev.name, fee: { feeCents: 0, feeProvince: null }, closesAt: null, mode: ev.registration_mode, externalUrl: ev.external_url, comps: [], teams: [], waiver: { id: '', version: 0, title: '', body: '' } };
  }
  const [c, t, w] = await Promise.all([
    supabase.from('competitions').select('id,name,category,gender,sort,ref_categories(league)').eq('event_id', ev.id).order('sort'),
    supabase.from('teams').select('id,name').eq('status', 'approved').order('name'),
    supabase.from('waiver_versions').select('id,version,title,body').eq('event_id', ev.id).order('version', { ascending: false }).limit(1)
  ]);
  if (c.error) throw c.error; if (t.error) throw t.error; if (w.error) throw w.error;
  if (!w.data?.[0]) throw new Error('The waiver for this event is not loaded yet.');
  type Row = { id: string; name: string; category: string; gender: CompetitionOption['gender']; ref_categories: { league: LeagueKey } | { league: LeagueKey }[] | null };
  return {
    eventId: ev.id, name: ev.name, fee: { feeCents: ev.fee_cents, feeProvince: ev.fee_province }, closesAt: ev.registration_closes_at, mode: ev.registration_mode ?? 'buhuros', externalUrl: ev.external_url,
    comps: (c.data as unknown as Row[]).map(r => ({ id: r.id, name: r.name, category: r.category, gender: r.gender, league: (Array.isArray(r.ref_categories) ? r.ref_categories[0] : r.ref_categories)?.league ?? 'duels' })),
    teams: t.data ?? [], waiver: w.data[0]
  };
}

const Err = ({ m }: { m?: string }) => (m ? <span role="alert" style={{ color: 'var(--live)' }}>{m}</span> : null);

export function RegisterPage() {
  const { eventId: slug = '' } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const { session, loading: authLoading } = useAuth();
  const [data, setData] = useState<Loaded | null>(preview ? PREVIEW : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [f, setF] = useState<RegForm>(emptyForm());
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (preview) return;
    load(slug).then(setData).catch(e => setLoadError(friendlyError(e, 'Could not load this event.')));
  }, [slug, preview]);
  useEffect(() => { if (session?.user.email) setF(p => (p.email ? p : { ...p, email: session.user.email ?? '' })); }, [session]);

  const set = <K extends keyof RegForm>(k: K, v: RegForm[K]) => setF(p => ({ ...p, [k]: v }));
  const errors = useMemo(() => (data ? validate(f, data.comps, data.fee) : {}), [f, data]);
  const fee = data ? feeFor(data.fee, f.province, f.isVolunteer) : 0;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  if (loadError) return <><PageHead eyebrow="Registration" title="Registration" /><p role="alert">{loadError}</p></>;
  if (!data) return <><PageHead eyebrow="Registration" title="Registration" /><p className="muted">Loading…</p></>;
  if (data.mode !== 'buhuros') {
    return (
      <>
        <PageHead eyebrow="Sign-up" title={data.name} lede={data.mode === 'external' ? 'Sign-up for this event happens on another website.' : 'This event does not need a sign-up.'} />
        {data.mode === 'external' && data.externalUrl && <a className="btn btn-ink" href={data.externalUrl} target="_blank" rel="noopener noreferrer">Open the sign-up page</a>}
      </>
    );
  }
  if (!preview && authLoading) return <p className="muted">Loading…</p>;
  if (!preview && !session) return <><PageHead eyebrow="Registration" title={`Register: ${data.name}`} /><SignIn reason="Sign in first so we can keep your registration and tell you when it is reviewed." /></>;
  if (done) {
    return (
      <>
        <PageHead eyebrow="Registration" title="Thank you, you are registered" lede="The organizers will review your registration. You can come back to this page at any time to see its status." />
        <p>{fee > 0 ? <>Fee: <b>{formatMoney(fee)}</b>. Pay by e-transfer or cash as described on the event page; the organizer marks it paid.</> : 'No fee is due for you.'}</p>
        <Link className="btn btn-ink" to="/events">Back to events</Link>
      </>
    );
  }

  const selected = data.comps.filter(c => f.competitionIds.includes(c.id));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length) { document.querySelector('[role=alert]')?.scrollIntoView({ block: 'center' }); return; }
    if (preview) { setSubmitError('This is a preview of the form. Nothing is saved.'); return; }
    setBusy(true); setSubmitError(null);
    const { error } = await supabase.rpc('submit_registration', { p_event: data.eventId, p_data: buildPayload(f, data.waiver.id) });
    setBusy(false);
    if (error) setSubmitError(friendlyError(error)); else setDone(true);
  };
  const shown = (k: string) => (showErrors ? errors[k] : undefined);
  const text = (k: keyof RegForm, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field-in">{label}
      <input value={f[k] as string} onChange={e => set(k, e.target.value as never)} aria-invalid={!!shown(k)} {...extra} />
      <Err m={shown(k)} />
    </label>
  );

  return (
    <>
      <PageHead eyebrow={preview ? 'Preview: nothing is saved' : 'Registration'} title={`Register: ${data.name}`}
        lede={data.closesAt ? `Registration closes ${new Date(data.closesAt).toLocaleDateString('en-CA', { dateStyle: 'long', timeZone: 'America/Edmonton' })}. Teams are final when it closes.` : undefined} />
      <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <section className="card field"><h3>About you</h3>
          {text('fullName', 'Full name', { autoComplete: 'name' })}
          {text('email', 'Email', { type: 'email', autoComplete: 'email' })}
          <div><p>Gender (decides which categories apply)</p><Seg label="Gender" value={f.gender} options={[['male', 'Male'], ['female', 'Female'], ['other', 'Other']] as const} onChange={v => set('gender', v)} /><Err m={shown('gender')} /></div>
          <div><p>Organization</p><Seg label="Organization" value={f.organization} options={[['HACSA', 'HACSA'], ['MCC', 'MCC'], ['other', 'Other']] as const} onChange={v => set('organization', v)} /><Err m={shown('organization')} /></div>
          <label className="field-in">Where are you from?
            <select value={f.province} onChange={e => set('province', e.target.value)}><option value="">Choose…</option>{PROVINCES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            <Err m={shown('province')} />
          </label>
          <label className="field-in">Team (approved teams only)
            <select value={f.teamId} onChange={e => set('teamId', e.target.value)}><option value="">No team / not listed</option>{data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          {text('biProfile', 'Buhurt International fighter profile, if you have one (fighters without one go in a separate bracket)')}
        </section>

        <section className="card field"><h3>What are you doing?</h3>
          <label><input type="checkbox" checked={f.isVolunteer} onChange={e => set('isVolunteer', e.target.checked)} /> I am volunteering (no fee)</label>
          {f.isVolunteer && <div>{VOLUNTEER_ROLES.map(r => <label key={r} style={{ display: 'block' }}><input type="checkbox" checked={f.volunteerRoles.includes(r)} onChange={() => set('volunteerRoles', toggle(f.volunteerRoles, r))} /> {r}</label>)}</div>}
          <p>Categories</p>
          {data.comps.map(c => (
            <label key={c.id} style={{ display: 'block' }}><input type="checkbox" checked={f.competitionIds.includes(c.id)} onChange={() => set('competitionIds', toggle(f.competitionIds, c.id))} /> {c.name}</label>
          ))}
          <Err m={shown('competitionIds')} />
          {selected.filter(c => c.league === 'outrance').map(c => (
            <label key={c.id} className="field-in">Weight for {c.name} (kg)
              <input inputMode="decimal" value={f.details[c.id]?.weight ?? ''} onChange={e => set('details', { ...f.details, [c.id]: { ...f.details[c.id], weight: e.target.value } })} />
              <Err m={shown(`weight:${c.id}`)} />
            </label>
          ))}
          {selected.filter(c => c.category === 'marathon').map(c => (
            <label key={c.id} className="field-in">Marathon teammate (name)
              <input value={f.details[c.id]?.teammate ?? ''} onChange={e => set('details', { ...f.details, [c.id]: { ...f.details[c.id], teammate: e.target.value } })} />
            </label>
          ))}
          {selected.filter(c => c.league === 'buhurt').map(c => <Err key={c.id} m={shown(`team:${c.id}`)} />)}
          <label><input type="checkbox" checked={f.mercenary} onChange={e => set('mercenary', e.target.checked)} /> Mercenary: I have no team and will fight where the organizers place me</label>
        </section>

        <section className="card field"><h3>Scheduling</h3>
          <div><p>Days you can attend</p>{(['sat', 'sun'] as const).map(d => <label key={d} style={{ display: 'block' }}><input type="checkbox" checked={f.days.includes(d)} onChange={() => set('days', toggle(f.days, d))} /> {d === 'sat' ? 'Saturday Nov 14' : 'Sunday Nov 15'}</label>)}<Err m={shown('days')} /></div>
          <div><p>Do you share equipment with another fighter?</p><Seg label="Shares equipment" value={f.sharesEquipment} options={[['yes', 'Yes'], ['no', 'No']] as const} onChange={v => set('sharesEquipment', v)} /><Err m={shown('sharesEquipment')} /></div>
          {text('availabilityNotes', 'Anything else about when you can fight')}
        </section>

        <section className="card field"><h3>Insurance</h3>
          {INSURANCE_OPTIONS.map(([k, label]) => <label key={k} style={{ display: 'block' }}><input type="radio" name="ins" checked={f.insurance === k} onChange={() => set('insurance', k)} /> {label}</label>)}
          <Err m={shown('insurance')} />
        </section>

        <section className="card field"><h3>Safety</h3>
          {text('emergencyName', 'Emergency contact name')}
          {text('emergencyRelationship', 'Relationship')}
          {text('emergencyPhone', 'Emergency contact phone', { type: 'tel', autoComplete: 'tel' })}
          <label><input type="checkbox" checked={f.medicallyFit} onChange={e => set('medicallyFit', e.target.checked)} /> I declare that I am medically fit to take part</label>
          <Err m={shown('medicallyFit')} />
          <label className="field-in">Medical note (optional). Only organizers and the medic can read it, and it is deleted 30 days after the event.
            <textarea rows={3} maxLength={1000} value={f.medicalNote} onChange={e => set('medicalNote', e.target.value)} />
          </label>
        </section>

        <section className="card field"><h3>Fee</h3>
          <p>{fee > 0 ? <>Your fee: <b>{formatMoney(fee)}</b>. Paid by e-transfer before November 13, or cash on the day.</> : 'No fee is due for you.'} The organizer can adjust it.</p>
          {fee > 0 && <><label><input type="checkbox" checked={f.feeUnderstood} onChange={e => set('feeUnderstood', e.target.checked)} /> I understand and will pay this fee</label><Err m={shown('feeUnderstood')} /></>}
        </section>

        <section className="card field"><h3>{data.waiver.title}</h3>
          <div style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }} tabIndex={0}>{data.waiver.body}</div>
          <label><input type="checkbox" checked={f.waiverAgree} onChange={e => set('waiverAgree', e.target.checked)} /> I have read and agree to the waiver (version {data.waiver.version})</label>
          <Err m={shown('waiverAgree')} />
          {text('waiverName', 'Type your full name to sign')}
          <label className="field-in">Notes for the organizers (optional)
            <textarea rows={3} maxLength={1000} value={f.notes} onChange={e => set('notes', e.target.value)} />
          </label>
        </section>

        {showErrors && Object.keys(errors).length > 0 && <p role="alert" style={{ color: 'var(--live)' }}>Please fix the {Object.keys(errors).length} highlighted item(s) above.</p>}
        {submitError && <p role="alert" style={{ color: 'var(--live)' }}>{submitError}</p>}
        <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit registration'}</button>
      </form>
    </>
  );
}
