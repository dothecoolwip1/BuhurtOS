import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { cameraOff, cameraOn, fetchCameraState } from '../data/camera';
import { REASONS, bannerLines, type CameraOffReason } from '../lib/cameraOff';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const POLL_MS = 4000;

/**
 * Emergency Camera Off: one big red button for everyone who may protect the broadcast, and a banner for everyone who may see the state.
 * It is a SAFETY control and nothing else: it does not give Take Lyst, scene or music control. Turning the cameras off is one tap on a reason
 * (nobody should have to think in an emergency); turning them back on is a separate, confirmed action that only the head marshal, an event admin
 * or an organizer is offered. The database decides who may do either; this only reflects it. The state refreshes in place (never a loading flash).
 */
export function CameraOffControl({ eventId, compact = false }: { eventId: string; compact?: boolean }) {
  const [tick, setTick] = useState(0);
  const [sheet, setSheet] = useState<'off' | 'on' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const st = useAsync(() => fetchCameraState(eventId), [eventId], [tick]);
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) setTick(n => n + 1); }, POLL_MS);
    const wake = () => setTick(n => n + 1);
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
  }, []);
  const s = st.data;
  if (!s) return null;                                   // not allowed to see it, or not loaded yet: show nothing rather than a disabled button

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); setSheet(null); setTick(n => n + 1); } catch (e) { setErr(friendlyError(e, 'That did not go through. Try again, and tell the head marshal if it keeps failing.')); } finally { setBusy(false); }
  };

  return (
    <div data-testid="camera-off" className={`camoff ${s.active ? 'is-off' : ''}`} role="region" aria-label="Camera safety">
      {s.active && (
        <div className="camoff-banner" role="alert">
          {bannerLines(s).map((l, i) => i === 0 ? <b key={l} className="camoff-title">{l}</b> : <span key={l}>{l}</span>)}
          {s.canRelease && <button type="button" className="btn btn-line camoff-on" disabled={busy} onClick={() => setSheet('on')}>Turn cameras back on</button>}
        </div>
      )}
      {!s.active && s.canActivate && (
        <button type="button" className={`camoff-btn ${compact ? 'compact' : ''}`} onClick={() => setSheet('off')} aria-label="Emergency camera off">CAMERA OFF</button>
      )}
      {st.refreshError != null && <span className="camoff-stale" role="status">Not updating. If you need to, still press the button.</span>}
      {sheet === 'off' && (
        <Dialog title="Turn the cameras off?" variant="drawer" busy={busy} onClose={() => setSheet(null)}>
          <p style={{ marginTop: 0 }}>The stream switches to a safe screen right away. The fight and the scoring carry on. Only the head marshal or an event admin can turn the cameras back on. Tap why:</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {REASONS.map((r, i) => (
              <button key={r.id} type="button" className={`btn ${i === 0 ? 'camoff-btn' : 'btn-line'}`} data-autofocus={i === 0 ? '' : undefined} disabled={busy}
                onClick={() => act(() => cameraOff(eventId, r.id as CameraOffReason))}><b>{r.label}</b> <span className="muted">· {r.hint}</span></button>
            ))}
          </div>
          {err && <p role="alert" className="err">{err}</p>}
        </Dialog>
      )}
      {sheet === 'on' && (
        <Dialog title="Turn the cameras back on?" variant="drawer" busy={busy} onClose={() => setSheet(null)}>
          <p style={{ marginTop: 0 }}>The live camera comes back on the stream. Only do this when it is safe: nothing private or medical is in frame.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <button type="button" className="btn btn-ink" data-autofocus disabled={busy} onClick={() => act(() => cameraOn(eventId))}>Yes, turn the cameras back on</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setSheet(null)}>No, keep them off</button>
          </div>
          {err && <p role="alert" className="err">{err}</p>}
        </Dialog>
      )}
    </div>
  );
}
