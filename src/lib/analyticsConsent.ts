import { useSyncExternalStore } from 'react';

/**
 * Whether optional product analytics may run for this browser. Kept apart from analytics.ts so the rule is one small, tested function.
 *
 * Model today ("notice"): analytics run after a plain notice (the footer link and /privacy) unless the person turns them off, and
 * they never run again once off, in any tab, until the person turns them back on. A browser that sends the Global Privacy Control or
 * Do Not Track signal is treated as having turned analytics off; the person can still turn them on from /privacy.
 *
 * Other regions: set VITE_ANALYTICS_CONSENT=opt-in at build time (or add the region to CONSENT_BY_REGION and pass it to
 * consentModeFor) and analytics stay off until the person turns them on. Nothing else in the app needs to change.
 * Required operations (signing in, bug reports, the security log in the database) are not analytics and never depend on this.
 */
export type ConsentMode = 'notice' | 'opt-in';
export type Preference = 'on' | 'off' | null;
export interface Signals { gpc: boolean; dnt: boolean }

/** Regions with a stricter rule than the default. Empty today: BuhurtOS is built and run in Alberta, Canada. */
export const CONSENT_BY_REGION: Record<string, ConsentMode> = {};

export function consentModeFor(region?: string, buildSetting?: string): ConsentMode {
  if (buildSetting === 'opt-in') return 'opt-in';
  return (region && CONSENT_BY_REGION[region.toUpperCase()]) || 'notice';
}

export function analyticsAllowed(pref: Preference, mode: ConsentMode, signals: Signals): boolean {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  if (mode === 'opt-in') return false;
  return !(signals.gpc || signals.dnt);
}

export function readSignals(): Signals {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string });
  const dnt = nav?.doNotTrack === '1' || nav?.doNotTrack === 'yes' || nav?.msDoNotTrack === '1' || (typeof window !== 'undefined' && (window as unknown as { doNotTrack?: string }).doNotTrack === '1');
  return { gpc: nav?.globalPrivacyControl === true, dnt };
}

// ---------------------------------------------------------------- the stored choice
const KEY = 'bos-analytics';
const subs = new Set<() => void>();
const safe = <T,>(f: () => T, fallback: T): T => { try { return f(); } catch { return fallback; } };
let memory: Preference = null;

export function getPreference(): Preference {
  const v = safe(() => localStorage.getItem(KEY), null);
  if (v === 'on' || v === 'off') return v;
  return memory;
}
export function setPreference(p: Preference): void {
  memory = p;
  safe(() => { if (p) localStorage.setItem(KEY, p); else localStorage.removeItem(KEY); }, undefined);
  subs.forEach(f => f());
}
export const buildConsentMode = (): ConsentMode => consentModeFor(undefined, import.meta.env.VITE_ANALYTICS_CONSENT as string | undefined);
export const currentlyAllowed = (): boolean => analyticsAllowed(getPreference(), buildConsentMode(), readSignals());
export const onPreferenceChange = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** For the privacy page: the saved choice, whether analytics are running, and why. */
export function useAnalyticsChoice(): { allowed: boolean; pref: Preference; signal: 'gpc' | 'dnt' | null; mode: ConsentMode } {
  const pref = useSyncExternalStore(onPreferenceChange, getPreference, () => null);
  const s = readSignals();
  return { allowed: analyticsAllowed(pref, buildConsentMode(), s), pref, signal: s.gpc ? 'gpc' : s.dnt ? 'dnt' : null, mode: buildConsentMode() };
}
