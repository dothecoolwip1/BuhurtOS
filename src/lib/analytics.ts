import { supabase } from './supabase';

/**
 * The one place the app talks to analytics. Pages call trackPageView / trackEvent / identifyUser / resetUser and never a provider.
 *   * First-party sink (always on): the BuhurtOS database, read only by the platform owner through admin_* functions.
 *   * PostHog sink (optional): loaded only when VITE_POSTHOG_KEY is set at build time. It adds approximate location (country, region,
 *     city from the IP, never GPS) and, only when VITE_POSTHOG_REPLAY=on, session replay with every input masked.
 * Visiting never creates an account, profile or fighter. Before sign-in a person is a random browser id; on sign-in that id is linked
 * to their account id (no email or name is sent to PostHog); on sign-out the link is cut and a new random id starts.
 * Nothing sent may contain passwords, tokens, codes, form contents or messages: sanitizeProps keeps short plain values under safe keys only.
 */

export type Props = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------- pure helpers (tested)
const BLOCKED_KEY = /pass|token|secret|otp|code|card|cvv|iban|ssn|phone|email|mail|message|body|note|answer|address|birth|contact|reason/i;
/** Only short primitive values under plain snake_case keys; anything that looks sensitive is dropped, not masked. At most 12 keys. */
export function sanitizeProps(p: Record<string, unknown> | undefined): Props {
  const out: Props = {};
  if (!p) return out;
  for (const [k, v] of Object.entries(p)) {
    if (Object.keys(out).length >= 12) break;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || BLOCKED_KEY.test(k)) continue;
    if (typeof v === 'string') out[k] = stripUrl(v).slice(0, 100);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}
/** "/a/b?x=1#y" -> "/a/b"; also for full URLs. Query strings can carry codes and search terms, so they never leave the browser. */
export function stripUrl(s: string): string {
  return /^(https?:\/\/|\/)/.test(s) ? s.split(/[?#]/)[0] : s;
}
export const validEventName = (n: string): boolean => /^[a-z][a-z0-9_]{1,39}$/.test(n);
export const deviceOf = (width: number): 'phone' | 'tablet' | 'desktop' => (width < 600 ? 'phone' : width < 1000 ? 'tablet' : 'desktop');
/** Browser and OS family only (no versions): enough to spot "broken on Safari", too coarse to fingerprint. */
export function uaFamily(ua: string): { browser: string; os: string } {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS|Chromium/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Other';
  return { browser, os };
}
/** The referring site's host, or null when there is none or it is this site. */
export function referrerHost(referrer: string, ownHost: string): string | null {
  try { const h = new URL(referrer).host.toLowerCase(); return h && h !== ownHost.toLowerCase() ? h.slice(0, 120) : null; } catch { return null; }
}
export function utmSource(search: string): string | null {
  const v = new URLSearchParams(search).get('utm_source');
  return v && /^[\w.-]{1,80}$/.test(v) ? v.toLowerCase() : null;
}
/** Pages where a recording would show private things (forms with names, waivers, scoring tools, account details). */
export const SENSITIVE_PATH = /^\/(welcome|account|test-login|team-manager|platform)(\/|$)|^\/events\/[^/]+\/(register|manage|field)(\/|$)|\/edit$/;

// ---------------------------------------------------------------- ids
const safe = <T>(f: () => T, fallback: T): T => { try { return f(); } catch { return fallback; } };
let memVisit: string | null = null;
/** One id per browser tab visit (sessionStorage), so a reload stays the same visit. */
export function visitId(): string {
  return safe(() => {
    let v = sessionStorage.getItem('bos-visit');
    if (!v) { v = crypto.randomUUID(); sessionStorage.setItem('bos-visit', v); }
    return v;
  }, (memVisit ??= crypto.randomUUID()));
}
/** A random id kept in this browser across visits (new vs returning). Not tied to any account until the person signs in. */
let visitor: { id: string; isNew: boolean } | null = null;
function visitorInfo() {
  if (visitor) return visitor;
  visitor = safe(() => {
    const had = localStorage.getItem('bos-visitor');
    if (had) return { id: had, isNew: false };
    const id = crypto.randomUUID(); localStorage.setItem('bos-visitor', id);
    return { id, isNew: true };
  }, { id: crypto.randomUUID(), isNew: true });
  return visitor;
}

// ---------------------------------------------------------------- sinks
interface Sink {
  pageView(path: string): void;
  event(name: string, props: Props): void;
  identify(userId: string): void;
  reset(): void;
}

const firstParty: Sink = {
  pageView(path) {
    const v = visitorInfo();
    const { browser, os } = uaFamily(navigator.userAgent);
    void supabase.rpc('track_activity', {
      p_session: visitId(), p_path: path, p_device: deviceOf(window.innerWidth),
      p_meta: {
        visitor_id: v.id, new_visitor: v.isNew, browser, os,
        referrer_host: referrerHost(document.referrer, location.host), utm_source: utmSource(location.search),
        time_zone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, null), language: navigator.language?.slice(0, 20) ?? null
      }
    }).then(() => undefined, () => undefined);
  },
  event(name, props) { void supabase.rpc('track_event', { p_session: visitId(), p_name: name, p_props: props }).then(() => undefined, () => undefined); },
  identify() { /* the database reads the signed-in account from the request itself */ },
  reset() { safe(() => sessionStorage.removeItem('bos-visit'), undefined); memVisit = null; }
};

type PostHogLike = {
  capture: (name: string, props?: Record<string, unknown>) => void;
  identify: (id: string) => void; reset: () => void;
  startSessionRecording?: () => void; stopSessionRecording?: () => void;
};
let ph: PostHogLike | null = null;
let phQueue: ((p: PostHogLike) => void)[] = [];
const replayOn = import.meta.env.VITE_POSTHOG_REPLAY === 'on';
const viaPostHog = (f: (p: PostHogLike) => void) => { if (ph) f(ph); else if (phQueue.length < 100) phQueue.push(f); };
const postHog: Sink = {
  pageView(path) {
    viaPostHog(p => {
      p.capture('$pageview', { $current_url: location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + path, $pathname: path });
      if (replayOn) (SENSITIVE_PATH.test(path) ? p.stopSessionRecording : p.startSessionRecording)?.call(p);
    });
  },
  event(name, props) { viaPostHog(p => p.capture(name, props)); },
  identify(userId) { viaPostHog(p => p.identify(userId)); },
  reset() { viaPostHog(p => p.reset()); }
};

const sinks: Sink[] = [firstParty];
let started = false;
/** Called once at start-up. Loads PostHog only when a project key was built in. */
export function initAnalytics(): void {
  if (started) return;
  started = true;
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (key) {
    sinks.push(postHog);
    void import('posthog-js').then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: false, // sent by trackPageView with the query string removed
        capture_pageleave: true,
        autocapture: { dom_event_allowlist: ['click'], element_allowlist: ['a', 'button'] }, // clicks on links and buttons only; never inputs
        mask_all_element_attributes: false,
        mask_personal_data_properties: true,
        disable_session_recording: !replayOn,
        session_recording: { maskAllInputs: true, maskTextSelector: '[data-private]', blockSelector: '[data-private-block]' },
        disable_surveys: true,
        before_send: e => {
          if (!e) return e;
          for (const k of ['$current_url', '$referrer', '$initial_referrer', '$initial_current_url', '$prev_pageview_pathname', '$pathname']) {
            const v = e.properties?.[k];
            if (typeof v === 'string') e.properties[k] = stripUrl(v);
          }
          return e;
        }
      });
      ph = posthog as unknown as PostHogLike;
      const q = phQueue; phQueue = [];
      q.forEach(f => f(ph!));
    }, () => { phQueue = []; });
  }
  let errors = 0;
  const onError = (msg: string) => { if (errors++ < 5) trackEvent('client_error', { what: msg.slice(0, 100), path: location.pathname }); };
  window.addEventListener('error', e => onError(String(e.message || 'error')));
  window.addEventListener('unhandledrejection', e => onError(String((e.reason as { message?: string } | undefined)?.message ?? 'unhandled rejection')));
}

/** A page opened (path only, query and anchor removed). Also used as the minute heartbeat that measures time on site. */
export function trackPageView(path: string): void { const p = stripUrl(path) || '/'; sinks.forEach(s => s.pageView(p)); }
/** A product action. Unknown or unsafe names and properties are dropped before anything leaves the browser. */
export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!validEventName(name)) return;
  const clean = sanitizeProps(props);
  sinks.forEach(s => s.event(name, clean));
}
let identified: string | null = null;
/** Links this browser's anonymous history to the account (account id only). Safe to call on every load. */
export function identifyUser(userId: string): void {
  if (identified === userId) return;
  identified = userId;
  sinks.forEach(s => s.identify(userId));
}
/** On sign-out: forget the account and start a fresh anonymous visit, so the next person on this device is not linked to it. */
export function resetUser(): void {
  identified = null;
  sinks.forEach(s => s.reset());
}

// ---------------------------------------------------------------- explicit sign-in marker
export type SignInMethod = 'code' | 'google' | 'password';
/** Set when the person presses a sign-in button, so a session restored on page load is not counted as a login or sent to onboarding. */
export function markSignInStarted(method: SignInMethod): void { safe(() => sessionStorage.setItem('bos-signin', `${Date.now()}|${method}`), undefined); }
/** The method, once, right after a sign-in this tab started in the last 30 minutes (Google returns to the same tab); otherwise null. */
export function takeSignInStarted(): SignInMethod | null {
  return safe(() => {
    const [at, method] = (sessionStorage.getItem('bos-signin') ?? '').split('|');
    sessionStorage.removeItem('bos-signin');
    const ok = Number(at) > 0 && Date.now() - Number(at) < 30 * 60_000 && (method === 'code' || method === 'google' || method === 'password');
    return ok ? (method as SignInMethod) : null;
  }, null);
}
/** An account made in the last 30 minutes counts as a sign-up rather than a login. */
export const isNewAccount = (createdAt: string | undefined, now = Date.now()): boolean => !!createdAt && now - Date.parse(createdAt) < 30 * 60_000;

/** Onboarding is offered right after an explicit sign-in, never because someone opened a page. Kept for this tab only. */
export function wantOnboarding(userId: string): void { safe(() => sessionStorage.setItem('bos-onboard', userId), undefined); }
export const onboardingWanted = (userId: string): boolean => safe(() => sessionStorage.getItem('bos-onboard') === userId, false);
export function clearOnboarding(): void { safe(() => sessionStorage.removeItem('bos-onboard'), undefined); }
