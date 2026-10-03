import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { PageHead } from '../components/ui';
import { VenuePicker, type VenueFields } from '../components/VenuePicker';
import { createEvent, fetchCanCreateEvents, isSlugTaken, updateEvent } from '../data/setup';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { trackEvent } from '../lib/analytics';
import { blankToNull, slugify, validateNewEvent, type NewEventForm } from '../registration/create';

export function NewEventPage() {
  useDocumentTitle('Create an event');
  const { session, loading } = useAuth();
  const userId = session?.user.id;
  const can = useAsync(() => (userId ? fetchCanCreateEvents(userId) : Promise.resolve(false)), [userId]);
  const nav = useNavigate();
  const [f, setF] = useState<NewEventForm>({ name: '', slug: '', startsOn: '', endsOn: '', venue: '', address: '' });
  const [where, setWhere] = useState<VenueFields>({ venue: '', address: '', city: '', region: '', country: '', latitude: null, longitude: null });
  const [slugTouched, setSlugTouched] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const errors = validateNewEvent(f);

  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Events" title="Create an event" lede="Sign in first." /><SignIn /></>;
  if (can.loading) return <p className="muted">Checking your access…</p>;
  if (can.error != null) return <p role="alert">{friendlyError(can.error, 'Could not check your access.')}</p>;
  if (!can.data) {
    return (
      <section className="fade-in" style={{ display: 'grid', gap: 16 }}>
        <PageHead eyebrow="Events" title="Create an event" />
        <div className="panel info" style={{ display: 'grid', gap: 8 }}>
          <h3>Event creation is for approved organizers</h3>
          <p>The BuhurtOS owner approves each organizer once. After that, an organizer can create their own events and add their own marshals, scorekeepers and medic.</p>
          <p>If you run events and want to be approved, ask the BuhurtOS owner. Once you are approved, come back to this page.</p>
          <p>Looking to take part instead? <Link to="/events">Browse events</Link> and register from an event page.</p>
        </div>
      </section>
    );
  }

  const set = <K extends keyof NewEventForm>(k: K, v: NewEventForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: string) => (show && errors[k] ? <span role="alert" style={{ color: 'var(--live)' }}>{errors[k]}</span> : null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const id = await createEvent({ slug: f.slug, name: f.name, startsOn: f.startsOn, endsOn: f.endsOn, venue: blankToNull(where.venue), address: blankToNull(where.address) });
      // The rest of the venue (city, province, country, map position) is saved in a second step; a failure here leaves a draft the organizer can finish in Setup.
      if (where.city || where.region || where.country || where.latitude !== null) {
        try { await updateEvent(id, { city: blankToNull(where.city), region: blankToNull(where.region), country: blankToNull(where.country), latitude: where.latitude, longitude: where.longitude }); } catch (e) { console.warn('[BuhurtOS] venue details not saved', e); }
      }
      trackEvent('event_created');
      nav(`/events/${f.slug}/manage?tab=setup`);
    } catch (x) {
      setProblem(isSlugTaken(x) ? 'That web address is already used by another event. Pick a different one.' : friendlyError(x));
      setBusy(false);
    }
  };

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 16 }}>
      <PageHead eyebrow="Events" title="Create an event" lede="Start with the basics. The event stays a private draft until you publish it from its setup tab." />
      <form onSubmit={submit} noValidate className="panel info" style={{ display: 'grid', gap: 14 }}>
        <label className="field-in">Event name
          <input value={f.name} onChange={e => { set('name', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)); }} aria-invalid={Boolean(show && errors.name)} />{err('name')}
        </label>
        <label className="field-in">Web address name
          <input value={f.slug} onChange={e => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} aria-invalid={Boolean(show && errors.slug)} autoCapitalize="none" spellCheck={false} />
          <span>The event will live at /events/{f.slug || 'your-name'}. It cannot be changed later.</span>{err('slug')}
        </label>
        <div className="form">
          <label className="field-in">First day<input type="date" value={f.startsOn} onChange={e => { set('startsOn', e.target.value); if (!f.endsOn) set('endsOn', e.target.value); }} aria-invalid={Boolean(show && errors.startsOn)} />{err('startsOn')}</label>
          <label className="field-in">Last day<input type="date" value={f.endsOn} min={f.startsOn || undefined} onChange={e => set('endsOn', e.target.value)} aria-invalid={Boolean(show && errors.endsOn)} />{err('endsOn')}</label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Where (optional now, needed before publishing)</legend>
          <VenuePicker value={where} onChange={setWhere} />
        </fieldset>
        {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
        <div><button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Creating…' : 'Create event'}</button></div>
      </form>
    </section>
  );
}
