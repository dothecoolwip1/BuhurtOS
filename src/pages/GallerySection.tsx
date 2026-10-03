import { useRef, useState } from 'react';
import { addMyGalleryPhoto, fetchGallery, GALLERY_MAX, galleryUrl, moveInList, removeMyGalleryPhoto, reorderMyGallery, type GalleryPhoto } from '../data/gallery';
import { uploadMyAvatar } from '../data/fighters';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const bad: React.CSSProperties = { color: 'var(--live)' };

/**
 * The fighter's own gallery editor: add (shrunk on the phone first), remove, move up or down, and make one the profile photo.
 * Every change saves at once and says so. The database refuses the eleventh photo and anyone else's folder.
 */
export function GallerySection({ fighterId, avatarPath, onAvatar }: { fighterId: string; avatarPath: string | null; onAvatar: (path: string) => void }) {
  const loaded = useAsync(() => fetchGallery(fighterId), [fighterId]);
  const [list, setList] = useState<GalleryPhoto[] | null>(null);
  const photos = list ?? loaded.data ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const full = photos.length >= GALLERY_MAX;

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy('add'); setProblem(null); setDone(null);
    let cur = [...photos]; let added = 0;
    try {
      for (const file of [...files].slice(0, GALLERY_MAX - cur.length)) {
        setProgress(`Preparing ${file.name}…`);
        const p = await addMyGalleryPhoto(fighterId, file, cur.length);
        cur = [...cur, p]; setList(cur); added += 1;
      }
      if (files.length > added) setProblem(`${added} added. A gallery holds at most ${GALLERY_MAX} photos, so the rest were not uploaded.`);
      else setDone(`${added} photo${added === 1 ? '' : 's'} added. ${added ? 'Already on your public page.' : ''}`);
    } catch (e) { setProblem(friendlyError(e, 'Could not add that photo.')); }
    finally { setBusy(null); setProgress(null); if (input.current) input.current.value = ''; }
  };
  const remove = async (p: GalleryPhoto) => {
    setBusy(p.id); setProblem(null); setDone(null);
    try { await removeMyGalleryPhoto(p.id); setList(photos.filter(x => x.id !== p.id)); setDone('Photo removed.'); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(null); }
  };
  const move = async (i: number, delta: -1 | 1) => {
    const next = moveInList(photos, i, delta);
    setBusy('order'); setProblem(null); setDone(null); setList(next);
    try { await reorderMyGallery(next.map(p => p.id)); setDone('Order saved.'); } catch (e) { setList(photos); setProblem(friendlyError(e, 'Could not save the order.')); } finally { setBusy(null); }
  };
  const makeAvatar = async (p: GalleryPhoto) => {
    setBusy(`av-${p.id}`); setProblem(null); setDone(null);
    try {
      const res = await fetch(galleryUrl(p.path));
      if (!res.ok) throw new Error('Could not read that photo.');
      const blob = await res.blob();
      const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
      onAvatar(await uploadMyAvatar(fighterId, file, avatarPath));
      setDone('That photo is now your profile photo.');
    } catch (e) { setProblem(friendlyError(e, 'Could not use that photo as your profile photo.')); } finally { setBusy(null); }
  };

  return (
    <section className="panel info" style={{ display: 'grid', gap: 12 }} aria-labelledby="gallery-h" data-testid="gallery-section">
      <h2 id="gallery-h">Gallery <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>({photos.length} of {GALLERY_MAX})</span></h2>
      <p className="src">Public photos of you in action. Each is shrunk on your phone before upload (about 1800 px on the long side, camera metadata removed) and saved straight away.</p>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => void add(e.target.files)} data-testid="gallery-input" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-ink" disabled={busy !== null || full} onClick={() => input.current?.click()} data-testid="gallery-add">{busy === 'add' ? 'Adding…' : full ? 'Gallery full' : 'Add photos'}</button>
        {full && <span className="src">Remove a photo to add another.</span>}
        {progress && <span className="src" role="status">{progress}</span>}
      </div>
      {loaded.error != null && <p role="alert" style={bad}>{friendlyError(loaded.error, 'Could not load your gallery.')}</p>}
      {photos.length > 0 && (
        <ul className="gallerygrid" aria-label="Your gallery, in order">
          {photos.map((p, i) => (
            <li key={p.id} data-testid="gallery-item">
              <span className="thumb"><img src={galleryUrl(p.path)} alt={`Gallery photo ${i + 1}`} loading="lazy" /></span>
              <span className="thumb-acts">
                <button type="button" className="btn btn-line" disabled={busy !== null || i === 0} aria-label={`Move photo ${i + 1} earlier`} onClick={() => void move(i, -1)}>↑</button>
                <button type="button" className="btn btn-line" disabled={busy !== null || i === photos.length - 1} aria-label={`Move photo ${i + 1} later`} onClick={() => void move(i, 1)}>↓</button>
                <button type="button" className="btn btn-line" disabled={busy !== null} aria-label={`Use photo ${i + 1} as profile photo`} onClick={() => void makeAvatar(p)}>Profile photo</button>
                <button type="button" className="btn btn-line" disabled={busy !== null} aria-label={`Remove photo ${i + 1}`} onClick={() => { if (window.confirm('Remove this photo from your gallery?')) void remove(p); }}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {done && <p role="status" style={{ color: 'var(--win)', margin: 0 }}>{done}</p>}
      {problem && <p role="alert" style={bad}>{problem}</p>}
    </section>
  );
}
