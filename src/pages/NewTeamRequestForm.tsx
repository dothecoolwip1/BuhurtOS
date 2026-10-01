import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestNewTeam, type NewTeamForm, type SocialNetwork } from '../data/teamManager';
import { friendlyError } from '../lib/friendlyError';
import { CLAIMED_LABEL, DESCRIPTION_MAX, MAX_CLAIMED, SOCIAL_NETWORKS, addClaimed, descriptionCounter, editClaimed, effectiveSlug, emptyNewTeamForm, firstErrorField, removeClaimed, setSocial, slugFromName, validateNewTeam } from '../registration/teamRequest';

const bad: React.CSSProperties = { color: 'var(--live)' };
const PATTERNS: [string, string][] = [['pale', 'Vertical stripe'], ['fess', 'Horizontal band'], ['bend', 'Diagonal'], ['chevron', 'Chevron'], ['quarterly', 'Quarters'], ['saltire', 'Cross']];
const DEFAULT_COLORS: [string, string] = ['#2C4A8C', '#E9ECEF'];

/** The whole new-team request. Everything the database asks for, with the reviewer-only part set apart and labelled. */
export function NewTeamRequestForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [f, setF] = useState<NewTeamForm>(emptyNewTeamForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = validateNewTeam(f);

  const set = <K extends keyof NewTeamForm>(k: K, v: NewTeamForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: keyof NewTeamForm) => (show && errors[k] ? <span id={`err-${k}`} role="alert" style={bad}>{errors[k]}</span> : null);
  const inv = (k: keyof NewTeamForm) => ({ 'aria-invalid': Boolean(show && errors[k]), 'aria-describedby': show && errors[k] ? `err-${k}` : undefined });

  if (done) {
    return (
      <div className="fade-in" role="status" style={{ display: 'grid', gap: 8 }}>
        <h3>Request sent</h3>
        <p><b>{done}</b> was sent to the organizers. They review every new team first, and the team stays private until one of them approves it. You are its captain, so you can see it meanwhile.</p>
        <p>You will get a notification when it is approved. Your contact details were shared with the organizers only.</p>
        <p><Link to="/events">Back to events</Link></p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    const first = firstErrorField(errors);
    if (first) { formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(); return; }
    setBusy(true);
    try { await requestNewTeam(f); setDone(f.name.trim()); onSubmitted?.(); } catch (x) { setProblem(friendlyError(x)); } finally { setBusy(false); }
  };

  const colors = f.colors ?? DEFAULT_COLORS;
  const slug = effectiveSlug(f);

  return (
    <form ref={formRef} onSubmit={e => void submit(e)} noValidate style={{ display: 'grid', gap: 16 }}>
      <fieldset style={{ display: 'grid', gap: 12, border: 0, padding: 0, margin: 0 }}>
        <legend><b>About the team</b> <span className="src">(shown publicly once approved)</span></legend>
        <label className="field-in">Team name
          <input name="name" value={f.name} onChange={e => { set('name', e.target.value); if (!slugTouched) set('slug', slugFromName(e.target.value)); }} {...inv('name')} />{err('name')}
        </label>
        <label className="field-in">Web address name
          <input name="slug" value={f.slug} onChange={e => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} autoCapitalize="none" spellCheck={false} {...inv('slug')} />
          <span>Your team page will be at /teams/{slug || 'your-team'}. Lowercase letters, numbers and dashes. If it is taken, add your city.</span>{err('slug')}
        </label>
        <div className="form">
          <label className="field-in">City<input name="city" value={f.city} onChange={e => set('city', e.target.value)} {...inv('city')} />{err('city')}</label>
          <label className="field-in">Province or state (optional)<input name="region" value={f.region} onChange={e => set('region', e.target.value)} /></label>
          <label className="field-in">Country<input name="country" value={f.country} onChange={e => set('country', e.target.value)} {...inv('country')} />{err('country')}</label>
        </div>
        <label className="field-in">Description
          <textarea name="description" rows={4} value={f.description} onChange={e => set('description', e.target.value)} {...inv('description')} />
          <span aria-live="polite" style={f.description.trim().length > DESCRIPTION_MAX ? bad : undefined}>{descriptionCounter(f.description)} (10 to {DESCRIPTION_MAX}). Who you are and how you train.</span>{err('description')}
        </label>
        <label className="field-in">Website (optional)
          <input name="website" type="url" inputMode="url" placeholder="https://" value={f.website} onChange={e => set('website', e.target.value)} {...inv('website')} />{err('website')}
        </label>
        <label className="field-in">Year founded (optional)
          <input name="foundedYear" inputMode="numeric" value={f.foundedYear} onChange={e => set('foundedYear', e.target.value)} {...inv('foundedYear')} />{err('foundedYear')}
        </label>
      </fieldset>

      <fieldset name="socialLinks" tabIndex={-1} style={{ display: 'grid', gap: 10, border: 0, padding: 0, margin: 0 }}>
        <legend><b>Social links</b> <span className="src">(optional, full https:// addresses)</span></legend>
        <div className="form">
          {SOCIAL_NETWORKS.map((n: SocialNetwork) => (
            <label key={n} className="field-in" style={{ textTransform: 'capitalize' }}>{n === 'x' ? 'X (Twitter)' : n}
              <input type="url" inputMode="url" placeholder="https://" value={f.socialLinks[n] ?? ''} onChange={e => set('socialLinks', setSocial(f.socialLinks, n, e.target.value))} />
            </label>
          ))}
        </div>
        {err('socialLinks')}
      </fieldset>

      <fieldset name="claimedOrganizations" tabIndex={-1} style={{ display: 'grid', gap: 10, border: 0, padding: 0, margin: 0 }}>
        <legend><b>Organizations you say you belong to</b> <span className="src">(optional, up to {MAX_CLAIMED})</span></legend>
        <p className="src">These are shown on the team page as “{CLAIMED_LABEL}”. Nobody checks them for you.</p>
        {f.claimedOrganizations.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <label className="field-in" style={{ flex: 1 }}>Organization {i + 1}
              <input value={o} onChange={e => set('claimedOrganizations', editClaimed(f.claimedOrganizations, i, e.target.value))} />
            </label>
            <button type="button" className="btn btn-line" onClick={() => set('claimedOrganizations', removeClaimed(f.claimedOrganizations, i))} aria-label={`Remove organization ${i + 1}`}>Remove</button>
          </div>
        ))}
        {err('claimedOrganizations')}
        {f.claimedOrganizations.length < MAX_CLAIMED && <div><button type="button" className="btn btn-line" onClick={() => set('claimedOrganizations', addClaimed(f.claimedOrganizations))}>Add an organization</button></div>}
      </fieldset>

      <fieldset style={{ display: 'grid', gap: 10, border: 0, padding: 0, margin: 0 }}>
        <legend><b>Crest</b> <span className="src">(optional)</span></legend>
        <div className="form">
          <label className="field-in">Pattern
            <select value={f.crestDivision} onChange={e => set('crestDivision', e.target.value)}>{PATTERNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="field-in">First colour
            <input name="colors" type="color" value={colors[0]} onChange={e => set('colors', [e.target.value, colors[1]])} />
          </label>
          <label className="field-in">Second colour
            <input type="color" value={colors[1]} onChange={e => set('colors', [colors[0], e.target.value])} />
          </label>
          <label className="field-in">Initial (1 or 2 letters)
            <input name="initial" maxLength={2} value={f.initial} onChange={e => set('initial', e.target.value)} {...inv('initial')} />{err('initial')}
          </label>
        </div>
        {err('colors')}
      </fieldset>

      <fieldset className="panel" style={{ display: 'grid', gap: 12, padding: 14, margin: 0, borderColor: 'var(--brass, var(--line))' }}>
        <legend><b>For the organizers only</b> <span className="src">· only organizers see this</span></legend>
        <p className="src">This part is never shown on the team page. It helps a reviewer check the team is real and reach you.</p>
        <label className="field-in">Your contact email
          <input name="contactEmail" type="email" inputMode="email" autoComplete="email" value={f.contactEmail} onChange={e => set('contactEmail', e.target.value)} {...inv('contactEmail')} />{err('contactEmail')}
        </label>
        <label className="field-in">Your phone (optional)
          <input name="contactPhone" type="tel" autoComplete="tel" value={f.contactPhone} onChange={e => set('contactPhone', e.target.value)} {...inv('contactPhone')} />{err('contactPhone')}
        </label>
        <label className="field-in">Why you are the captain
          <textarea name="captainReason" rows={3} value={f.captainReason} onChange={e => set('captainReason', e.target.value)} {...inv('captainReason')} />
          <span>{f.captainReason.trim().length} of 10 to 1000 characters. For example, you run the practices and keep the roster.</span>{err('captainReason')}
        </label>
        <label className="field-in">Notes for the reviewers (optional)
          <textarea name="notes" rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} {...inv('notes')} />{err('notes')}
        </label>
      </fieldset>

      {show && firstErrorField(errors) && <p role="alert" style={bad}>Some answers need fixing. They are marked above.</p>}
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <div><button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Sending…' : 'Send for review'}</button></div>
    </form>
  );
}
