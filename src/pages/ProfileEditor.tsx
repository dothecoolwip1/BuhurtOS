import { useState } from 'react';
import {
  BIO_MAX, DISCIPLINES_MAX, fetchCategoryOptions, GENDERS, HIGHLIGHT_MAX, HIGHLIGHTS_MAX, profileToForm, updateMyFighterProfile, validateProfile,
  type FighterProfile, type Gender, type ProfileForm
} from '../data/fighters';
import { genderLabel } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { SocialLinksEditor } from '../components/SocialLinks';
import type { SocialNetwork } from '../lib/social';

const bad: React.CSSProperties = { color: 'var(--live)' };

/** The signed-in fighter's own public profile. Everything here is shown publicly; the database only lets them change their own record.
 * Rendered on a normal page (not a popup) so it scrolls like any other page on a phone. */
export function ProfileEditor({ profile, onSaved, onCancel }: { profile: FighterProfile; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState<ProfileForm>(profileToForm(profile));
  const [highlights, setHighlights] = useState(profile.highlights.join('\n'));
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cats = useAsync(fetchCategoryOptions, []);
  const full: ProfileForm = { ...f, highlights: highlights.split('\n') };
  const errors = validateProfile(full);
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: string) => (show && errors[k] ? <span role="alert" style={bad}>{errors[k]}</span> : null);
  const toggle = (code: string) => set('disciplines', f.disciplines.includes(code) ? f.disciplines.filter(c => c !== code) : [...f.disciplines, code]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try { await updateMyFighterProfile(full); onSaved(); } catch (x) { setProblem(friendlyError(x)); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={e => void save(e)} noValidate style={{ display: 'grid', gap: 14 }}>
      <p className="src">Everything here is public. Leave anything you do not want shown empty. Your name comes from your registration.</p>
      <div className="form">
        <label className="field-in">Gender
          <select value={f.gender} onChange={e => set('gender', e.target.value as Gender | '')}>
            <option value="">Not stated</option>
            {GENDERS.map(g => <option key={g} value={g}>{genderLabel(g)}</option>)}
          </select>{err('gender')}
        </label>
        <label className="field-in">Birth year (optional)
          <input inputMode="numeric" value={f.birthYear} onChange={e => set('birthYear', e.target.value)} />{err('birthYear')}
        </label>
        <label className="field-in">Fighting since (year)
          <input inputMode="numeric" value={f.joinedYear} onChange={e => set('joinedYear', e.target.value)} />{err('joinedYear')}
        </label>
      </div>
      <div className="form">
        <label className="field-in">City<input value={f.city} onChange={e => set('city', e.target.value)} />{err('city')}</label>
        <label className="field-in">Province or state<input value={f.region} onChange={e => set('region', e.target.value)} />{err('region')}</label>
        <label className="field-in">Country<input value={f.country} onChange={e => set('country', e.target.value)} />{err('country')}</label>
      </div>
      <label className="field-in">Fighting style
        <input value={f.fightingStyle} onChange={e => set('fightingStyle', e.target.value)} />{err('fightingStyle')}
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend>Disciplines <span className="src">(up to {DISCIPLINES_MAX})</span></legend>
        {cats.error != null && <p role="alert" style={bad}>{friendlyError(cats.error, 'Could not load the disciplines.')}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(cats.data ?? []).map(c => (
            <label key={c.code} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={f.disciplines.includes(c.code)} onChange={() => toggle(c.code)} /> {c.name}
            </label>
          ))}
        </div>
        {err('disciplines')}
      </fieldset>
      <label className="field-in">About you
        <textarea rows={5} value={f.bio} onChange={e => set('bio', e.target.value)} />
        <span>{f.bio.trim().length} of {BIO_MAX} characters.</span>{err('bio')}
      </label>
      <label className="field-in">Highlights (one per line)
        <textarea rows={4} value={highlights} onChange={e => setHighlights(e.target.value)} />
        <span>Up to {HIGHLIGHTS_MAX} lines of at most {HIGHLIGHT_MAX} characters.</span>{err('highlights')}
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }} id="social">
        <legend style={{ fontWeight: 600, marginBottom: 4 }}>Social links <span className="src">(optional, public)</span></legend>
        <SocialLinksEditor value={f.socialLinks} onChange={v => set('socialLinks', v)} idPrefix="fighter-social"
          errors={show ? Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('social:')).map(([k, v]) => [k.slice(7), v])) as Partial<Record<SocialNetwork, string>> : {}} />
      </fieldset>
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <div className="formactions">
        <button type="button" className="btn btn-line" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </div>
    </form>
  );
}
