import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { PageHead } from '../components/ui';
import { avatarUrl, fetchFighterProfile, fetchMyFighterId, removeMyAvatar, uploadMyAvatar, type FighterProfile } from '../data/fighters';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ProfileEditor } from './ProfileEditor';
import { GallerySection } from './GallerySection';

const bad: React.CSSProperties = { color: 'var(--live)' };

/** The signed-in fighter edits their own public profile on a normal page. The database refuses anyone else. */
export function ProfileEditPage() {
  useDocumentTitle('Edit my profile');
  const { id = '' } = useParams();
  const { session, loading } = useAuth();
  const userId = session?.user.id;
  const mine = useAsync(() => (userId ? fetchMyFighterId() : Promise.resolve(null)), [userId]);
  const profile = useAsync(() => fetchFighterProfile(id), [id]);
  if (loading || (session && (mine.loading || profile.loading))) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Fighter" title="Edit my profile" lede="Sign in first." /><SignIn reason="Sign in to edit your profile." /></>;
  if (mine.error != null || profile.error != null) return <p role="alert" style={bad}>{friendlyError(mine.error ?? profile.error, 'Could not load your profile.')}</p>;
  if (!profile.data || mine.data !== id) {
    return (
      <section className="panel info"><h3>This is not your profile</h3>
        <p className="muted">You can only edit your own fighter profile. It appears once your registration for an event has been accepted.</p>
        <Link className="btn btn-line btn-sm" to={profile.data ? `/fighters/${id}` : '/fighters'}>Back</Link></section>
    );
  }
  return <Editing p={profile.data} />;
}

function Editing({ p }: { p: FighterProfile }) {
  const nav = useNavigate();
  const back = `/fighters/${p.fighterId}`;
  const [avatar, setAvatar] = useState(p.avatarPath);
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18, maxWidth: 640 }}>
      <Link className="more" to={back}>← Back to my profile</Link>
      <PageHead eyebrow="Fighter" title="Edit my profile" />
      <PhotoSection p={p} path={avatar} setPath={setAvatar} />
      <GallerySection fighterId={p.fighterId} avatarPath={avatar} onAvatar={setAvatar} />
      <ProfileEditor profile={p} onCancel={() => nav(back)} onSaved={() => nav(back)} />
    </section>
  );
}

/** The photo saves as soon as it is chosen, apart from the form below. */
function PhotoSection({ p, path, setPath }: { p: FighterProfile; path: string | null; setPath: (p: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const url = avatarUrl(path);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setProblem(null);
    try { setPath(await uploadMyAvatar(p.fighterId, file, path)); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async () => {
    if (!path) return;
    setBusy(true); setProblem(null);
    try { await removeMyAvatar(path); setPath(null); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel info" style={{ display: 'grid', gap: 12 }} aria-labelledby="photo-h">
      <h2 id="photo-h">Profile photo</h2>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {url
          ? <img className="avatar" src={url} alt="Your profile photo" width={120} height={120} />
          : <span className="avatar" aria-hidden="true">{p.displayName.charAt(0).toUpperCase()}</span>}
        <div style={{ display: 'grid', gap: 8 }}>
          <input ref={input} type="file" accept="image/*" hidden onChange={e => void choose(e.target.files?.[0])} />
          <button type="button" className="btn btn-ink" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Working…' : url ? 'Change photo' : 'Add a photo'}</button>
          {url && <button type="button" className="btn btn-line" disabled={busy} onClick={() => void remove()}>Remove photo</button>}
        </div>
      </div>
      <p className="src">Your photo is public. It is shrunk on your phone first, and saved straight away.</p>
      {problem && <p role="alert" style={bad}>{problem}</p>}
    </section>
  );
}
