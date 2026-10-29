import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { PageHead } from '../components/ui';
import { VenuePicker, type VenueFields } from '../components/VenuePicker';
import { fetchRefCategories, fetchSetupCompetitions, LEAGUE_LABEL, type Division, type SetupCompetition } from '../data/competitions';
import { fetchSeasons } from '../data/careers';
import { fetchLinkableOrganizations } from '../data/organizations';
import { createQuickEvent, fetchMyPastEvents, isOrgLinkNotAllowed } from '../data/quickSetup';
import { fetchCanCreateEvents, isSlugTaken } from '../data/setup';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { trackEvent } from '../lib/analytics';
import {
  clearAll, competitionCount, competitionsToCreate, DIVISION_WORD, initialSelection, isTeamCategory, reviewLines, selectAll, toggleCategory, toggleDivision, defaultDivisions,
  type CategoryRef
} from '../lib/quickSetup';
import { blankToNull, slugify, validateNewEvent, type NewEventForm } from '../registration/create';

/**
 * Create an event (Pack 09D Quick Setup). Two short steps: the event and what it offers, then a one-screen check. Everything a normal tournament needs
 * is defaulted from the reference data; the organizer turns OFF what they are not running. "Advanced setup" stays one tap away for anything unusual.
 */
export function NewEventPage() {
  useDocumentTitle('Create an event');
  const { session, loading } = useAuth();
  const userId = session?.user.id;
  const can = useAsync(() => (userId ? fetchCanCreateEvents(userId) : Promise.resolve(false)), [userId]);
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
  return <QuickSetup userId={userId!} />;
}

function QuickSetup({ userId }: { userId: string }) {
  const nav = useNavigate();
  const cats = useAsync(() => fetchRefCategories(), []);
  const past = useAsync(() => fetchMyPastEvents(userId).catch(() => []), [userId]);
  // Only organizations this person may link an event to (owner: all active ones; otherwise those they are an admin of). The database checks again.
  const orgs = useAsync(() => fetchLinkableOrganizations(userId).catch(() => []), [userId]);
  const seasons = useAsync(() => fetchSeasons().catch(() => []), []);

  const [step, setStep] = useState<'event' | 'review'>('event');
  const [f, setF] = useState<NewEventForm>({ name: '', slug: '', startsOn: '', endsOn: '', venue: '', address: '' });
  const [where, setWhere] = useState<VenueFields>({ venue: '', address: '', city: '', region: '', country: '', latitude: null, longitude: null });
  const [slugTouched, setSlugTouched] = useState(false);
  const [editSlug, setEditSlug] = useState(false);
  const [fields, setFields] = useState(1);
  const [isTest, setIsTest] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [likeId, setLikeId] = useState('');
  const [like, setLike] = useState<SetupCompetition[] | null>(null);
  const [sel, setSel] = useState<Map<string, Set<Division>> | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const categories = (cats.data ?? []) as CategoryRef[];
  const selection = useMemo(() => sel ?? initialSelection(categories), [sel, categories]);
  const errors = validateNewEvent(f);
  const count = competitionCount(selection);
  const orgSeasons = (seasons.data ?? []).filter(s => s.organizationId === orgId);

  const set = <K extends keyof NewEventForm>(k: K, v: NewEventForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: string) => (show && errors[k] ? <span role="alert" style={{ color: 'var(--live)' }}>{errors[k]}</span> : null);

  const copyFrom = async (id: string) => {
    setLikeId(id); setProblem(null);
    if (!id) { setLike(null); setSel(null); return; }
    try {
      const comps = await fetchSetupCompetitions(id);
      const ev = past.data?.find(e => e.id === id);
      setLike(comps); setSel(initialSelection(categories, comps));
      if (ev) setFields(ev.fieldCount);
    } catch (e) { setProblem(friendlyError(e, 'Could not read that event’s setup.')); }
  };

  const toReview = (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (Object.keys(errors).length) { if (errors.slug) setEditSlug(true); return; }
    setStep('review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const create = async (advanced: boolean) => {
    setBusy(true); setProblem(null);
    try {
      const r = await createQuickEvent({
        userId, slug: f.slug, name: f.name.trim(), startsOn: f.startsOn, endsOn: f.endsOn,
        venue: blankToNull(where.venue), address: blankToNull(where.address), city: blankToNull(where.city), region: blankToNull(where.region), country: blankToNull(where.country),
        latitude: where.latitude, longitude: where.longitude, fieldCount: fields, organizationId: orgId || null, seasonId: seasonId || null,
        competitions: competitionsToCreate(categories, selection, like ?? undefined), test: isTest
      });
      trackEvent('event_created', { test: isTest });
      const notes = r.problems.length > 0 ? `&notes=${encodeURIComponent(r.problems.join('\n'))}` : '';
      nav(advanced ? `/events/${f.slug}/control?mode=setup&tool=competitions` : `/events/${f.slug}/control?mode=setup&created=1${notes}`);
    } catch (x) {
      if (isOrgLinkNotAllowed(x)) {
        // Nothing was created. Back to step 1 with the link cleared, so the next Create works.
        setProblem(`${x.message} Choose another one or None.`);
        setOrgId(''); setSeasonId(''); setStep('event'); setBusy(false); orgs.reload();
        return;
      }
      setProblem(isSlugTaken(x) ? 'That web address is already used by another event. Change it below.' : friendlyError(x));
      if (isSlugTaken(x)) { setStep('event'); setEditSlug(true); }
      setBusy(false);
    }
  };

  if (step === 'review') {
    const lines = reviewLines(categories, selection, like ?? undefined);
    const org = orgs.data?.find(o => o.id === orgId);
    const season = orgSeasons.find(s => s.id === seasonId);
    return (
      <section className="fade-in qs" style={{ display: 'grid', gap: 16 }} aria-labelledby="qs-review-h">
        <PageHead eyebrow="Create an event · step 2 of 2" title="Check your setup" lede="This is what your event offers. You can change any of it later." />
        <div className="panel info qs-sum" style={{ display: 'grid', gap: 6 }}>
          <h2 id="qs-review-h" className="qs-h">{f.name.trim()}</h2>
          <p>{f.startsOn === f.endsOn ? f.startsOn : `${f.startsOn} to ${f.endsOn}`}{where.venue || where.city ? ` · ${[where.venue, where.city].filter(Boolean).join(', ')}` : ''}</p>
          <p>{fields} field{fields === 1 ? '' : 's'}{org ? ` · ${org.name}` : ''}{season ? ` · ${season.name}` : ''}</p>
          {isTest && <p data-testid="qs-test-review"><b>Test event:</b> only you and the staff you add can see it. It is deleted, with everything in it, 10 days after you create it. Fighter profiles stay.</p>}
        </div>
        {lines.length === 0
          ? <div className="panel info"><b>No competitions yet.</b> <span className="src">That is fine for a practice or a gathering. You can add competitions later.</span></div>
          : (
            <ul className="qs-review" aria-label="What your event offers">
              {lines.map(l => (
                <li key={l.code} className="panel info">
                  <b>✓ {l.name}</b>
                  <span>{l.divisions} · {l.kind}</span>
                  <span className="src">{l.ruleset}</span>
                </li>
              ))}
            </ul>
          )}
        <p className="qs-ok" role="status">{lines.length > 0 ? `Looks good: ${count} competition${count === 1 ? '' : 's'}. Divisions with nobody registered are simply not run.` : 'Looks good.'}</p>
        {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
        <div className="qs-actions">
          <button type="button" className="btn btn-ink qs-go" disabled={busy} onClick={() => void create(false)}>{busy ? 'Creating…' : 'Create event'}</button>
          <button type="button" className="btn btn-line" disabled={busy} onClick={() => setStep('event')}>Back</button>
        </div>
        <p className="src">Need something unusual (tier, rounds to win, a different ruleset)? <button type="button" className="linklike" disabled={busy} onClick={() => void create(true)}>Create it and open Advanced setup</button></p>
      </section>
    );
  }

  return (
    <section className="fade-in qs" style={{ display: 'grid', gap: 16 }}>
      <PageHead eyebrow="Create an event · step 1 of 2" title="Create an event" lede="Fill in the basics and untick anything you are not running. Everything else is set up for you." />
      <form onSubmit={toReview} noValidate style={{ display: 'grid', gap: 16 }}>
        <label className={`panel info qs-test${isTest ? ' is-on' : ''}`} data-testid="qs-test">
          <input type="checkbox" checked={isTest} onChange={e => setIsTest(e.target.checked)} />
          <span><b>This is a test event</b><span className="src">For practice and trying things out. Only you and the staff you add can see it, nothing from it counts or is kept, and it is deleted 10 days after you create it. Fighter profiles stay.</span></span>
        </label>
        <div className="panel info" style={{ display: 'grid', gap: 14 }}>
          <label className="field-in">Event name
            <input value={f.name} onChange={e => { set('name', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)); }} aria-invalid={Boolean(show && errors.name)} placeholder="Red Deer Rumble 2027" />{err('name')}
          </label>
          <div className="form">
            <label className="field-in">First day<input type="date" value={f.startsOn} onChange={e => { set('startsOn', e.target.value); if (!f.endsOn || f.endsOn < e.target.value) set('endsOn', e.target.value); }} aria-invalid={Boolean(show && errors.startsOn)} />{err('startsOn')}</label>
            <label className="field-in">Last day<input type="date" value={f.endsOn} min={f.startsOn || undefined} onChange={e => set('endsOn', e.target.value)} aria-invalid={Boolean(show && errors.endsOn)} />{err('endsOn')}</label>
          </div>
          {editSlug
            ? (
              <label className="field-in">Web address name
                <input value={f.slug} onChange={e => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} aria-invalid={Boolean(show && errors.slug)} autoCapitalize="none" spellCheck={false} />
                <span>The event will live at /events/{f.slug || 'your-name'}. It cannot be changed later.</span>{err('slug')}
              </label>
            )
            : f.slug && <p className="src">Web address: /events/{f.slug} <button type="button" className="linklike" onClick={() => setEditSlug(true)}>Change</button></p>}
        </div>

        <fieldset className="panel info" style={{ display: 'grid', gap: 10, margin: 0 }}>
          <legend className="qs-legend">Where (optional now, needed before you open registration)</legend>
          <VenuePicker value={where} onChange={setWhere} />
        </fieldset>

        <div className="panel info" style={{ display: 'grid', gap: 14 }}>
          <div className="qs-fields">
            <span id="qs-fields-l"><b>Number of fields</b><span className="src">Fights run side by side on each field.</span></span>
            <div className="qs-stepper" role="group" aria-labelledby="qs-fields-l">
              <button type="button" className="btn btn-line" aria-label="One field fewer" disabled={fields <= 1} onClick={() => setFields(n => Math.max(1, n - 1))}>−</button>
              <output aria-live="polite" aria-label="Fields">{fields}</output>
              <button type="button" className="btn btn-line" aria-label="One field more" disabled={fields >= 12} onClick={() => setFields(n => Math.min(12, n + 1))}>+</button>
            </div>
          </div>
          {(orgs.data?.length ?? 0) > 0 && (
            <div className="form">
              <label className="field-in">Organization (optional)
                <select value={orgId} onChange={e => { setOrgId(e.target.value); setSeasonId(''); }}>
                  <option value="">None</option>
                  {orgs.data!.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              {orgId && orgSeasons.length > 0 && (
                <label className="field-in">Season (optional)
                  <select value={seasonId} onChange={e => setSeasonId(e.target.value)}>
                    <option value="">None</option>
                    {orgSeasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          {(past.data?.length ?? 0) > 0 && (
            <label className="field-in">Start from
              <select value={likeId} onChange={e => void copyFrom(e.target.value)}>
                <option value="">A standard tournament</option>
                {past.data!.map(e => <option key={e.id} value={e.id}>Same setup as {e.name}</option>)}
              </select>
              <span>Copies the competitions and fields only. Never the people, fights or results.</span>
            </label>
          )}
        </div>

        <fieldset className="panel info qs-cats" style={{ margin: 0 }} aria-describedby="qs-cats-help">
          <legend className="qs-legend">What are we fighting?</legend>
          <p id="qs-cats-help" className="src">The usual competitions are ticked. Untick what you are not running. Nobody registered for a division? It is simply not run.</p>
          <div className="qs-bulk">
            <button type="button" className="btn btn-line btn-sm" onClick={() => setSel(selectAll(categories))}>Select all</button>
            <button type="button" className="btn btn-line btn-sm" onClick={() => setSel(clearAll())}>Clear all</button>
          </div>
          {cats.loading && <p className="muted">Loading the competitions…</p>}
          {cats.error != null && <p role="alert">{friendlyError(cats.error, 'Could not load the competition list.')}</p>}
          <ul className="qs-list">
            {categories.map(c => {
              const on = selection.has(c.code);
              const divs = selection.get(c.code);
              const options: Division[] = defaultDivisions(c).includes('open') ? ['open'] : ['men', 'women'];
              return (
                <li key={c.code} className={`qs-cat${on ? ' on' : ''}`}>
                  <label className="qs-check">
                    <input type="checkbox" checked={on} onChange={() => setSel(toggleCategory(selection, c))} />
                    <span><b>{c.name}</b><span className="src">{isTeamCategory(c) ? 'Team fights' : LEAGUE_LABEL[c.league]}</span></span>
                  </label>
                  {on && options.length > 1 && (
                    <div className="qs-divs" role="group" aria-label={`${c.name} divisions`}>
                      {options.map(d => (
                        <button key={d} type="button" className={`qs-div${divs?.has(d) ? ' on' : ''}`} aria-pressed={divs?.has(d) ?? false} onClick={() => setSel(toggleDivision(selection, c.code, d))}>{DIVISION_WORD[d]}</button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>

        {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
        <div className="qs-actions">
          <button type="submit" className="btn btn-ink qs-go" disabled={cats.loading}>Continue</button>
          <span className="src" aria-live="polite">{count} competition{count === 1 ? '' : 's'} · {fields} field{fields === 1 ? '' : 's'}</span>
        </div>
      </form>
    </section>
  );
}
