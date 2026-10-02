import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog (or a side drawer / bottom sheet with variant="drawer"). Focus moves in, Tab stays inside, Escape closes, focus returns
 * to what opened it, and the page behind does not scroll. Rendered only while open, so callers write `{open && <Dialog ...>}`.
 */
export function Dialog({ title, onClose, children, variant = 'dialog', busy = false }: {
  title: string; onClose: () => void; children: ReactNode; variant?: 'dialog' | 'drawer'; busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const items = () => (node ? [...node.querySelectorAll<HTMLElement>(FOCUSABLE)] : []);
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0] ?? node)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (!busyRef.current) closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) { e.preventDefault(); node?.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node?.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !node?.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className={`dlg-bg ${variant}`} onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} className="dlg panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="dlg-head">
          <h2 id={titleId}>{title}</h2>
          {variant === 'drawer' && <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>}
        </div>
        <div className="dlg-body">{children}</div>
      </div>
    </div>
  );
}
