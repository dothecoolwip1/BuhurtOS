import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { Crest } from '../components/Crest';
import { PageHead } from '../components/ui';
import { fetchTeamBySlug, teamEmblemUrl, type DirectoryEntry } from '../data/teamDirectory';
import {
  CREST_PATTERNS, fetchTeamEditRights, removeTeamEmblem, teamToForm, TEAM_DESCRIPTION_MAX, updateTeamProfile, uploadTeamEmblem, validateTeamEdit, type TeamEditForm
} from '../data/teamEdit';
import { SOCIAL_NETWORKS, type SocialNetwork } from '../data/teamManager';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { addClaimed, editClaimed, MAX_CLAIMED, removeClaimed, setSocial } from '../registration/teamRequest';
import { crestTeam } from './TeamsPage';

const bad: React.CSSProperties = { color: 'var(--live)' };

/** A team's captain (or an organizer) edits the public team page, including its emblem. On a normal page so it scrolls well on a phone. */
export function TeamEditPage() {
  useDocumentTitle('Edit team');
  const { slug = '' } = useParams();
  const { session, loading } = useAuth();
  const team = useAsync(() => fetchTeamBySlug(slug), [slug]);
  const rights = useAsync(() => (team.data && session ? fetchTeamEditRights(team.data.id) : Promise.resolve({ edit: false, rename: false })), [team.data?.id, session?.user.id]);
  if (loading || team.loading || (session && rights.loading)) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Team" title="Edit team" lede="Sign in first." /><SignIn reason="Sign in to edit your team." /></>;
  if (team.error != null || rights.error != null) return <p role="alert" style={bad}>{friendlyError(team.error ?? rights.error, 'Could not load this team.')}</p>;
  if (!team.data || !rights.data?.edit) {
    return (
      <section className="panel info"><h3>You cannot edit this team</h3>
        <p className="muted">Only the team captain, or an organizer, can change the team page.</p>
        <Link className="btn btn-line btn-sm" to={team.data ? `/teams/${slug}` : '/teams'}>Back</Link></section>
    );
  }
  return <Editing t={team.data} canRename={rights.data.rename} />;
}

function Editing({ t, canRename }: { t: DirectoryEntry; canRename: boolean }) {
  const nav = useNavigate();
  const back = `/teams/${t.slug}`;
  const [f, setF] = useState<TeamEditForm>(teamToForm(t));
  const [emblem, setEmblem] = useState(t.emblemPath);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const errors = validateTeamEdit(f, canRename);
  const set = <K extends keyof TeamEditForm>(k: K, v: TeamEditForm[K]) => setF(p => ({ ...p, [k]: v }));
  const err = (k: keyof TeamEditForm) => (show && errors[k] ? <span role="alert" style={bad}>{errors[k]}</span> : null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setShow(true); setProblem(null);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try { await updateTeamProfile(t.id, f, canRename); nav(back); } catch (x) { setProblem(friendlyError(x)); } finally { setBusy(false); }
  };

  const preview = crestTeam({ id: t.id, name: f.name || t.name, colors: f.colors, crestDivision: f.crestDivision, initial: f.initial, emblemPath: emblem });

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18, maxWidth: 640 }}>
      <Link className="more" to={back}>← Back to {t.name}</Link>
      <PageHead eyebrow="Team" title="Edit team" />

      <section className="panel info" style={{ display: 'grid', gap: 14 }} aria-labelledby="crest-h">
        <h2 id="crest-h">Shield and emblem</h2>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <Crest team={preview} size={104} />
          <EmblemControls teamId={t.id} path={emblem} onChange={setEmblem} />
        </div>
        <div className="form">
          <label className="field-in">Pattern
            <select value={f.crestDivision} onChange={e => set('crestDivision', e.target.value)}>{CREST_PATTERNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="field-in">First colour<input type="color" value={f.colors[0]} onChange={e => set('colors', [e.target.value, f.colors[1]])} /></label>
          <label className="field-in">Second colour<input type="color" value={f.colors[1]} onChange={e => set('colors', [f.colors[0], e.target.value])} /></label>
          <label className="field-in">Letter (1 or 2), used when there is no emblem
            <input maxLength={2} value={f.initial} onChange={e => set('initial', e.target.value)} />{err('initial')}
          </label>
        </div>
        <p className="src">The emblem and shield are public. Pattern, colours and letter are saved with the form below; the emblem is saved as soon as you choose it.</p>
      </section>

      <form onSubmit={e => void save(e)} noValidate style={{ display: 'grid', gap: 16 }}>
        <section className="panel info" style={{ display: 'grid', gap: 12 }}>
          <h2>About the team</h2>
          {canRename
            ? <label className="field-in">Team name<input value={f.name} onChange={e => set('name', e.target.value)} />{err('name')}</label>
            : <p className="src">The team name can be changed by an organizer. Its web address, /teams/{t.slug}, never changes.</p>}
          <div className="form">
            <label className="field-in">City<input value={f.city} onChange={e => set('city', e.target.value)} />{err('city')}</label>
            <label className="field-in">Province or state<input value={f.region} onChange={e => set('region', e.target.value)} /></label>
            <label className="field-in">Country<input value={f.country} onChange={e => set('country', e.target.value)} />{err('country')}</label>
          </div>
          <label className="field-in">Description
            <textarea rows={5} value={f.description} onChange={e => set('description', e.target.value)} />
            <span>{f.description.trim().length} of {TEAM_DESCRIPTION_MAX}. Who you are and how you train.</span>{err('description')}
          </label>
          <label className="field-in">Website
            <input type="url" inputMode="url" placeholder="https://" value={f.website} onChange={e => set('website', e.target.value)} />{err('website')}
          </label>
          <label className="field-in">Year founded
            <input inputMode="numeric" value={f.foundedYear} onChange={e => set('foundedYear', e.target.value)} />{err('foundedYear')}
          </label>
        </section>

        <section className="panel info" style={{ display: 'grid', gap: 12 }}>
          <h2>Social links</h2>
          <div className="form">
            {SOCIAL_NETWORKS.map((n: SocialNetwork) => (
              <label key={n} className="field-in" style={{ textTransform: 'capitalize' }}>{n === 'x' ? 'X (Twitter)' : n}
                <input type="url" inputMode="url" placeholder="https://" value={f.socialLinks[n] ?? ''} onChange={e => set('socialLinks', setSocial(f.socialLinks, n, e.target.value))} />
              </label>
            ))}
          </div>
          {err('socialLinks')}
        </section>

        <section className="panel info" style={{ display: 'grid', gap: 10 }}>
          <h2>Organizations you say you belong to</h2>
          <p className="src">Shown on the team page as “claimed, unverified”. Up to {MAX_CLAIMED}.</p>
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
        </section>

        {show && Object.keys(errors).length > 0 && <p role="alert" style={bad}>Some answers need fixing. They are marked above.</p>}
        {problem && <p role="alert" style={bad}>{problem}</p>}
        <div className="formactions">
          <button type="button" className="btn btn-line" disabled={busy} onClick={() => nav(back)}>Cancel</button>
          <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? 'Saving…' : 'Save team'}</button>
        </div>
      </form>
    </section>
  );
}

/** The emblem saves as soon as it is chosen, apart from the form. */
function EmblemControls({ teamId, path, onChange }: { teamId: string; path: string | null; onChange: (p: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setProblem(null);
    try { onChange(await uploadTeamEmblem(teamId, file, path)); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async () => {
    if (!path) return;
    setBusy(true); setProblem(null);
    try { await removeTeamEmblem(teamId, path); onChange(null); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <input ref={input} type="file" accept="image/*" hidden onChange={e => void choose(e.target.files?.[0])} />
      <button type="button" className="btn btn-ink" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Working…' : teamEmblemUrl(path) ? 'Change emblem' : 'Add an emblem'}</button>
      {path && <button type="button" className="btn btn-line" disabled={busy} onClick={() => void remove()}>Remove emblem</button>}
      {problem && <p role="alert" style={bad}>{problem}</p>}
    </div>
  );
}
