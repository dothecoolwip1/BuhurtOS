import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchGallery, galleryUrl, type GalleryPhoto } from '../data/gallery';
import { useAsync } from '../lib/useAsync';

/** The public gallery: shown only when there is at least one photo. Two columns on a phone, four wider. Tap opens the viewer. */
export function FighterGallery({ fighterId, name }: { fighterId: string; name: string }) {
  const photos = useAsync(() => fetchGallery(fighterId), [fighterId]);
  const [open, setOpen] = useState<number | null>(null);
  const list = photos.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="panel info" aria-labelledby="gal-h" data-testid="fighter-gallery">
      <h3 id="gal-h">Gallery <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>({list.length})</span></h3>
      <ul className="gallerygrid">
        {list.map((p, i) => (
          <li key={p.id}>
            <button type="button" className="thumb" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1} of ${list.length}`}>
              <img src={galleryUrl(p.path)} alt={`${name}, photo ${i + 1}`} loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <Lightbox photos={list} index={open} name={name} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Full-screen viewer: swipe or arrow keys to move, Escape or the button to close. */
export function Lightbox({ photos, index, name, onIndex, onClose }: { photos: GalleryPhoto[]; index: number; name: string; onIndex: (i: number) => void; onClose: () => void }) {
  const startX = useRef<number | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const prev = () => onIndex((index - 1 + photos.length) % photos.length);
  const next = () => onIndex((index + 1) % photos.length);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowLeft') prev(); else if (e.key === 'ArrowRight') next(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; opener?.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  const p = photos[index];
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name}, photo ${index + 1} of ${photos.length}`} data-testid="lightbox"
      onTouchStart={e => { startX.current = e.touches[0].clientX; }}
      onTouchEnd={e => { if (startX.current === null) return; const dx = e.changedTouches[0].clientX - startX.current; startX.current = null; if (dx > 50) prev(); else if (dx < -50) next(); }}>
      <div className="lb-top"><span>{index + 1} / {photos.length}</span><button ref={closeBtn} type="button" onClick={onClose} aria-label="Close">Close</button></div>
      <img src={galleryUrl(p.path)} alt={`${name}, photo ${index + 1}`} onClick={next} />
      <div className="lb-bottom">
        <button type="button" onClick={prev} disabled={photos.length < 2} aria-label="Previous photo">‹ Previous</button>
        <button type="button" onClick={next} disabled={photos.length < 2} aria-label="Next photo">Next ›</button>
      </div>
    </div>,
    document.body
  );
}
