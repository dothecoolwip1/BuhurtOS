import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { formatTyping, normalizeDeviceCode } from '../lib/deviceCode';
import { landingFor } from '../lib/deviceRoutes';
import { captureFragment, deviceManager, ENDED_MESSAGE, isDeviceMode, setNoReferrer, takePendingCode } from '../lib/deviceSession';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import '../styles/device.css';

/**
 * `/device`: a temporary event device signs in once with the code the organizer gave it (typed, or scanned from a QR that opens
 * `/device#c=XXXXXXXXXXXX`). The address bar's fragment was already taken off the address when the app started (src/lib/deviceSession.ts), so the
 * code is in memory only and goes out in ONE POST body. It is never put in a URL, a query string, the console, analytics or an error message,
 * and it is never shown again after sign-in. A wrong, expired or withdrawn code all read the same.
 */
export function DeviceSignInPage() {
  useDocumentTitle('Sign in this device');
  const mgr = deviceManager();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended] = useState(() => mgr.takeEndedNote());
  // A QR scan on a device that is already signed in: ask before replacing the session.
  const [scanned] = useState<string | null>(() => takePendingCode());
  const already = isDeviceMode();
  const [ask, setAsk] = useState(scanned !== null && already);
  const started = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { setNoReferrer(); }, []);

  async function go(code: string) {
    setBusy(true); setError(null);
    const r = await mgr.signIn(code);
    if (!r.ok) { setBusy(false); setError(r.message); setTyped(''); input.current?.focus(); return; }
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
    window.location.replace(`${base}${landingFor({ role: r.whoami.role, slug: r.whoami.event.slug })}`);   // a full page load: the app is built once per mode
  }

  // A scanned code signs in at once (nothing to type).
  useEffect(() => {
    if (scanned && !already && !started.current) { started.current = true; void go(scanned); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // The QR link can also arrive as a hash change on this very page (a phone that was just signed out scans the Counter QR again): same thing, no reload.
  useEffect(() => {
    const onHash = () => {
      captureFragment(window.location, window.history);
      const code = takePendingCode();
      if (!code) return;
      if (isDeviceMode()) { setAsk(true); return; }
      if (!started.current) { started.current = true; void go(code); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const w = mgr.getWhoami();
  if (already && !ask && w) return <Navigate to={landingFor({ role: w.role, slug: w.event.slug })} replace />;

  const submit = (e: FormEvent) => { e.preventDefault(); const c = normalizeDeviceCode(typed); if (!c) { setError('Enter all 12 characters of the code.'); return; } void go(c); };

  if (ask && w) {
    return (
      <main className="device-signin">
        <h1>Switch this device?</h1>
        <p>This device is signed in as <b>{w.label}</b> for <b>{w.event.name}</b>. Signing out ends that. Then scan the new code again.</p>
        <button type="button" className="btn btn-ink ds-go" disabled={busy} onClick={() => void mgr.signOut()}>Sign out and use the new code</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={() => setAsk(false)}>Stay signed in</button>
      </main>
    );
  }
  return (
    <main className="device-signin" aria-labelledby="ds-h">
      <h1 id="ds-h">Sign in this device</h1>
      {ended && <p className="panel info ds-ended" role="alert"><b>{ENDED_MESSAGE}</b> Ask the organizer for a new code.</p>}
      <p>Enter the 12-character code the organizer gave this phone or tablet, or scan its QR code. You only do this once; the device stays signed in until the event is over.</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label htmlFor="ds-code" className="sr-only">Device code</label>
        <input id="ds-code" ref={input} className="ds-code" name="device-code" value={typed} onChange={e => setTyped(formatTyping(e.target.value))}
          inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" maxLength={14} disabled={busy} aria-describedby={error ? 'ds-err' : undefined} />
        <button type="submit" className="btn btn-ink ds-go" disabled={busy || !normalizeDeviceCode(typed)}>{busy ? 'Signing in…' : 'Sign in this device'}</button>
      </form>
      {error && <p id="ds-err" role="alert" className="ds-error">{error}</p>}
      <p className="src">This is not a personal account. A temporary device has no profile and cannot see anyone's private details.</p>
    </main>
  );
}
