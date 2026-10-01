import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDisciplineOptions, fetchMyFighterId } from '../../data/accountApi';
import {
  BIO_MAX, GENDERS, HANDEDNESS, HIGHLIGHTS_MAX, HIGHLIGHT_MAX, DISCIPLINES_MAX, NICKNAME_MAX, PRONOUNS_MAX, SOCIAL_NETWORKS, fetchFighterProfile, profileToForm, sportsToForm,
  updateMyFighterProfile, validateProfile, validateSports, type FighterProfile, type ProfileForm, type SportsForm, type SocialNetwork
} from '../../data/fighters';
import { friendlyError } from '../../lib/friendlyError';
import { PUBLIC_COPY, visibilitySummary } from '../../lib/accountView';
import { useAsync } from '../../lib/useAsync';
import { Counter, Err, Notice } from './shared';

const NETWORK_NAME: Record<SocialNetwork, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', discord: 'Discord', twitch: 'Twitch', other: 'Other link' };
const HAND_NAME = { left: 'Left', right: 'Right', ambi: 'Either (ambidextrous)' } as const;

/** Loads the signed-in person's fighter record and shows the sports profile editor, or explains why there is none yet. */
export function ProfileTab({ userId }: { userId: string }) {
  const me = useAsync(() => fetchMyFighterId(userId), [userId]);
  const profile = useAsync(async () => (me.data ? fetchFighterProfile(me.data) : null), [me.data]);
  const options = useAsync(fetchDisciplineOptions, []);
  if (me.loading || profile.loading) return <p className="muted">Loading your profile…</p>;
  if (me.error != null) return <p role="alert">{friendlyError(me.error, 'Could not load your profile.')}</p>;
  if (!me.data || !profile.data) return <NoFighter />;
  return <Editor p={profile.data} options={options.data ?? []} />;
}

export function NoFighter() {
  return (
    <section className="panel info acct-card">
      <h2>Your player profile</h2>
      <p>Your public profile appears once you join a team or register for an event. Until then there is nothing to show here.</p>
      <p className="muted">You can still save your medical and emergency information on the Medical tab. It will fill in your registration forms.</p>
      <div className="acct-row"><Link className="btn btn-ink" to="/team-manager">Join a team</Link><Link className="btn btn-line" to="/events">Find an event</Link></div>
    </section>
  );
}

function Editor({ p, options }: { p: FighterProfile; options: { code: string; name: string; league: string }[] }) {
  const [pf, setPf] = useState<ProfileForm>(() => profileToForm(p));
  const [sf, setSf] = useState<SportsForm>(() => sportsToForm(p));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [show, setShow] = useState(false);
  const errors = { ...validateProfile(pf), ...validateSports(sf) };
  const setP = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => { setPf(x => ({ ...x, [k]: v })); setMsg(null); };
  const setS = <K extends keyof SportsForm>(k: K, v: SportsForm[K]) => { setSf(x => ({ ...x, [k]: v })); setMsg(null); };
  const shown = (k: string) => (show ? errors[k] : undefined);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setShow(true);
    if (Object.keys(errors).length) { setMsg({ kind: 'bad', text: `Please fix the ${Object.keys(errors).length} highlighted item(s).` }); return; }
    setBusy(true); setMsg(null);
    try { await updateMyFighterProfile(pf, sf); setMsg({ kind: 'ok', text: 'Saved. Your profile is up to date.' }); }
    catch (err) { setMsg({ kind: 'bad', text: friendlyError(err, 'Could not save your profile.') }); }
    finally { setBusy(false); }
  };
  const toggleDiscipline = (code: string) => setP('disciplines', pf.disciplines.includes(code) ? pf.disciplines.filter(c => c !== code) : [...pf.disciplines, code]);
  const leagues = [...new Set(options.map(o => o.league))];
  const text = (label: string, value: string, set: (v: string) => void, key: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field-in">{label}<input value={value} onChange={e => set(e.target.value)} aria-invalid={!!shown(key)} {...extra} /><Err m={shown(key)} /></label>
  );

  return (
    <form onSubmit={save} noValidate className="acct-stack">
      <section className="panel info acct-card">
        <h2>Who can see your profile</h2>
        <label className="acct-switch"><input type="checkbox" role="switch" checked={sf.profilePublic} onChange={e => setS('profilePublic', e.target.checked)} />
          <span><b>Make my profile public</b><br /><span className="muted">{sf.profilePublic ? PUBLIC_COPY.public : PUBLIC_COPY.hidden}</span></span></label>
        <p className="muted">Showing now: {visibilitySummary(sf).join(' · ')}.</p>
        <p><Link className="more" to={`/fighters/${p.fighterId}`}>See my public page →</Link></p>
      </section>

      <section className="panel info acct-card">
        <h2>About you</h2>
        {text('Nickname', sf.nickname, v => setS('nickname', v), 'nickname', { maxLength: NICKNAME_MAX + 10, placeholder: 'What your teammates call you' })}
        <label className="field-in">Bio (what you want people to know)
          <textarea rows={5} value={pf.bio} onChange={e => setP('bio', e.target.value)} aria-invalid={!!shown('bio')} />
          <Counter value={pf.bio} max={BIO_MAX} /><Err m={shown('bio')} />
        </label>
        {text('Fighting style', pf.fightingStyle, v => setP('fightingStyle', v), 'fightingStyle', { placeholder: 'For example: aggressive, sword and shield' })}
        <fieldset className="acct-fieldset"><legend>Disciplines you fight in (up to {DISCIPLINES_MAX})</legend>
          {options.length === 0 && <p className="muted">The list of disciplines could not be loaded.</p>}
          {leagues.map(l => (
            <div key={l} className="acct-checks">{options.filter(o => o.league === l).map(o => (
              <label key={o.code} className="acct-check"><input type="checkbox" checked={pf.disciplines.includes(o.code)} onChange={() => toggleDiscipline(o.code)} /> {o.name}</label>
            ))}</div>
          ))}
          <Err m={shown('disciplines')} />
        </fieldset>
      </section>

      <section className="panel info acct-card">
        <h2>Where you are from</h2>
        <div className="acct-grid">
          {text('City', pf.city, v => setP('city', v), 'city', { autoComplete: 'address-level2' })}
          {text('Province or region', pf.region, v => setP('region', v), 'region', { autoComplete: 'address-level1' })}
          {text('Country', pf.country, v => setP('country', v), 'country', { autoComplete: 'country-name' })}
        </div>
        <div className="acct-grid">
          <label className="field-in">Gender
            <select value={pf.gender} onChange={e => setP('gender', e.target.value as ProfileForm['gender'])}>
              <option value="">Prefer not to say</option>{GENDERS.map(g => <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
            </select><Err m={shown('gender')} />
          </label>
          {text('Pronouns', sf.pronouns, v => setS('pronouns', v), 'pronouns', { maxLength: PRONOUNS_MAX + 10, placeholder: 'for example she/her' })}
          {text('Fighting since (year)', pf.joinedYear, v => setP('joinedYear', v), 'joinedYear', { inputMode: 'numeric', maxLength: 4 })}
        </div>
      </section>

      <section className="panel info acct-card">
        <h2>Sports card</h2>
        <div className="acct-grid">
          <label className="field-in">Handedness
            <select value={sf.handedness} onChange={e => setS('handedness', e.target.value as SportsForm['handedness'])}>
              <option value="">Not set</option>{HANDEDNESS.map(h => <option key={h} value={h}>{HAND_NAME[h]}</option>)}
            </select><Err m={shown('handedness')} />
          </label>
          {text('Jersey number', sf.jerseyNumber, v => setS('jerseyNumber', v), 'jerseyNumber', { inputMode: 'numeric', maxLength: 3 })}
        </div>
        <div className="acct-grid">
          {text('Height (cm)', sf.heightCm, v => setS('heightCm', v), 'heightCm', { inputMode: 'numeric', maxLength: 3 })}
          {text('Weight (kg)', sf.weightKg, v => setS('weightKg', v), 'weightKg', { inputMode: 'decimal', maxLength: 5 })}
        </div>
        <label className="acct-switch"><input type="checkbox" role="switch" checked={sf.showPhysical} onChange={e => setS('showPhysical', e.target.checked)} />
          <span><b>Show my height and weight on my public page</b><br /><span className="muted">Off means only you can see them.</span></span></label>
        {text('Birth year', pf.birthYear, v => setP('birthYear', v), 'birthYear', { inputMode: 'numeric', maxLength: 4 })}
        <label className="acct-switch"><input type="checkbox" role="switch" checked={sf.showAge} onChange={e => setS('showAge', e.target.checked)} />
          <span><b>Show my age on my public page</b><br /><span className="muted">Only your age is shown, never your birth year. Off means only you can see it.</span></span></label>
      </section>

      <section className="panel info acct-card">
        <h2>Links</h2>
        <p className="muted">Full addresses starting with https://</p>
        {SOCIAL_NETWORKS.map(n => (
          <label key={n} className="field-in">{NETWORK_NAME[n]}
            <input type="url" inputMode="url" value={sf.socialLinks[n] ?? ''} placeholder="https://" autoComplete="off"
              onChange={e => setS('socialLinks', { ...sf.socialLinks, [n]: e.target.value })} />
          </label>
        ))}
        <Err m={shown('socialLinks')} />
      </section>

      <section className="panel info acct-card">
        <h2>Highlights</h2>
        <p className="muted">Short lines about your best moments. Up to {HIGHLIGHTS_MAX}.</p>
        {pf.highlights.map((h, i) => (
          <div key={i} className="acct-row">
            <label className="field-in" style={{ flex: 1 }}><span className="sr-only">Highlight {i + 1}</span>
              <input value={h} maxLength={HIGHLIGHT_MAX + 20} onChange={e => setP('highlights', pf.highlights.map((x, j) => (j === i ? e.target.value : x)))} />
            </label>
            <button type="button" className="btn btn-line" aria-label={`Remove highlight ${i + 1}`} onClick={() => setP('highlights', pf.highlights.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        {pf.highlights.length < HIGHLIGHTS_MAX && <button type="button" className="btn btn-line" onClick={() => setP('highlights', [...pf.highlights, ''])}>Add a highlight</button>}
        <Err m={shown('highlights')} />
      </section>

      <div className="acct-savebar">
        <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save my profile'}</button>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </div>
    </form>
  );
}
