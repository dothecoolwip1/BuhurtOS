import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { finishedProfiles } from '../auth/ProfileGate';
import { SignIn } from '../auth/SignIn';
import { PageHead } from '../components/ui';
import { completeMyProfile, fetchMyProfile, INTERESTS, safeNext, validateProfileInput, type Interest, type ProfileInput } from '../data/profile';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const bad: React.CSSProperties = { color: 'var(--live)' };

/** First sign-in: who you are and how you take part. Required before the rest of the site. */
export function WelcomePage() {
  useDocumentTitle('Set up your profile');
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const userId = session?.user.id;
  const existing = useAsync(() => (userId ? fetchMyProfile(userId) : Promise.resolve(null)), [userId]);
  if (loading || (userId && existing.loading)) return <p className="muted">Loading…</p>;
  if (!session || !userId) return <><PageHead eyebrow="Welcome" title="Sign in" /><SignIn /></>;
  if (existing.data?.onboarded && !params.has('edit')) return <Navigate to={next} replace />;
  const google = (session.user.user_metadata as { full_name?: string } | undefined)?.full_name ?? '';
  return <Form userId={userId} next={next} initial={{
    displayName: existing.data?.displayName || google, interests: existing.data?.interests ?? [],
    city: existing.data?.city ?? '', region: existing.data?.region ?? '', country: existing.data?.country ?? ''
  }} />;
}

function Form({ userId, next, initial }: { userId: string; next: string; initial: ProfileInput }) {
  const nav = useNavigate();
  const [f, setF] = useState<ProfileInput>(initial);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setF(initial), [initial.displayName]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = validateProfileInput(f);
  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setF(p => ({ ...p, [k]: v }));
  const toggle = (i: Interest) => set('interests', f.interests.includes(i) ? f.interests.filter(x => x !== i) : [...f.interests, i]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try { await completeMyProfile(f); finishedProfiles.add(userId); nav(next, { replace: true }); }
    catch (x) { setProblem(friendlyError(x)); } finally { setBusy(false); }
  };

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18, maxWidth: 560 }}>
      <PageHead eyebrow="Welcome to BuhurtOS" title="Set up your profile" lede="One quick step before you start. You can change this later on your account page." />
      <form onSubmit={e => void save(e)} noValidate className="panel info" style={{ display: 'grid', gap: 18 }}>
        <label className="field-in">Your name
          <input value={f.displayName} maxLength={80} autoComplete="name" onChange={e => set('displayName', e.target.value)} aria-invalid={Boolean(show && errors.displayName)} />
          <span>Organizers and captains see this name on your requests and registrations.</span>
          {show && errors.displayName && <span role="alert" style={bad}>{errors.displayName}</span>}
        </label>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 14 }}>How do you take part? Choose all that fit.</legend>
          <div className="choice-grid">
            {INTERESTS.map(([k, label, sub]) => (
              <label key={k} className={`choice${f.interests.includes(k) ? ' on' : ''}`}>
                <input type="checkbox" checked={f.interests.includes(k)} onChange={() => toggle(k)} />
                <span><b>{label}</b><span className="acct-sub">{sub}</span></span>
              </label>
            ))}
          </div>
          {show && errors.interests && <span role="alert" style={bad}>{errors.interests}</span>}
        </fieldset>

        <div className="form">
          <label className="field-in">City (optional)<input value={f.city} autoComplete="address-level2" onChange={e => set('city', e.target.value)} /></label>
          <label className="field-in">Province or state<input value={f.region} autoComplete="address-level1" onChange={e => set('region', e.target.value)} /></label>
          <label className="field-in">Country<input value={f.country} autoComplete="country-name" onChange={e => set('country', e.target.value)} /></label>
        </div>
        {show && errors.city && <span role="alert" style={bad}>{errors.city}</span>}
        <p className="src">This stays private to you. Your public fighter page is separate and appears once a registration of yours is accepted at an event.</p>
        {problem && <p role="alert" style={bad}>{problem}</p>}
        <div className="formactions"><button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button></div>
      </form>
    </section>
  );
}
