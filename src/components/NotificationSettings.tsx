import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  ALL_ON, CATEGORY_LABEL, fetchNotificationSettings, fetchPushDevices, removePushDevice, saveNotificationSettings, sendTestNotification,
  type NotificationCategory, type NotificationSettings as Settings, type PushDevice
} from '../data/notifications';
import { friendlyError } from '../lib/friendlyError';
import { useInstall } from '../lib/install';
import { currentSubscription, currentSupport, disablePush, enablePush, endpointDigest, permissionState } from '../lib/push';
import { installHelp, permissionLabel } from '../lib/pushSupport';
import { timeAgo } from '../lib/notificationView';

const GROUPS: NotificationCategory[] = ['fights', 'team', 'events', 'system'];

/**
 * Notification settings: whether THIS device gets alerts, which of four groups are wanted, and the person's devices. Browser permission is only
 * ever requested from the "Turn on alerts" button, after saying what it is for. A "no" from the browser leaves the app working exactly as before.
 */
export function NotificationSettings() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const support = currentSupport();
  const install = useInstall();
  const [perm, setPerm] = useState(permissionState());
  const [thisDigest, setThisDigest] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(ALL_ON);
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([fetchNotificationSettings(), fetchPushDevices()]);
      setSettings(s); setDevices(d); setPerm(permissionState());
    } catch (e) { setProblem(friendlyError(e, 'Could not load your notification settings.')); }
    // This browser's own subscription is looked up separately: it can take a moment (or never come, without a service worker) and must not
    // hold up the settings and device list.
    const sub = await currentSubscription();
    setThisDigest(sub ? await endpointDigest(sub.endpoint) : null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const thisOn = devices?.some(d => d.endpointDigest === thisDigest) === true && perm === 'granted';
  // Two different switches, shown apart so nobody confuses them: what the BROWSER allows, and whether BuhurtOS is sending to this device.
  const permText = permissionLabel(support, perm);

  const turnOn = async () => {
    setBusy(true); setProblem(null); setSaved(null);
    try {
      const r = await enablePush(userId);
      if (r === 'denied') setSaved(null);
      if (r === 'unavailable') setProblem('Alerts are not ready on this device yet. Try again in a minute.');
      await load();
      if (r === 'enabled') setSaved('Alerts are on for this device.');
    } catch (e) { setProblem(friendlyError(e, 'Could not turn alerts on.')); } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true); setProblem(null); setSaved(null);
    try { await disablePush(userId); await load(); setSaved('Alerts are off for this device.'); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setProblem(null); setSaved(null);
    try { await sendTestNotification(); setSaved('Test sent. It should arrive in a few seconds. If nothing shows up, check your phone\'s notification settings for BuhurtOS.'); }
    catch (e) { setProblem(friendlyError(e, 'Could not send a test.')); } finally { setBusy(false); }
  };
  const toggle = async (k: NotificationCategory, on: boolean) => {
    const next = { ...settings, [k]: on };
    setSettings(next); setProblem(null); setSaved(null);
    try { setSettings(await saveNotificationSettings(next)); setSaved('Saved.'); }
    catch (e) { setSettings(settings); setProblem(`Not saved: ${friendlyError(e, 'could not save that change.')}`); }
  };
  const remove = async (d: PushDevice) => {
    setProblem(null); setSaved(null);
    try {
      if (d.endpointDigest === thisDigest) await disablePush(userId); else await removePushDevice({ id: d.id });
      await load(); setSaved(`${d.label} removed.`);
    } catch (e) { setProblem(friendlyError(e, 'Could not remove that device.')); }
  };

  return (
    <section aria-labelledby="notif-set-h" id="notifications" style={{ display: 'grid', gap: 10, scrollMarginTop: 90 }}>
      <h2 id="notif-set-h" className="acct-h">Notifications</h2>
      <div className="panel" style={{ display: 'grid', gap: 14, padding: 18 }}>
        <dl className="ns-status" aria-label="Alerts on this device">
          <div><dt>Browser permission</dt><dd data-testid="ns-perm">{permText}</dd></div>
          <div><dt>BuhurtOS alerts on this device</dt><dd data-testid="ns-device">{devices === null ? '…' : thisOn ? 'On' : 'Off'}</dd></div>
        </dl>
        {support === 'needs-install' && (
          <div role="note" style={{ display: 'grid', gap: 6 }}>
            <b>To get alerts on iPhone or iPad, add BuhurtOS to your Home Screen first.</b>
            <ol className="plain" style={{ margin: 0, paddingLeft: 20 }}>{installHelp('ios').steps.map(s => <li key={s}>{s}</li>)}</ol>
          </div>
        )}
        {support === 'unsupported' && <p role="note" style={{ margin: 0 }}><b>This browser cannot show BuhurtOS alerts.</b> <span className="muted">Chrome or Edge on Android and desktop, and the installed app on iPhone, can.</span></p>}
        {support === 'ready' && perm === 'denied' && (
          <div role="note" style={{ display: 'grid', gap: 4 }}>
            <b>Alerts are blocked for BuhurtOS in this browser.</b>
            <span className="muted">To allow them: open the site settings (the lock or tune icon next to the address) → Notifications → Allow. On iPhone: Settings → Notifications → BuhurtOS. Then come back here and turn alerts on.</span>
          </div>
        )}
        {support === 'ready' && perm !== 'denied' && !thisOn && (
          <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0 }}><b>Want BuhurtOS to tell you when you're coming up to fight?</b></p>
            <p className="muted" style={{ margin: 0 }}>It sends a short message when you are 2 fights away, up next and when your fight is ready, and tells you if your fight changes field or the schedule changes. You can switch groups off below and turn it off whenever you like. Your browser will ask permission next.</p>
            <div><button type="button" className="btn btn-ink" disabled={busy} onClick={() => void turnOn()}>{busy ? 'Turning on…' : 'Turn on alerts on this device'}</button></div>
          </div>
        )}
        {support === 'ready' && thisOn && (
          <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0 }}><b>Alerts are on for this device.</b> <span className="muted">They arrive even when BuhurtOS is closed.</span></p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => void test()}>Send me a test</button>
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => void turnOff()}>Turn off on this device</button>
            </div>
          </div>
        )}
        {support === 'unsupported' || support === 'needs-install' ? (install.offer && install.native ? <div><button type="button" className="btn btn-ink" onClick={() => void install.install()}>Install BuhurtOS</button></div> : null) : null}

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          <legend className="acct-h" style={{ marginBottom: 8 }}>What to be told about</legend>
          {GROUPS.map(k => (
            <label key={k} className="switch" style={{ justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}><b>{CATEGORY_LABEL[k].title}</b><span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>{CATEGORY_LABEL[k].sub}</span></span>
              <input type="checkbox" role="switch" checked={settings[k]} onChange={e => void toggle(k, e.target.checked)} aria-label={`${CATEGORY_LABEL[k].title} alerts`} />
              <span className="track" aria-hidden="true" />
            </label>
          ))}
          <span className="src">These choices apply to every device. The bell in the top bar always lists everything.</span>
        </fieldset>

        {devices && devices.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <span className="acct-h" style={{ marginBottom: 0 }}>Your devices</span>
            <ul className="plain" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {devices.map(d => (
                <li key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 0 }}><b>{d.label}</b>{d.endpointDigest === thisDigest && <span className="chip" style={{ marginLeft: 8 }}>This device</span>}
                    <span className="src" style={{ display: 'block' }}>{d.lastSuccessAt ? `Last alert ${timeAgo(d.lastSuccessAt)}` : 'No alert delivered yet'}</span></span>
                  <button type="button" className="btn btn-line btn-sm" onClick={() => void remove(d)} aria-label={`Remove ${d.label}`}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="src" style={{ margin: 0 }}>Alerts are a convenience and need a signal. If one does not arrive, your place in the line is always on My next fight and nothing about your event depends on it.</p>
        <div aria-live="polite" role="status">{saved && <span style={{ color: 'var(--win)' }}>{saved}</span>}</div>
        {problem && <p role="alert" style={{ color: 'var(--live)', margin: 0 }}>{problem}</p>}
      </div>
    </section>
  );
}
