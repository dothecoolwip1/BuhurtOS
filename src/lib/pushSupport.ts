/**
 * Pure rules for the install and notification prompts, so they can be tested without a browser.
 * No network, no storage, no DOM: callers pass in what they observed.
 */
export type Platform = 'ios' | 'android' | 'desktop';

export const platformOf = (ua: string, maxTouchPoints = 0): Platform => {
  // iPadOS reports itself as a Mac with touch; treat that as iOS because installing and push work the iOS way there.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios';
  return /Android/.test(ua) ? 'android' : 'desktop';
};

/** A short, human label for the device list ("Pixel phone" is not knowable, so it stays generic and never includes the raw user-agent). */
export function deviceLabel(ua: string, maxTouchPoints = 0): string {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'This device';
}

export interface Env { hasServiceWorker: boolean; hasPushManager: boolean; hasNotification: boolean; platform: Platform; standalone: boolean }

/**
 * ready         this browser can subscribe now
 * needs-install iPhone/iPad only allow web push for an app added to the Home Screen: ask them to install first
 * unsupported   no service worker or no push in this browser
 */
export type PushSupport = 'ready' | 'needs-install' | 'unsupported';
export function pushSupport(e: Env): PushSupport {
  if (e.platform === 'ios' && !e.standalone) return e.hasServiceWorker ? 'needs-install' : 'unsupported';
  return e.hasServiceWorker && e.hasPushManager && e.hasNotification ? 'ready' : 'unsupported';
}

export interface InstallHelp { title: string; steps: string[] }
export function installHelp(p: Platform): InstallHelp {
  if (p === 'ios') return { title: 'Add BuhurtOS to your Home Screen', steps: ['Tap the Share button in Safari (the square with an arrow).', 'Scroll down and tap Add to Home Screen.', 'Open BuhurtOS from your Home Screen. Alerts can be turned on there.'] };
  if (p === 'android') return { title: 'Install BuhurtOS', steps: ['Open the browser menu (three dots).', 'Tap Install app, or Add to Home screen.', 'Open BuhurtOS from your home screen.'] };
  return { title: 'Install BuhurtOS', steps: ['Look for the install icon at the right of the address bar, or open the browser menu and choose Install BuhurtOS.', 'BuhurtOS then opens in its own window.'] };
}

const DAY = 86_400_000;
/** True when a "not now" is still fresh: the prompt stays away. Unparseable or missing means it is not dismissed. */
export const stillDismissed = (stored: string | null, now: number, days: number): boolean => {
  const at = Number(stored);
  return Number.isFinite(at) && at > 0 && now - at < days * DAY;
};

/** Pages where an install or notification nudge would get in the way: scoring, the field, the running of an event, check-in. */
export const quietRoute = (pathname: string, search = ''): boolean =>
  /\/events\/[^/]+\/(field|arena)/.test(pathname) || (/\/events\/[^/]+\/manage$/.test(pathname) && /tab=(run|checkin|finalize)/.test(search)) || pathname.startsWith('/marshal');

/** Decode a base64url VAPID public key for PushManager.subscribe. */
export function urlBase64ToBytes(text: string): Uint8Array {
  const pad = '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}
