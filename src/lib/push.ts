import { fetchPushPublicKey, registerPushDevice, removePushDevice } from '../data/notifications';
import { deviceLabel, platformOf, pushSupport, sameKey, stillDismissed, urlBase64ToBytes, type PushSupport } from './pushSupport';

/**
 * Browser side of web push. The server's key pair is created by the dispatcher; the device subscribes with the PUBLIC half and sends the
 * resulting subscription to the database (register_push_device). Asking the person for permission only ever happens from enablePush(), which
 * is only called by a button press that explained why first.
 */
const flagKey = (userId: string) => `bos-push-on:${userId}`;
/** The server id of THIS browser's registration, so it can remove exactly its own row later (never anyone else's: the server checks the owner). */
const deviceKey = (userId: string) => `bos-push-device:${userId}`;
const ASK_KEY = 'bos-push-ask';
export const ASK_AGAIN_DAYS = 30;

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage can be blocked */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* storage can be blocked */ } }
};

export const isStandalone = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true);

export function currentSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  return pushSupport({
    hasServiceWorker: 'serviceWorker' in navigator && import.meta.env.PROD,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    platform: platformOf(navigator.userAgent, navigator.maxTouchPoints),
    standalone: isStandalone()
  });
}

export const permissionState = (): NotificationPermission | 'unsupported' => ('Notification' in window ? Notification.permission : 'unsupported');

/** The service worker's registration. `ready` never settles when no worker could be registered (blocked storage, private modes), so give up
 *  after a few seconds instead of leaving a screen waiting forever: callers then treat this device as "no alerts here". */
async function registration(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('The app is not fully installed in this browser yet. Reload and try again.')), 5000))
  ]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (currentSupport() === 'unsupported') return null;
  try { return await (await registration()).pushManager.getSubscription(); } catch { return null; }
}

/** SHA-256 of the endpoint, hex: how the device list recognises "this device" without the endpoint ever being readable. */
export async function endpointDigest(endpoint: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

const toRegistration = (sub: PushSubscription) => {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('This browser did not give a usable notification address.');
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
};

export type EnableResult = 'enabled' | 'denied' | 'unavailable';

/** Turn alerts on for this device: ask permission (the browser prompt), subscribe, and tell the database. Never throws for "no" answers. */
export async function enablePush(userId: string): Promise<EnableResult> {
  if (currentSupport() !== 'ready') return 'unavailable';
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const key = await fetchPushPublicKey();
  if (!key) return 'unavailable';
  const wanted = urlBase64ToBytes(key);
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, wanted)) { await sub.unsubscribe(); sub = null; }   // the server's key changed: the old subscription can never receive
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted as BufferSource });
  const id = await registerPushDevice(toRegistration(sub), deviceLabel(navigator.userAgent, navigator.maxTouchPoints));
  // The browser gave this device a NEW address (keys rotated, subscription replaced): the old row can never receive again, so remove it now
  // instead of waiting for the push service to report it gone.
  const before = store.get(deviceKey(userId));
  if (before && id && before !== id) await removePushDevice({ id: before }).catch(() => undefined);
  if (id) store.set(deviceKey(userId), id);
  store.set(flagKey(userId), '1');
  return 'enabled';
}

/** Turn alerts off for this device. The local unsubscribe always happens (so no alert can arrive even offline); telling the server is best effort. */
export async function disablePush(userId: string | null): Promise<void> {
  const sub = await currentSubscription();
  if (userId) { store.del(flagKey(userId)); store.del(deviceKey(userId)); }
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  await removePushDevice({ endpoint }).catch(() => undefined);
}

export const wantsPush = (userId: string): boolean => store.get(flagKey(userId)) === '1';

/**
 * On startup for a signed-in person who turned alerts on here: make sure the browser still has a subscription and the database knows it
 * (the browser can rotate it). Silent: never prompts, never throws.
 */
export async function syncPush(userId: string): Promise<void> {
  try {
    if (!wantsPush(userId) || currentSupport() !== 'ready') return;
    if (Notification.permission === 'denied') {
      // The person blocked BuhurtOS in the browser's own settings: this device can never show an alert again, so it leaves the server's list
      // (otherwise every alert would still be sent to a dead end). Turning alerts back on registers it again.
      const id = store.get(deviceKey(userId));
      if (id) await removePushDevice({ id });
      store.del(deviceKey(userId)); store.del(flagKey(userId));
      return;
    }
    if (Notification.permission !== 'granted') return;
    await enablePush(userId);
  } catch { /* retried at the next start */ }
}

/** The contextual ask ("Want BuhurtOS to tell you when you're coming up to fight?"): remembered "not now" keeps it away for a month. */
export const askDismissed = (now = Date.now()): boolean => stillDismissed(store.get(ASK_KEY), now, ASK_AGAIN_DAYS);
export const dismissAsk = (now = Date.now()): void => store.set(ASK_KEY, String(now));
