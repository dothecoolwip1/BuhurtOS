import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { checkinUrl } from '../lib/readiness';

/**
 * The fighter's own check-in code (Pack 16). Desk staff scan it with their phone camera; it opens the staff-only desk with this person at the top.
 * It grants nothing: the desk refuses anyone who is not event staff, and the name search is always the fallback.
 */
export function CheckinCode({ slug, registrationId }: { slug: string; registrationId: string }) {
  const [open, setOpen] = useState(false);
  const url = checkinUrl(window.location.origin, import.meta.env.BASE_URL ?? '/', slug, registrationId);
  const svg = useMemo(() => {
    if (!open) return '';
    try { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch { return ''; }
  }, [open, url]);
  return (
    <details className="desk-more" onToggle={e => setOpen((e.target as HTMLDetailsElement).open)} data-testid="checkin-code">
      <summary>Your check-in code</summary>
      <div className="checkin-qr">
        {/* the markup comes from the QR library for OUR url only */}
        {svg && <div role="img" aria-label="Check-in code for the event desk" dangerouslySetInnerHTML={{ __html: svg }} />}
        <p className="src" style={{ textAlign: 'center' }}>Show this at the check-in desk to be found quickly. It does not check you in by itself, and giving your name works just as well.</p>
      </div>
    </details>
  );
}
