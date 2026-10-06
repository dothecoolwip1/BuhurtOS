import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog } from './Dialog';
import { CameraOffControl } from './CameraOffControl';
import { canActivateCameraOff, accessEndsLabel, roleLabel } from '../lib/deviceRoutes';
import { deviceManager } from '../lib/deviceSession';
import '../styles/device.css';

/** A small icon per role, so the role is not told by colour alone (the words are always there too). */
const ICON: Record<string, React.ReactNode> = {
  counter: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M8 10l4-3 4 3" /></>,
  scorekeeper: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  marshal: <><path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6Z" /><path d="M9 12l2 2 4-4" /></>,
  announcer: <><path d="M4 10v4h3l5 4V6L7 10Z" /><path d="M16 9a4 4 0 0 1 0 6" /></>,
  temporary_organizer: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21c0-4 3.1-6.5 7-6.5s7 2.5 7 6.5" /><path d="M17 4l1 2 2 .3-1.5 1.5.4 2.2L17 9l-1.9 1 .4-2.2L14 6.3l2-.3Z" /></>
};

/**
 * The bar every temporary event device shows on every screen (Pack 18.1): what this phone or tablet IS, so nobody mistakes it for a person's account.
 * Event name, "Temporary Device", the device's label, its role in plain words, when its access ends (the event's clock), a confirmed sign-out, and
 * the Camera Off control for the roles that may press it. There is no account, profile or setup link anywhere in device mode, and the code that signed
 * this device in is never shown again.
 */
export function DeviceBar() {
  const mgr = deviceManager();
  const w = useSyncExternalStore(mgr.subscribe, () => mgr.getWhoami());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // The screens below size themselves to the space left (a counter's one-screen layout), so they need to know how tall this bar is.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--device-bar-h', `${el.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!w) return null;
  const out = async () => { setBusy(true); await mgr.signOut(); };
  return (
    <header ref={ref} className="device-bar" data-testid="device-bar" aria-label="Temporary device">
      <div className="db-row">
        <svg className="db-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[w.role] ?? ICON.marshal}</svg>
        <b className="db-event" data-testid="device-event">{w.event.name}</b>
        <span className="db-tag" data-testid="device-tag">Temporary Device</span>
      </div>
      <p className="db-meta">
        <span data-testid="device-label">{w.label}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="device-role">Role: {roleLabel(w.role)}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="device-ends">{accessEndsLabel(w.expires_at, w.event.timezone)}</span>
      </p>
      <div className="db-actions">
        {canActivateCameraOff(w.role) && <CameraOffControl eventId={w.event.id} compact />}
        <button type="button" className="btn btn-line btn-sm db-out" onClick={() => setConfirm(true)}>Sign out this device</button>
      </div>
      {confirm && (
        <Dialog title="Sign out this device?" variant="drawer" busy={busy} onClose={() => setConfirm(false)}>
          <p style={{ marginTop: 0 }}>This {w.label} will stop working for {w.event.name} until the organizer gives you a new code.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <button type="button" className="btn btn-ink" data-autofocus disabled={busy} onClick={() => void out()}>Yes, sign out this device</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirm(false)}>No, stay signed in</button>
          </div>
        </Dialog>
      )}
    </header>
  );
}
