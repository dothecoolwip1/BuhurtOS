import { describe, expect, it } from 'vitest';
import { deviceLabel, installHelp, platformOf, pushSupport, quietRoute, sameKey, permissionLabel, stillDismissed, urlBase64ToBytes } from './pushSupport';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

describe('platform and device label', () => {
  it('knows iPhone, iPadOS (reports as a touch Mac), Android and desktop', () => {
    expect(platformOf(IPHONE)).toBe('ios');
    expect(platformOf(IPADOS, 5)).toBe('ios');
    expect(platformOf(IPADOS, 0)).toBe('desktop');
    expect(platformOf(ANDROID)).toBe('android');
    expect(platformOf(WIN)).toBe('desktop');
  });
  it('gives generic labels and never the raw user agent', () => {
    expect(deviceLabel(IPHONE)).toBe('iPhone');
    expect(deviceLabel(IPADOS, 5)).toBe('iPad');
    expect(deviceLabel(ANDROID)).toBe('Android phone');
    expect(deviceLabel(WIN)).toBe('Windows computer');
    expect(deviceLabel('')).toBe('This device');
  });
});

describe('push support', () => {
  const ok = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, standalone: false };
  it('works in a normal Android or desktop browser', () => {
    expect(pushSupport({ ...ok, platform: 'android' })).toBe('ready');
    expect(pushSupport({ ...ok, platform: 'desktop' })).toBe('ready');
  });
  it('on iPhone and iPad only once the app is on the Home Screen', () => {
    expect(pushSupport({ ...ok, platform: 'ios', hasPushManager: false })).toBe('needs-install');
    expect(pushSupport({ ...ok, platform: 'ios', standalone: true })).toBe('ready');
  });
  it('is unsupported without a service worker or push', () => {
    expect(pushSupport({ ...ok, platform: 'desktop', hasPushManager: false })).toBe('unsupported');
    expect(pushSupport({ ...ok, platform: 'android', hasServiceWorker: false })).toBe('unsupported');
  });
});

describe('prompts stay out of the way', () => {
  it('a "not now" keeps a prompt away for the chosen days, then it may return', () => {
    const now = 1_000_000_000_000;
    expect(stillDismissed(String(now - 86_400_000), now, 30)).toBe(true);
    expect(stillDismissed(String(now - 31 * 86_400_000), now, 30)).toBe(false);
    expect(stillDismissed(null, now, 30)).toBe(false);
    expect(stillDismissed('garbage', now, 30)).toBe(false);
  });
  it('no nudges while scoring, on the field, running the event or on the big screen', () => {
    expect(quietRoute('/events/rumble/field/Field 1')).toBe(true);
    expect(quietRoute('/events/rumble/arena')).toBe(true);
    expect(quietRoute('/events/rumble/control', '?mode=live')).toBe(true);
    expect(quietRoute('/events/rumble/control', '?mode=setup&tool=run')).toBe(true);
    expect(quietRoute('/events/rumble/control', '?mode=live&tool=checkin')).toBe(true);
    expect(quietRoute('/marshal')).toBe(true);
    expect(quietRoute('/events/rumble')).toBe(false);
    expect(quietRoute('/')).toBe(false);
    expect(quietRoute('/events/rumble/control', '?mode=setup')).toBe(false);
  });
  it('has short, device-appropriate install steps', () => {
    expect(installHelp('ios').steps.join(' ')).toMatch(/Share.*Add to Home Screen/);
    expect(installHelp('android').steps.join(' ')).toMatch(/Install app|Add to Home screen/);
    expect(installHelp('desktop').steps.length).toBeGreaterThan(0);
  });
});

describe('key helpers', () => {
  it('decodes a base64url public key and compares keys byte for byte', () => {
    const bytes = urlBase64ToBytes('BPsQ_-A');
    expect(Array.from(bytes)).toEqual([4, 251, 16, 255, 224]);
    expect(sameKey(bytes.buffer.slice(0) as ArrayBuffer, bytes)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2]).buffer, bytes)).toBe(false);
    expect(sameKey(null, bytes)).toBe(false);
  });
});

describe('permissionLabel (Pack 15: browser permission shown apart from the BuhurtOS switch)', () => {
  it('says plainly what the browser allows', () => {
    expect(permissionLabel('ready', 'granted')).toBe('Allowed');
    expect(permissionLabel('ready', 'denied')).toBe('Blocked');
    expect(permissionLabel('ready', 'default')).toBe('Not asked yet');
  });
  it('iPhone in Safari needs the Home Screen app first; a browser without push says so', () => {
    expect(permissionLabel('needs-install', 'default')).toBe('Add BuhurtOS to your Home Screen first');
    expect(permissionLabel('unsupported', 'unsupported')).toBe('Not available in this browser');
  });
});
