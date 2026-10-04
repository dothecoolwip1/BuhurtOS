import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { Chip, PageHead, Seg } from '../components/ui';
import { eventDays } from '../lib/eventDays';
import { fetchMyRegistration, type MyRegistration } from '../data/myEvents';
import { INSURANCE_LABEL } from './review';
import { trackEvent } from '../lib/analytics';
import {
  INSURANCE_OPTIONS, PROVINCES, ALL_VOLUNTEER_ROLES, OTHER_ROLE, OTHER_ROLE_MAX, buildPayload, emptyForm, feeFor, formatMoney, validate,
  type CompetitionOption, type EventFee, type LeagueKey, type RegForm
} from './model';

interface Loaded {
  eventId: string; name: string; startsOn: string; endsOn: string; feeNote: string | null; fee: EventFee; closesAt: string | null; volunteerInfo: string | null; mode: 'buhuros' | 'external' | 'none'; externalUrl: string | null;
  comps: CompetitionOption[]; teams: { id: string; name: string }[];
  waiver: { id: string; version: number; title: string; body: string };
}

/** Shown only with ?preview=1, so the form can be reviewed before the event is published. Not real data. */
const PREVIEW: Loaded = {
  eventId: 'preview', name: 'Red Deer Rumble 2026 (preview of the form)', startsOn: '2026-11-14', endsOn: '2026-11-15', feeNote: 'Pay by e-transfer before the event, or cash on the day.', fee: { feeCents: 4000, feeProvince: 'AB' }, closesAt: '2026-11-09T06:59:00Z', volunteerInfo: null, mode: 'buhuros', externalUrl: null,
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
  const { data: ev, error } = await supabase.from('events').select('id,name,starts_on,ends_on,fee_cents,fee_province,fee_note,registration_closes_at,status,registration_mode,external_url,volunteer_info').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!ev) throw new Error('This event is not open yet.');
  if (ev.registration_mode && ev.registration_mode !== 'buhuros') {
    // Sign-up happens elsewhere (or not at all): no form, so no competitions, teams or waiver are needed.
    return { eventId: ev.id, name: ev.name, startsOn: ev.starts_on, endsOn: ev.ends_on, feeNote: null, fee: { feeCents: 0, feeProvince: null }, closesAt: null, volunteerInfo: null, mode: ev.registration_mode, externalUrl: ev.external_url, comps: [], teams: [], waiver: { id: '', version: 0, title: '', body: '' } };
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
    eventId: ev.id, name: ev.name, startsOn: ev.starts_on, endsOn: ev.ends_on, feeNote: ev.fee_note ?? null, fee: { feeCents: ev.fee_cents, feeProvince: ev.fee_province }, closesAt: ev.registration_closes_at, volunteerInfo: ev.volunteer_info ?? null, mode: ev.registration_mode ?? 'buhuros', externalUrl: ev.external_url,
    comps: (c.data as unknown as Row[]).map(r => ({ id: r.id, name: r.name, category: r.category, gender: r.gender, league: (Array.isArray(r.ref_categories) ? r.ref_categories[0] : r.ref_categories)?.league ?? 'duels' })),
    teams: t.data ?? [], waiver: w.data[0]
  };
}

/** The organizer's volunteer note, or a visible placeholder when none is set. No safety or legal wording is written here. */
function VolunteerInfo({ info }: { info: string | null }) {
  return (
    <div role="note" className="card" style={{ borderLeft: '4px solid var(--brass, #C9893A)', padding: 12 }}>
      <b>Volunteer information</b>
      {info ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{info}</p>
        : <p>The organizers have not posted the volunteer safety, liability and tracking information yet. Volunteers who assist fighters fill in a separate form; ask the organizers for it.</p>}
    </div>
  );
}

function VolunteerBlock({ f, set, info, toggle, error }: {
  f: RegForm; set: <K extends keyof RegForm>(k: K, v: RegForm[K]) => void; info: string | null; toggle: <T>(l: T[], v: T) => T[]; error?: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <VolunteerInfo info={info} />
      {ALL_VOLUNTEER_ROLES.map(r => <label key={r} style={{ display: 'block' }}><input type="checkbox" checked={f.volunteerRoles.includes(r)} onChange={() => set('volunteerRoles', toggle(f.volunteerRoles, r))} /> {r}</label>)}
      {f.volunteerRoles.includes(OTHER_ROLE) && (
        <label className="field-in">Other: describe how you would like to help
          <input value={f.volunteerOther} maxLength={OTHER_ROLE_MAX} onChange={e => set('volunteerOther', e.target.value)} aria-invalid={!!error} />
          <Err m={error} />
        </label>
      )}
    </div>
  );
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
  const [existing, setExisting] = useState<MyRegistration | null | undefined>(undefined);   // undefined: not looked up yet
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (preview) return;
    load(slug).then(setData).catch(e => setLoadError(e instanceof Error && !('code' in e) && e.message ? e.message : friendlyError(e, 'Could not load this event.')));
  }, [slug, preview]);
  useEffect(() => { if (session?.user.email) setF(p => (p.email ? p : { ...p, email: session.user.email ?? '' })); }, [session]);
  useEffect(() => {
    if (preview || !data || data.mode !== 'buhuros' || !session) { setExisting(null); return; }
    let live = true;
    fetchMyRegistration(data.eventId, session.user.id).then(r => { if (live) setExisting(r); }, () => { if (live) setExisting(null); });
    return () => { live = false; };
  }, [preview, data, session]);

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
  if (!preview && existing === undefined) return <><PageHead eyebrow="Registration" title={`Register: ${data.name}`} /><p className="muted">Loading…</p></>;
  if (!preview && existing && !done && !changing && existing.status !== 'declined' && existing.status !== 'withdrawn') {
    return <ExistingRegistration r={existing} data={data} slug={slug} onChange={existing.status === 'pending' ? () => setChanging(true) : undefined} />;
  }
  if (done) {
    return (
      <>
        <PageHead eyebrow="Registration" title="Thank you, you are registered" lede="The organizers will review your registration. You can come back to this page at any time to see its status." />
        {f.isVolunteer && <VolunteerInfo info={data.volunteerInfo} />}
        <p>{fee > 0 ? <>Fee: <b>{formatMoney(fee)}</b>. {data.feeNote ?? 'The organizers say how to pay on the event page'}; the organizer marks it paid.</> : 'No fee is due for you.'}</p>
        <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Link className="btn btn-ink" to={`/events/${slug}`}>Back to the event</Link><Link className="btn btn-line" to="/my-events">My events</Link></p>
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
    if (error) setSubmitError(friendlyError(error)); else { trackEvent('registration_submitted', { volunteer: f.isVolunteer === true }); setDone(true); }
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
          {f.isVolunteer && <VolunteerBlock f={f} set={set} info={data.volunteerInfo} toggle={toggle} error={shown('volunteerOther')} />}
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
          <div><p>Days you can attend</p>{eventDays(data.startsOn, data.endsOn).map(d => <label key={d.iso} style={{ display: 'block' }}><input type="checkbox" checked={f.attendDates.includes(d.iso)} onChange={() => set('attendDates', toggle(f.attendDates, d.iso))} /> {d.label}</label>)}<Err m={shown('attendDates')} /></div>
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
          <p>{fee > 0 ? <>Your fee: <b>{formatMoney(fee)}</b>. {data.feeNote ?? 'The organizers say how to pay on the event page.'}</> : 'No fee is due for you.'} The organizer can adjust it.</p>
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

/** What the person already sent for this event: status, what they chose and what is still outstanding. No blank form a second time. */
function ExistingRegistration({ r, data, slug, onChange }: { r: MyRegistration; data: Loaded; slug: string; onChange?: () => void }) {
  const word = r.status === 'accepted' ? 'Accepted' : r.status === 'pending' ? 'Waiting for review' : r.status;
  const todo: string[] = [];
  if (r.status === 'accepted' && r.feeDueCents > 0 && !r.feePaid) todo.push('fee not marked paid');
  if (r.status === 'accepted' && (r.insurance === 'proof_pending' || r.insurance === 'needs_cover')) todo.push(r.insurance === 'proof_pending' ? 'insurance proof not received' : 'insurance cover not arranged');
  const days = r.attendDates.length ? r.attendDates.map(d => eventDays(d, d)[0]?.label ?? d).join(', ') : r.days.length ? r.days.map(d => (d === 'sat' ? 'Saturday' : 'Sunday')).join(', ') : null;
  return (
    <>
      <PageHead eyebrow="Registration" title={data.name} lede={r.status === 'pending' ? 'Your registration is in. The organizers review it and you are told when they decide.' : 'You are registered for this event.'} />
      <section className="panel info" aria-labelledby="myreg-h" style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
        <h3 id="myreg-h">Your registration</h3>
        <p><Chip tone={r.status === 'accepted' ? 'win' : 'brass'}>{word}</Chip>{r.isVolunteer && <> <Chip>Volunteer</Chip></>}</p>
        <dl className="dl">
          <div><dt>Name</dt><dd>{r.fullName}</dd></div>
          {r.categories.length > 0 && <div><dt>Categories</dt><dd>{r.categories.join(', ')}</dd></div>}
          {r.teamName && <div><dt>Team</dt><dd>{r.teamName}</dd></div>}
          {days && <div><dt>Days</dt><dd>{days}</dd></div>}
          <div><dt>Insurance</dt><dd>{INSURANCE_LABEL[r.insurance as keyof typeof INSURANCE_LABEL] ?? r.insurance}</dd></div>
          <div><dt>Fee</dt><dd>{r.feeDueCents > 0 ? `${formatMoney(r.feeDueCents)} · ${r.feePaid ? 'paid' : 'not marked paid yet'}` : 'none'}</dd></div>
          {r.waiverVersion !== null && <div><dt>Waiver</dt><dd>version {r.waiverVersion}, signed</dd></div>}
        </dl>
        {todo.length > 0 && <p style={{ color: 'var(--live)', fontWeight: 600 }}>Still outstanding: {todo.join(' · ')}.</p>}
        {r.status === 'accepted' && todo.length === 0 && <p style={{ color: 'var(--win)', fontWeight: 600 }}>Nothing is outstanding. See you at check-in.</p>}
        <p className="src">{r.status === 'accepted' ? 'To change anything now, ask an organizer; accepted registrations are changed by them.' : 'You can change your answers until the organizers decide; sending again replaces what you sent before.'}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btn-ink" to={`/events/${slug}`}>Back to the event</Link>
          <Link className="btn btn-line" to="/my-events">My events</Link>
          {onChange && <button type="button" className="btn btn-line" onClick={onChange}>Change my answers</button>}
        </div>
      </section>
    </>
  );
}
