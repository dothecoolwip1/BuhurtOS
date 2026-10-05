import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/friendlyError';
import { askDismissed, currentSubscription, currentSupport, dismissAsk, enablePush, permissionState } from '../lib/push';
import { installHelp, platformOf } from '../lib/pushSupport';

/**
 * The contextual ask, shown where it makes sense (a fighter looking at their own fights): says what alerts are for first, and only the button
 * press asks the browser. "Not now" is remembered. Hidden when alerts are already on, blocked, impossible here or recently declined.
 */
export function PushAsk() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [state, setState] = useState<'checking' | 'show' | 'hide' | 'done'>('checking');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const support = currentSupport();

  useEffect(() => {
    let live = true;
    void (async () => {
      const sub = support === 'ready' ? await currentSubscription() : null;
      if (!live) return;
      const blocked = permissionState() === 'denied' || support === 'unsupported' || askDismissed() || (sub !== null && permissionState() === 'granted');
      setState(blocked ? 'hide' : 'show');
    })();
    return () => { live = false; };
  }, [support]);

  if (!userId || state === 'checking' || state === 'hide') return null;
  if (state === 'done') return <p role="status" className="src" style={{ margin: 0 }}>Alerts are on. You can change this in Account → Notifications.</p>;
  const ios = support === 'needs-install';
  const turnOn = async () => {
    setBusy(true); setProblem(null);
    try {
      const r = await enablePush(userId);
      if (r === 'enabled') setState('done'); else { dismissAsk(); setState('hide'); }   // a "no" is respected: no repeat prompt
    } catch (e) { setProblem(friendlyError(e, 'Could not turn alerts on.')); } finally { setBusy(false); }
  };
  return (
    <div role="region" aria-label="Alerts" style={{ display: 'grid', gap: 8, padding: '12px 14px', borderRadius: 10, background: 'var(--raised)', border: '1px solid var(--line)' }}>
      <b>Want BuhurtOS to tell you when you're coming up to fight?</b>
      {ios
        ? <><span className="muted">On iPhone, alerts work from the Home Screen app. {installHelp(platformOf(navigator.userAgent, navigator.maxTouchPoints)).steps.slice(0, 2).join(' ')}</span><div><button type="button" className="btn btn-line btn-sm" onClick={() => { dismissAsk(); setState('hide'); }}>Got it</button></div></>
        : <>
            <span className="muted">A short message when you are 2 fights away, up next and when your fight is ready, even with BuhurtOS closed. Turn it off any time.</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => void turnOn()}>{busy ? 'Turning on…' : 'Turn on alerts'}</button>
              <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => { dismissAsk(); setState('hide'); }}>Not now</button>
            </div>
          </>}
      {problem && <span role="alert" style={{ color: 'var(--live)' }}>{problem}</span>}
    </div>
  );
}
