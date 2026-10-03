import { supabase } from './supabase';
import { currentlyAllowed, onPreferenceChange } from './analyticsConsent';

/**
 * The one place the app talks to analytics. Pages call trackPageView / trackEvent / identifyUser / resetUser and never a provider.
 *   * First-party sink: the BuhurtOS database, read only by the platform owner through admin_* functions. Kept 90 days.
 *   * PostHog sink (optional): loaded only when VITE_POSTHOG_KEY is set at build time AND the person has not turned analytics off
 *     (see analyticsConsent.ts). PostHog works out an approximate country, region and city from the IP address on its servers and,
 *     once the project's "discard client IP" setting is on, does not keep the IP. We never ask the browser for GPS.
 * What is sent, in full: the page path (never the query string or anchor), device class, browser and OS family, time zone,
 * the referring site, a random browser id, a random id per visit, named product actions with small plain properties, and,
 * once someone is signed in, their BuhurtOS account id (no email, name or phone). Never: what people type, page titles,
 * full user-agent strings, screen sizes, campaign parameters, session recordings, click captures.
 * Visiting never creates an account, profile or fighter. On sign-out the account link is cut and a new random id starts.
 * Everything leaving for PostHog passes through scrubCapture, which is tested.
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
/** Error text can quote URLs or addresses. Keep it short and remove query strings and anything that looks like an email address. */
export function scrubMessage(m: string): string {
  return m.replace(/https?:\/\/\S+/g, u => stripUrl(u)).replace(/[^\s@]+@[^\s@]+/g, '[email]').slice(0, 100);
}

// ---------------------------------------------------------------- what may leave the browser for PostHog
const DROP_KEYS = new Set(['$raw_user_agent', '$browser_version', '$os_version', '$screen_height', '$screen_width', '$viewport_height', '$viewport_width',
  '$browser_language', '$browser_language_prefix', '$device_model', 'title', '$el_text', '$elements', '$elements_chain']);
const DROP_PATTERN = /^\$prev_pageview_(last|max)_/;
const CAMPAIGN = /^(utm_[a-z]+|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|twclid|li_fat_id|igshid|ttclid|rdt_cid|epik|qclid|sccid|oppref|irclid|_kx|gad_source|mc_cid)$/;
const isCampaignKey = (k: string) => CAMPAIGN.test(k.replace(/^\$/, '').replace(/^(initial_|session_entry_)/, ''));
/** A URL keeps its path; a referrer keeps only the site it came from. Anything else that merely looks like a path loses "?" and "#". */
function cleanValue(key: string, v: unknown): unknown {
  if (typeof v !== 'string') return v;
  if (/^https?:\/\//.test(v)) {
    if (/referrer/i.test(key)) { try { return new URL(v).origin; } catch { return '$direct'; } }
    return stripUrl(v);
  }
  return v.startsWith('/') ? stripUrl(v) : v;
}
function cleanBag(bag: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!bag || typeof bag !== 'object') return bag;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bag)) {
    if (DROP_KEYS.has(k) || DROP_PATTERN.test(k) || isCampaignKey(k)) continue;
    out[k] = cleanValue(k, v);
  }
  return out;
}
type Capturable = { properties?: Record<string, unknown>; $set?: Record<string, unknown>; $set_once?: Record<string, unknown> };
/** The last stop before PostHog: removes query strings and anchors from every URL-like value (event properties and person properties),
 *  reduces referrers to the referring site, and drops fields that are not part of the disclosed set. */
export function scrubCapture<T extends Capturable>(e: T): T {
  const out = { ...e };
  if (e.properties) out.properties = cleanBag(e.properties);
  if (e.$set) out.$set = cleanBag(e.$set);
  if (e.$set_once) out.$set_once = cleanBag(e.$set_once);
  return out;
}

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

/** Forget this browser's random ids (used when someone turns analytics off). */
function clearLocalIds(): void {
  visitor = null; memVisit = null;
  safe(() => { localStorage.removeItem('bos-visitor'); sessionStorage.removeItem('bos-visit'); }, undefined);
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
        referrer_host: referrerHost(document.referrer, location.host),
        time_zone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, null)
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
  opt_in_capturing: (o?: { captureEventName?: string | null | false }) => void; opt_out_capturing: () => void; has_opted_out_capturing: () => boolean;
};
let ph: PostHogLike | null = null;
let phLoading = false;
let phQueue: ((p: PostHogLike) => void)[] = [];
const viaPostHog = (f: (p: PostHogLike) => void) => { if (ph) f(ph); else if (phQueue.length < 100) phQueue.push(f); };
const postHog: Sink = {
  pageView(path) {
    viaPostHog(p => p.capture('$pageview', { $current_url: location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + path, $pathname: path }));
  },
  event(name, props) { viaPostHog(p => p.capture(name, props)); },
  identify(userId) { viaPostHog(p => p.identify(userId)); },
  reset() { viaPostHog(p => p.reset()); }
};

const sinks: Sink[] = [firstParty];
let started = false;
const phKey = () => import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const sinksNow = (): Sink[] => (phKey() ? [firstParty, postHog] : [firstParty]);

/** Loads PostHog once, only when analytics are allowed. Every capture option that could read page content is off. */
function loadPostHog(): void {
  const key = phKey();
  if (!key || ph || phLoading) return;
  phLoading = true;
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      persistence: 'localStorage',        // no cookie is set by PostHog
      cross_subdomain_cookie: false,
      capture_pageview: false,            // sent by trackPageView with the query string removed
      capture_pageleave: false,
      request_batching: false,            // each event is sent at once, so nothing is waiting in a queue when someone turns analytics off
      autocapture: false,                 // click capture records button text and attributes, which can hold other people's names
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,    // replay is not used; it cannot be switched on from a build variable
      disable_surveys: true,
      disable_conversations: true,        // a chat widget would collect typed messages; the project must not be able to turn one on for visitors
      disable_product_tours: true,
      disable_web_experiments: true,
      advanced_disable_flags: true,       // no feature flags are used, so no flag request is made
      save_campaign_params: false,        // campaign values come from the query string
      mask_personal_data_properties: true,
      before_send: e => (e ? scrubCapture(e as unknown as Capturable) as unknown as typeof e : e)
    });
    ph = posthog as unknown as PostHogLike;
    phLoading = false;
    // A person who turned analytics off while this was loading must not be recorded.
    if (!currentlyAllowed()) { ph.reset(); ph.opt_out_capturing(); phQueue = []; return; }
    // PostHog remembers an earlier opt-out in this browser's storage; the person has since turned analytics back on.
    if (ph.has_opted_out_capturing()) ph.opt_in_capturing({ captureEventName: false });
    const q = phQueue; phQueue = []; q.forEach(f => f(ph!));
  }, () => { phQueue = []; phLoading = false; });
}

/** Called once at start-up. PostHog is loaded only when a project key was built in and analytics are allowed. */
export function initAnalytics(): void {
  if (started) return;
  started = true;
  sinks.length = 0; sinks.push(...sinksNow());
  if (currentlyAllowed()) loadPostHog();
  // Turning analytics off (or on) on /privacy takes effect immediately, in this tab.
  onPreferenceChange(() => {
    if (currentlyAllowed()) {
      if (ph) ph.opt_in_capturing({ captureEventName: false }); else loadPostHog();
      if (currentUser) { identified = null; identifyUser(currentUser); }
    } else {
      ph?.reset(); ph?.opt_out_capturing(); phQueue = [];
      identified = null;
      clearLocalIds();
    }
  });
let errors = 0;
  const onError = (msg: string) => { if (errors++ < 5) trackEvent('client_error', { what: scrubMessage(msg), path: location.pathname }); };
  window.addEventListener('error', e => onError(String(e.message || 'error')));
  window.addEventListener('unhandledrejection', e => onError(String((e.reason as { message?: string } | undefined)?.message ?? 'unhandled rejection')));
}

/** A page opened (path only, query and anchor removed). Also used as the minute heartbeat that measures time on site. */
export function trackPageView(path: string): void { if (!currentlyAllowed()) return; const p = stripUrl(path) || '/'; sinks.forEach(s => s.pageView(p)); }
/** A product action. Unknown or unsafe names and properties are dropped before anything leaves the browser. */
export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!validEventName(name) || !currentlyAllowed()) return;
  const clean = sanitizeProps(props);
  sinks.forEach(s => s.event(name, clean));
}
let identified: string | null = null;
let currentUser: string | null = null;
/** Links this browser's anonymous history to the account (account id only). Safe to call on every load. Does nothing while analytics are off. */
export function identifyUser(userId: string): void {
  currentUser = userId;
  if (!currentlyAllowed() || identified === userId) return;
  identified = userId;
  sinks.forEach(s => s.identify(userId));
}
/** On sign-out: forget the account and start a fresh anonymous visit, so the next person on this device is not linked to it. */
export function resetUser(): void {
  identified = null; currentUser = null;
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
