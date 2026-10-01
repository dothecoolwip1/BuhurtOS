import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { PageHead } from '../components/ui';
import { createTeam, isSlugTaken } from '../data/setup';
import { friendlyError } from '../lib/friendlyError';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { blankToNull, slugify, validateNewTeam, type NewTeamForm } from '../registration/create';

export function NewTeamPage() {
  useDocumentTitle('Create a team');
  const { session, loading } = useAuth();
  const [f, setF] = useState<NewTeamForm>({ name: '', slug: '', city: '', region: '', country: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const errors = validateNewTeam(f);

  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Teams" title="Create a team" lede="Sign in first." /><SignIn /></>;
  if (done) {
    return (
      <section className="fade-in" style={{ display: 'grid', gap: 16 }}>
        <PageHead eyebrow="Teams" title="Team submitted" />
        <div className="panel info" style={{ display: 'grid', gap: 8 }}>
          <p><b>{done}</b> was submitted and you are its captain. It stays private until an organizer approves it, then it appears publicly.</p>
          <p><Link to="/events">Back to events</Link></p>
        </div>
      </section>
    );
  }

  const set = <K extends keyof NewTeamForm>(k: K, v: NewTeamForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: string) => (show && errors[k] ? <span role="alert" style={{ color: 'var(--live)' }}>{errors[k]}</span> : null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      await createTeam({ slug: f.slug, name: f.name, city: blankToNull(f.city), region: blankToNull(f.region), country: blankToNull(f.country) });
      setDone(f.name.trim());
    } catch (x) {
      setProblem(isSlugTaken(x) ? 'That web address is already used by another team. Pick a different one.' : friendlyError(x));
    } finally { setBusy(false); }
  };

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 16 }}>
      <PageHead eyebrow="Teams" title="Create a team" lede="Anyone signed in can propose a team. New teams are reviewed by organizers before they are public, and you become the team's captain." />
      <form onSubmit={submit} noValidate className="panel info" style={{ display: 'grid', gap: 14 }}>
        <label className="field-in">Team name
          <input value={f.name} onChange={e => { set('name', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)); }} aria-invalid={Boolean(show && errors.name)} />{err('name')}
        </label>
        <label className="field-in">Web address name
          <input value={f.slug} onChange={e => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} aria-invalid={Boolean(show && errors.slug)} autoCapitalize="none" spellCheck={false} />
          <span>Lowercase letters, numbers and hyphens.</span>{err('slug')}
        </label>
        <div className="form">
          <label className="field-in">City (optional)<input value={f.city} onChange={e => set('city', e.target.value)} /></label>
          <label className="field-in">Province or state (optional)<input value={f.region} onChange={e => set('region', e.target.value)} /></label>
          <label className="field-in">Country (optional)<input value={f.country} onChange={e => set('country', e.target.value)} /></label>
        </div>
        {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
        <div><button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Submitting…' : 'Submit team for review'}</button></div>
      </form>
    </section>
  );
}
