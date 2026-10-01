import { useRef, useState } from 'react';
import { CAPTION_MAX, MAX_PHOTOS, fetchFighterPhotos, photoUrl, removeMyPhoto, setMyPrimaryPhoto, uploadMyPhoto, validateCaption, validatePhotoFile, type FighterPhoto } from '../../data/account';
import { fetchMyFighterId } from '../../data/accountApi';
import { Dialog } from '../../components/Dialog';
import { pickError } from '../../lib/accountView';
import { friendlyError } from '../../lib/friendlyError';
import { downscaleImage } from '../../lib/imageResize';
import { useAsync } from '../../lib/useAsync';
import { NoFighter } from './ProfileTab';
import { Counter, Err, Notice } from './shared';

export function PhotosTab({ userId }: { userId: string }) {
  const me = useAsync(() => fetchMyFighterId(userId), [userId]);
  if (me.loading) return <p className="muted">Loading your photos…</p>;
  if (me.error != null) return <p role="alert">{friendlyError(me.error, 'Could not load your photos.')}</p>;
  if (!me.data) return <NoFighter />;
  return <Photos userId={userId} fighterId={me.data} />;
}

function Photos({ userId, fighterId }: { userId: string; fighterId: string }) {
  const [version, setVersion] = useState(0);
  const photos = useAsync(() => fetchFighterPhotos(fighterId), [fighterId, version]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [removing, setRemoving] = useState<FighterPhoto | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = photos.data ?? [];
  const full = list.length >= MAX_PHOTOS;
  const captionError = validateCaption(caption);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (full) { setMsg({ kind: 'bad', text: `You can have up to ${MAX_PHOTOS} photos. Remove one first.` }); return; }
    const early = pickError(file);
    if (early) { setMsg({ kind: 'bad', text: early }); return; }
    if (captionError) { setMsg({ kind: 'bad', text: captionError }); return; }
    setBusy(true); setMsg(null);
    try {
      const small = await downscaleImage(file);
      const bad = validatePhotoFile(small);
      if (bad) throw new Error(bad);
      await uploadMyPhoto(userId, small, caption);
      setCaption(''); setVersion(v => v + 1);
      setMsg({ kind: 'ok', text: 'Photo added.' });
    } catch (e) { setMsg({ kind: 'bad', text: friendlyError(e, 'Could not upload that photo. Check your connection and try again.') }); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const makePrimary = async (p: FighterPhoto) => {
    setBusy(true); setMsg(null);
    try { await setMyPrimaryPhoto(p.id); setVersion(v => v + 1); setMsg({ kind: 'ok', text: 'That is now your profile photo.' }); }
    catch (e) { setMsg({ kind: 'bad', text: friendlyError(e, 'Could not change your profile photo.') }); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true); setMsg(null);
    try { await removeMyPhoto(removing.id); setRemoving(null); setVersion(v => v + 1); setMsg({ kind: 'ok', text: 'Photo removed.' }); }
    catch (e) { setRemoving(null); setMsg({ kind: 'bad', text: friendlyError(e, 'Could not remove that photo.') }); }
    finally { setBusy(false); }
  };

  return (
    <div className="acct-stack">
      <section className="panel info acct-card">
        <h2>Add a photo</h2>
        <p className="muted">JPEG, PNG or WebP. Large pictures are made smaller on your device before they upload. You can have up to {MAX_PHOTOS} photos, {list.length} so far. The first one you add becomes your profile photo.</p>
        <label className="field-in">Caption (optional)
          <input value={caption} onChange={e => setCaption(e.target.value)} maxLength={CAPTION_MAX + 20} aria-invalid={!!captionError} />
          <Counter value={caption} max={CAPTION_MAX} /><Err m={captionError ?? undefined} />
        </label>
        <input ref={input} id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy || full} onChange={e => void pick(e.target.files?.[0])} />
        <label htmlFor="photo-file" className={`btn btn-ink acct-bigbtn${busy || full ? ' disabled' : ''}`} role="button">{busy ? 'Working…' : full ? 'Photo limit reached' : 'Choose a photo'}</label>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </section>

      <section className="panel info acct-card">
        <h2>Your photos</h2>
        {photos.loading && <p className="muted">Loading…</p>}
        {photos.error != null && <p role="alert">{friendlyError(photos.error, 'Could not load your photos.')}</p>}
        {!photos.loading && !photos.error && list.length === 0 && <p className="muted">You have no photos yet.</p>}
        <ul className="acct-gallery">
          {list.map(p => (
            <li key={p.id} className="acct-photo">
              <img src={photoUrl(p.path) ?? ''} alt={p.caption ?? (p.isPrimary ? 'Your profile photo' : 'Your photo')} loading="lazy" />
              {p.isPrimary && <span className="chip brass">Profile photo</span>}
              {p.caption && <span className="muted">{p.caption}</span>}
              <div className="acct-row">
                {!p.isPrimary && <button type="button" className="btn btn-line" disabled={busy} onClick={() => void makePrimary(p)}>Use as profile photo</button>}
                <button type="button" className="btn btn-line" disabled={busy} onClick={() => setRemoving(p)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {removing && (
        <Dialog title="Remove this photo?" onClose={() => setRemoving(null)} busy={busy}>
          <img className="acct-confirm-img" src={photoUrl(removing.path) ?? ''} alt="" />
          <p>It will be deleted from your profile.</p>
          <div className="acct-row">
            <button type="button" className="btn btn-ink" data-autofocus disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Yes, remove it'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setRemoving(null)}>Keep it</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
