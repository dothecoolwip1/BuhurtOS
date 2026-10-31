import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  emptySuggestion, fetchMySuggestions, INVOLVEMENT_OPTIONS, KIND_OPTIONS, statusText, suggestOrganization, validateSuggestion, type SuggestionForm
} from '../data/organizationSuggestions';
import { trackEvent } from '../lib/analytics';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { Chip } from './ui';

const bad: React.CSSProperties = { color: 'var(--live)' };
const ORDER: (keyof SuggestionForm)[] = ['name', 'shortName', 'country', 'region', 'website', 'description', 'note'];

/** "Not listed?": anyone signed in suggests a club, league or federation; the platform owner reviews it before it is listed. */
export function SuggestOrganization() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  return (
    <section aria-labelledby="suggest-org" className="panel" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <h2 id="suggest-org">Not listed?</h2>
      <p className="muted">Suggest a club, league or federation that is missing. It is reviewed before it appears here.</p>
      {!session && <p><Link className="btn btn-line" to={`/sign-in?next=${encodeURIComponent('/organizations')}`}>Sign in to suggest an organization</Link></p>}
      {session && sent && (
        <div role="status" style={{ display: 'grid', gap: 8 }}>
          <p><b>Thanks! {sent} was sent for review.</b> You will get a notification when it is decided.</p>
          <p><button type="button" className="btn btn-line" onClick={() => { setSent(null); setOpen(true); }}>Suggest another</button></p>
        </div>
      )}
      {session && !sent && !open && <p><button type="button" className="btn btn-ink" onClick={() => setOpen(true)}>Suggest an organization</button></p>}
      {session && !sent && open && <SuggestForm onCancel={() => setOpen(false)} onSent={name => { setSent(name); setOpen(false); setKey(k => k + 1); }} />}
      {session && <MySuggestions key={key} />}
    </section>
  );
}

function SuggestForm({ onCancel, onSent }: { onCancel: () => void; onSent: (name: string) => void }) {
  const [f, setF] = useState<SuggestionForm>(emptySuggestion());
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = validateSuggestion(f);
  const set = <K extends keyof SuggestionForm>(k: K, v: SuggestionForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: keyof SuggestionForm) => (show && errors[k] ? <span id={`sugg-err-${k}`} role="alert" style={bad}>{errors[k]}</span> : null);
  const inv = (k: keyof SuggestionForm) => ({ name: k, 'aria-invalid': Boolean(show && errors[k]), 'aria-describedby': show && errors[k] ? `sugg-err-${k}` : undefined });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    const first = ORDER.find(k => errors[k]);
    if (first) { formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(); return; }
    setBusy(true);
    try { await suggestOrganization(f); trackEvent('organization_suggested', { kind: f.kind }); onSent(f.name.trim().replace(/\s+/g, ' ')); }
    catch (x) { setProblem(friendlyError(x)); }
    finally { setBusy(false); }
  };

  return (
    <form ref={formRef} onSubmit={e => void submit(e)} noValidate style={{ display: 'grid', gap: 12 }}>
      <label className="field-in">Organization name
        <input {...inv('name')} value={f.name} onChange={e => set('name', e.target.value)} autoComplete="off" placeholder="For example Prairie Buhurt League" autoFocus />{err('name')}
      </label>
      <label className="field-in">Short name (optional)
        <input {...inv('shortName')} value={f.shortName} onChange={e => set('shortName', e.target.value)} autoComplete="off" placeholder="For example PBL" />{err('shortName')}
      </label>
      <label className="field-in">What kind of organization
        <select name="kind" value={f.kind} onChange={e => set('kind', e.target.value as SuggestionForm['kind'])}>{KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <label className="field-in">Country (optional)<input {...inv('country')} value={f.country} onChange={e => set('country', e.target.value)} autoComplete="country-name" />{err('country')}</label>
      <label className="field-in">Province or state (optional)<input {...inv('region')} value={f.region} onChange={e => set('region', e.target.value)} />{err('region')}</label>
      <label className="field-in">Website or social page (optional)
        <input {...inv('website')} type="url" inputMode="url" value={f.website} onChange={e => set('website', e.target.value)} autoComplete="off" placeholder="example.org" />{err('website')}
      </label>
      <label className="field-in">About it (optional)
        <textarea {...inv('description')} rows={3} value={f.description} onChange={e => set('description', e.target.value)} placeholder="What it runs, where, since when" />{err('description')}
      </label>
      <label className="field-in">How are you involved?
        <select name="involvement" value={f.involvement} onChange={e => set('involvement', e.target.value as SuggestionForm['involvement'])}>{INVOLVEMENT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <label className="field-in">Anything else for the reviewer (optional)
        <textarea {...inv('note')} rows={2} value={f.note} onChange={e => set('note', e.target.value)} placeholder="Only the reviewer sees this" />{err('note')}
      </label>
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Sending…' : 'Send suggestion'}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function MySuggestions() {
  const mine = useAsync(fetchMySuggestions, []);
  const list = mine.data ?? [];
  if (mine.error) return <p className="muted" style={{ fontSize: 13 }}>{friendlyError(mine.error, 'Could not load your suggestions.')}</p>;
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <h3>Your suggestions</h3>
      <ul className="plain" style={{ display: 'grid', gap: 8 }}>
        {list.map(s => (
          <li key={s.id} style={{ display: 'grid', gap: 4 }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{s.organizationSlug ? <Link to={`/organizations/${s.organizationSlug}`}>{s.name}</Link> : s.name}</b>
              <Chip tone={s.status === 'approved' ? 'win' : s.status === 'pending' ? 'brass' : ''}>{statusText(s.status)}</Chip>
            </span>
            {s.decisionNote && <span className="muted" style={{ fontSize: 13 }}>{s.decisionNote}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
