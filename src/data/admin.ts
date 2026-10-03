import { shrinkImage } from '../lib/image';
import { trackEvent, visitId } from '../lib/analytics';
import { supabase } from '../lib/supabase';

/** Usage activity (owner only) and bug reports (anyone sends, owner reads). The database checks who may read. */

// ---------------------------------------------------------------- owner: activity
export interface Visit { sessionId: string; userId: string | null; name: string | null; email: string | null; device: string | null; startedAt: string; lastSeenAt: string; path: string; pageCount: number; online: boolean }
type VisitDb = { session_id: string; user_id: string | null; name: string | null; email: string | null; device: string | null; started_at: string; last_seen_at: string; path: string; page_count: number; online: boolean };
export async function fetchActivity(hours: number): Promise<Visit[]> {
  const { data, error } = await supabase.rpc('admin_activity', { p_hours: hours });
  if (error) throw error;
  return (data as VisitDb[]).map(r => ({ sessionId: r.session_id, userId: r.user_id, name: r.name, email: r.email, device: r.device, startedAt: r.started_at, lastSeenAt: r.last_seen_at, path: r.path, pageCount: r.page_count, online: r.online }));
}
export async function fetchVisitPages(sessionId: string): Promise<{ path: string; at: string }[]> {
  const { data, error } = await supabase.rpc('admin_session_views', { p_session: sessionId });
  if (error) throw error;
  return data as { path: string; at: string }[];
}
// ---------------------------------------------------------------- owner: analytics
export type Audience = 'all' | 'anonymous' | 'registered';
export type Device = 'phone' | 'tablet' | 'desktop';
export interface Count { name: string; n: number }
export interface Analytics {
  totals: { visitors: number; newVisitors: number; returningVisitors: number; sessions: number; anonymousSessions: number; registeredPeople: number; onlineNow: number;
    avgSessionSeconds: number; pageViews: number; signups: number; logins: number; accountsTotal: number };
  pages: { path: string; views: number; visits: number; avgSeconds: number }[];
  entryPages: Count[]; exitPages: Count[]; paths: { from: string; to: string; n: number }[];
  referrers: Count[]; utmSources: Count[]; devices: Count[]; browsers: Count[]; os: Count[]; timeZones: Count[];
  events: { name: string; n: number; sessions: number }[]; searches: Count[]; signupEntryPages: Count[];
  funnelRegistration: { eventPageViews: number; registerPageViews: number; registrationsSubmitted: number };
  funnelSignup: { signInOpened: number; codeRequested: number; signedUp: number; profileCompleted: number };
  daily: { day: string; sessions: number; visitors: number }[];
}
type J = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const counts = (v: unknown, key: string): Count[] => arr(v).map(r => ({ name: String(r[key] ?? ''), n: num(r.n) }));
/** Turns the database's JSON into the page's shape. Missing blocks become empty, so an older database never breaks the page. */
export function parseAnalytics(j: J | null): Analytics {
  const t = (j?.totals ?? {}) as J; const fr = (j?.funnel_registration ?? {}) as J; const fs = (j?.funnel_signup ?? {}) as J;
  return {
    totals: { visitors: num(t.visitors), newVisitors: num(t.new_visitors), returningVisitors: num(t.returning_visitors), sessions: num(t.sessions), anonymousSessions: num(t.anonymous_sessions),
      registeredPeople: num(t.registered_people), onlineNow: num(t.online_now), avgSessionSeconds: num(t.avg_session_seconds), pageViews: num(t.page_views), signups: num(t.signups),
      logins: num(t.logins), accountsTotal: num(t.accounts_total) },
    pages: arr(j?.pages).map(r => ({ path: String(r.path), views: num(r.views), visits: num(r.visits), avgSeconds: num(r.avg_seconds) })),
    entryPages: counts(j?.entry_pages, 'path'), exitPages: counts(j?.exit_pages, 'path'),
    paths: arr(j?.paths).map(r => ({ from: String(r.from_path), to: String(r.to_path), n: num(r.n) })),
    referrers: counts(j?.referrers, 'source'), utmSources: counts(j?.utm_sources, 'source'), devices: counts(j?.devices, 'name'), browsers: counts(j?.browsers, 'name'),
    os: counts(j?.os, 'name'), timeZones: counts(j?.time_zones, 'name'),
    events: arr(j?.events).map(r => ({ name: String(r.name), n: num(r.n), sessions: num(r.sessions) })), searches: counts(j?.searches, 'where'), signupEntryPages: counts(j?.signup_entry_pages, 'path'),
    funnelRegistration: { eventPageViews: num(fr.event_page_views), registerPageViews: num(fr.register_page_views), registrationsSubmitted: num(fr.registrations_submitted) },
    funnelSignup: { signInOpened: num(fs.sign_in_opened), codeRequested: num(fs.code_requested), signedUp: num(fs.signed_up), profileCompleted: num(fs.profile_completed) },
    daily: arr(j?.daily).map(r => ({ day: String(r.day), sessions: num(r.sessions), visitors: num(r.visitors) }))
  };
}
export async function fetchAnalytics(from: Date, to: Date, audience: Audience, device: Device | null): Promise<Analytics> {
  const { data, error } = await supabase.rpc('admin_analytics', { p_from: from.toISOString(), p_to: to.toISOString(), p_audience: audience, p_device: device });
  if (error) throw error;
  return parseAnalytics(data as J);
}
export interface PersonUsage { userId: string; name: string | null; email: string | null; accountCreated: string; lastSignIn: string | null; lastActive: string; sessions: number;
  totalSeconds: number; pageViews: number; device: string | null; timeZone: string | null; recentPages: string[]; recentEvents: string[] }
export async function fetchPeopleUsage(from: Date, to: Date): Promise<PersonUsage[]> {
  const { data, error } = await supabase.rpc('admin_user_activity', { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw error;
  return (data as J[]).map(r => ({ userId: String(r.user_id), name: (r.name as string | null) ?? null, email: (r.email as string | null) ?? null, accountCreated: String(r.account_created),
    lastSignIn: (r.last_sign_in as string | null) ?? null, lastActive: String(r.last_active), sessions: num(r.sessions), totalSeconds: num(r.total_seconds), pageViews: num(r.page_views),
    device: (r.top_device as string | null) ?? null, timeZone: (r.time_zone as string | null) ?? null, recentPages: (r.recent_pages as string[] | null) ?? [], recentEvents: (r.recent_events as string[] | null) ?? [] }));
}
/** "America/Edmonton" -> "Edmonton (America)": an approximate place from the browser's time zone. Never GPS. */
export const zoneLabel = (tz: string | null): string => {
  if (!tz || tz === 'unknown') return 'Unknown';
  const [area, ...rest] = tz.split('/');
  return rest.length ? `${rest.join(' / ').replace(/_/g, ' ')} (${area})` : tz;
};
/** "95" -> "1 min 35 s", "4000" -> "1 h 6 min". */
export const secondsText = (s: number): string => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${Math.round(s % 60)} s` : ''}` : durationText(Math.round(s / 60)));
/** Groups pages into features (Events, Teams, Fighters, ...) by their plain-word label, for "which parts are used". */
export function featureUsage(pages: readonly { path: string; views: number }[]): Count[] {
  const m = new Map<string, number>();
  for (const p of pages) {
    const f = pageLabel(p.path).replace(/^(An? |Creating an |Managing an |Registering for an |Scoring on a |Editing a |Editing their )/, '').replace(/ (page|list)$/, '');
    const key = f.charAt(0).toUpperCase() + f.slice(1);
    m.set(key, (m.get(key) ?? 0) + p.views);
  }
  return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}

/** Whole minutes between two instants, at least 1. */
export const minutesBetween = (from: string, to: string): number => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
/** "45 min" or "2 h 5 min". */
export const durationText = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`);

export interface ActivitySummary { visits: number; people: number; visitors: number; onlineNow: number; avgMinutes: number }
/** Headline numbers for a list of visits. People are signed-in accounts; visitors are visits with nobody signed in. */
export function summarizeActivity(list: readonly Visit[]): ActivitySummary {
  const people = new Set(list.filter(v => v.userId).map(v => v.userId)).size;
  const total = list.reduce((s, v) => s + minutesBetween(v.startedAt, v.lastSeenAt), 0);
  return { visits: list.length, people, visitors: list.filter(v => !v.userId).length, onlineNow: list.filter(v => v.online).length, avgMinutes: list.length ? Math.round(total / list.length) : 0 };
}

/** Plain words for where someone is: "/teams/bears/edit" -> "Editing a team". Unknown paths are shown as they are. */
export function pageLabel(path: string): string {
  const p = path.replace(/\/+$/, '') || '/';
  const rules: [RegExp, string][] = [
    [/^\/$/, 'Home'], [/^\/events$/, 'Events list'], [/^\/events\/new$/, 'Creating an event'], [/^\/events\/[^/]+\/manage$/, 'Managing an event'],
    [/^\/events\/[^/]+\/register$/, 'Registering for an event'], [/^\/events\/[^/]+\/field\/[^/]+$/, 'Scoring on a field'], [/^\/events\/[^/]+$/, 'An event page'],
    [/^\/teams$/, 'Teams list'], [/^\/teams\/[^/]+\/edit$/, 'Editing a team'], [/^\/teams\/[^/]+$/, 'A team page'],
    [/^\/fighters$/, 'Fighters list'], [/^\/fighters\/[^/]+\/edit$/, 'Editing their profile'], [/^\/fighters\/[^/]+$/, 'A fighter page'],
    [/^\/rankings$/, 'Rankings'], [/^\/formats$/, 'Formats'], [/^\/rules$/, 'Rules'], [/^\/organizations(\/.*)?$/, 'Organizations'],
    [/^\/team-manager$/, 'Team manager'], [/^\/account$/, 'Account'], [/^\/welcome$/, 'Setting up their profile'], [/^\/test-login$/, 'Test sign-in'],
    [/^\/platform(\/.*)?$/, 'Platform (owner)'], [/^\/marshal$/, 'Marshal view']
  ];
  return rules.find(([re]) => re.test(p))?.[1] ?? p;
}

// ---------------------------------------------------------------- bug reports
export interface BugInput { what: string; expected: string; contact: string; screenshot: File | null }
export const BUG_MAX = 2000;
export function validateBug(b: BugInput): string | null {
  const n = b.what.trim().length;
  if (n < 5) return 'Say in a few words what went wrong.';
  if (n > BUG_MAX || b.expected.trim().length > BUG_MAX) return `Keep it under ${BUG_MAX} characters.`;
  return null;
}

/** Sends a report with the page, app version and device attached. A screenshot is shrunk first and kept private (only the owner can open it). */
export async function sendBugReport(b: BugInput, path: string): Promise<void> {
  let shot: string | null = null;
  if (b.screenshot) {
    const blob = await shrinkImage(b.screenshot, 1600, 'image/jpeg');
    const name = `reports/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage.from('bug-screenshots').upload(name, blob, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    shot = name;
  }
  const { error } = await supabase.rpc('report_bug', { p: {
    what: b.what.trim(), expected: b.expected.trim() || null, contact: b.contact.trim() || null, path, session_id: visitId(),
    app_version: __APP_VERSION__, user_agent: navigator.userAgent.slice(0, 400), screen: `${window.innerWidth}x${window.innerHeight}`, screenshot_path: shot
  } });
  if (error) throw error;
  trackEvent('bug_reported', { with_screenshot: shot !== null });
}

export type BugStatus = 'new' | 'seen' | 'fixed' | 'wontfix';
export interface BugReport { id: string; createdAt: string; name: string | null; email: string | null; contact: string | null; what: string; expected: string | null; path: string | null; appVersion: string | null; userAgent: string | null; screen: string | null; screenshotPath: string | null; status: BugStatus }
type BugDb = { id: string; created_at: string; name: string | null; email: string | null; contact: string | null; what: string; expected: string | null; path: string | null; app_version: string | null; user_agent: string | null; screen: string | null; screenshot_path: string | null; status: BugStatus };
export async function fetchBugReports(status: BugStatus | null): Promise<BugReport[]> {
  const { data, error } = await supabase.rpc('admin_bug_reports', { p_status: status });
  if (error) throw error;
  return (data as BugDb[]).map(r => ({ id: r.id, createdAt: r.created_at, name: r.name, email: r.email, contact: r.contact, what: r.what, expected: r.expected, path: r.path, appVersion: r.app_version, userAgent: r.user_agent, screen: r.screen, screenshotPath: r.screenshot_path, status: r.status }));
}
export async function setBugStatus(id: string, status: BugStatus): Promise<void> {
  const { error } = await supabase.rpc('set_bug_status', { p_report: id, p_status: status });
  if (error) throw error;
}
/** A link to a private screenshot that works for 10 minutes. Owner only (the bucket refuses anyone else). */
export async function screenshotUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('bug-screenshots').createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
