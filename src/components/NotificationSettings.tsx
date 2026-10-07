import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchMyFighterId } from '../data/fighters';
import { fetchMyEvents } from '../data/myEvents';
import { fetchMyProfile } from '../data/profile';
import {
  ALL_ON, CATEGORY_LABEL, fetchNotificationSettings, fetchPushDevices, removePushDevice, saveNotificationSettings, sendTestNotification,
  type NotificationCategory, type NotificationSettings as Settings, type PushDevice
} from '../data/notifications';
import { friendlyError } from '../lib/friendlyError';
import { useInstall } from '../lib/install';
import { askDismissed, currentSubscription, currentSupport, disablePush, dismissAsk, enablePush, endpointDigest, permissionState } from '../lib/push';
import { installHelp, permissionLabel } from '../lib/pushSupport';
import { timeAgo, visibleCategories } from '../lib/notificationView';
import { Dialog } from './Dialog';

/**
 * Device controls (secondary to the preference dialog): whether THIS device gets alerts, a test, and the person's devices. Browser permission is only
 * ever requested from the "Turn on alerts" button, after saying what it is for. A "no" from the browser leaves the app working exactly as before.
 */
export function NotificationDevices() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const support = currentSupport();
  const install = useInstall();
  const [perm, setPerm] = useState(permissionState());
  const [thisDigest, setThisDigest] = useState<string | null>(null);
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await fetchPushDevices()); setPerm(permissionState());
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
  const remove = async (d: PushDevice) => {
    setProblem(null); setSaved(null);
    try {
      if (d.endpointDigest === thisDigest) await disablePush(userId); else await removePushDevice({ id: d.id });
      await load(); setSaved(`${d.label} removed.`);
    } catch (e) { setProblem(friendlyError(e, 'Could not remove that device.')); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
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
        <p style={{ margin: 0 }}><b>Alerts on this device</b></p>
        <p className="muted" style={{ margin: 0 }}>Your browser will ask permission next. Turn it off any time.</p>
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
    <p className="src" style={{ margin: 0 }}>If an alert does not arrive, your place in the line is always on My next fight.</p>
    <div aria-live="polite" role="status">{saved && <span style={{ color: 'var(--win)' }}>{saved}</span>}</div>
    {problem && <p role="alert" style={{ color: 'var(--live)', margin: 0 }}>{problem}</p>}
    </div>
  );
}

/** What decides which groups are offered. Any failed lookup means "offer everything". */
function useRoles() {
  const [roles, setRoles] = useState({ known: false, fighter: false, fightsInEvent: false });
  useEffect(() => {
    let live = true;
    void Promise.all([fetchMyFighterId(), fetchMyEvents()])
      .then(([id, events]) => { if (live) setRoles({ known: true, fighter: id !== null, fightsInEvent: events.some(e => !e.synthetic && e.staffRoles.length === 0) }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return roles;
}

/**
 * The one small notification popup, used twice: `first` (after sign-in: "Not now" / "Enable Notifications", the only place the browser is asked,
 * and only after that tap) and `settings` (later: "Cancel" / "Save"). The same saved preferences (Pack 15) and the same push registration back both.
 * Devices, the test and "turn off on this device" live one step away under "Manage devices".
 */
export function NotificationDialog({ mode, onClose }: { mode: 'first' | 'settings'; onClose: () => void }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const roles = useRoles();
  const shown = visibleCategories(roles);
  const [settings, setSettings] = useState<Settings>(ALL_ON);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<'prefs' | 'devices'>('prefs');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const manageRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const first = mode === 'first';

  useEffect(() => {
    let live = true;
    void fetchNotificationSettings()
      .then(s => { if (live) { setSettings(s); setLoaded(true); } })
      .catch(e => { if (live) setProblem(friendlyError(e, 'Could not load your notification settings.')); });
    return () => { live = false; };
  }, []);
  // Moving between the two views removes the button that had focus: put it on the matching one.
  const seen = useRef(false);
  useEffect(() => { if (!seen.current) { seen.current = true; return; } (view === 'devices' ? backRef : manageRef).current?.focus(); }, [view]);

  const notNow = () => { if (first) dismissAsk(); onClose(); };
  const cancel = first ? notNow : onClose;
  const save = async () => {
    setBusy(true); setProblem(null);
    try {
      await saveNotificationSettings(settings);
      if (!first) { onClose(); return; }
      const r = await enablePush(userId);
      if (r === 'enabled') { onClose(); return; }
      dismissAsk();
      if (r === 'denied') setBlocked(true); else setProblem('Your choices are saved, but alerts are not ready on this device yet. Try again from Notification Settings.');
    } catch (e) { setProblem(friendlyError(e, first ? 'Could not turn notifications on.' : 'Could not save.')); } finally { setBusy(false); }
  };

  if (view === 'devices') {
    return (
      <Dialog title="Manage devices" onClose={() => setView('prefs')}>
        <NotificationDevices />
        <div className="dlg-actions"><button ref={backRef} type="button" className="btn btn-line" onClick={() => setView('prefs')}>Back</button></div>
      </Dialog>
    );
  }
  return (
    <Dialog title="Notifications" onClose={cancel} busy={busy}>
      {first && !blocked && <p className="muted" style={{ margin: 0 }}>Choose what BuhurtOS tells you about.</p>}
      <fieldset className="ndlg-list" aria-busy={!loaded}>
        <legend className="sr-only">What to be notified about</legend>
        {shown.map((k: NotificationCategory) => (
          <label key={k} className="switch ndlg-row">
            <span className="ndlg-text"><b>{CATEGORY_LABEL[k].short}</b><span className="src">{CATEGORY_LABEL[k].hint}</span></span>
            <span className="ndlg-state" aria-hidden="true">{settings[k] ? 'On' : 'Off'}</span>
            <input type="checkbox" role="switch" checked={settings[k]} disabled={!loaded} onChange={e => setSettings({ ...settings, [k]: e.target.checked })} aria-label={CATEGORY_LABEL[k].short} />
            <span className="track" aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      {blocked && <p role="status" style={{ margin: 0 }}>Saved. Your browser is blocking alerts: allow Notifications for BuhurtOS in the site settings, then use Manage devices.</p>}
      {problem && <p role="alert" style={{ color: 'var(--live)', margin: 0 }}>{problem}</p>}
      {!first && <button ref={manageRef} type="button" className="linklike ndlg-manage" onClick={() => setView('devices')}>Manage devices</button>}
      <div className="dlg-actions ndlg-actions">
        {blocked
          ? <button type="button" className="btn btn-ink" onClick={onClose}>Done</button>
          : <>
              <button type="button" className="btn btn-line" disabled={busy} onClick={cancel}>{first ? 'Not now' : 'Cancel'}</button>
              <button type="button" className="btn btn-ink" disabled={busy || !loaded} onClick={() => void save()}>{first ? (busy ? 'Enabling…' : 'Enable Notifications') : (busy ? 'Saving…' : 'Save')}</button>
            </>}
      </div>
    </Dialog>
  );
}

/** The compact entry in Account (and anywhere else preferences are offered): a row that opens the popup. */
export function NotificationSettingsRow() {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="notif-set-h" id="notifications" style={{ display: 'grid', gap: 10, scrollMarginTop: 90 }}>
      <h2 id="notif-set-h" className="acct-h">Notifications</h2>
      <div className="panel acct-list">
        <button type="button" className="acct-row" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <span style={{ minWidth: 0 }}><b>Notifications</b></span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      </div>
      {open && <NotificationDialog mode="settings" onClose={() => setOpen(false)} />}
    </section>
  );
}

/** Pages where the first-time popup may appear (exact paths only, so no event-day screen under /events/... qualifies). */
const CALM_PAGE = /^\/(events|my-events|account|teams|fighters|rankings|calendar)?\/?$/;

/**
 * After sign-in, once the account is set up: the small first-time popup, only where alerts can work here, not blocked, not already on, and not
 * declined within the last month ("Not now" is shared with the ask on My next fight). Nothing is requested from the browser until Enable.
 */
export function NotificationOnboarding({ pathname }: { pathname: string }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [show, setShow] = useState(false);
  const checked = useRef<string | null>(null);
  // Only on calm pages: never over scoring, the field queue, check-in, command or any event-day screen, where a popup could cost someone a fight.
  const quiet = !CALM_PAGE.test(pathname);
  useEffect(() => {
    if (!userId || quiet || checked.current === userId) return;
    checked.current = userId;
    let live = true;
    void (async () => {
      try {
        if (currentSupport() !== 'ready' || permissionState() === 'denied' || askDismissed()) return;
        const [profile, sub] = await Promise.all([fetchMyProfile(userId), currentSubscription()]);
        if (live && profile?.onboarded === true && sub === null) setShow(true);
      } catch { /* never in the way */ }
    })();
    return () => { live = false; };
  }, [userId, quiet]);
  return show && userId && !quiet ? <NotificationDialog mode="first" onClose={() => setShow(false)} /> : null;
}
