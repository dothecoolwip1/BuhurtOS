import { SOCIAL_NETWORKS, type SocialNetwork } from '../data/teamManager';

/** Social links, shared by team and fighter profiles. Pure helpers; the database checks every address again. */

export type SocialLinks = Partial<Record<SocialNetwork, string>>;
export { SOCIAL_NETWORKS };
export type { SocialNetwork };

export const NETWORK_LABEL: Record<SocialNetwork, string> = {
  facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', discord: 'Discord', twitch: 'Twitch', other: 'Website'
};

/** Where a bare handle lives, so "@reavers" on Instagram becomes a real address. */
const HANDLE_HOME: Partial<Record<SocialNetwork, string>> = {
  facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/', youtube: 'https://www.youtube.com/@', tiktok: 'https://www.tiktok.com/@',
  x: 'https://x.com/', twitch: 'https://www.twitch.tv/'
};

export const HTTPS_URL = /^https:\/\/[^\s/]+\.[^\s/]+([/?#]\S*)?$/;

/**
 * Turns what a person typed on a phone into the address the database accepts, where that is unambiguous:
 * "Https://x.com/a" (auto-capitalised) -> "https://x.com/a"; "www.facebook.com/a" or "facebook.com/a" -> "https://..."; "@handle" -> the
 * network's profile address; "http://" -> "https://". Anything else is returned trimmed, for the validator to judge.
 */
export function normalizeSocialUrl(network: SocialNetwork, raw: string): string {
  let s = raw.trim().replace(/\s+/g, '');
  if (!s) return '';
  if (/^@?[A-Za-z0-9_.-]{1,60}$/.test(s) && HANDLE_HOME[network]) return HANDLE_HOME[network] + s.replace(/^@/, '');
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http:\/\//i, 'https://').replace(/^HTTPS:\/\//i, 'https://');
  else if (/^[^\s/]+\.[^\s/]+/.test(s)) s = `https://${s}`;
  return s;
}

/** One message per network that is wrong, keyed by network; empty when every link is fine. */
export function socialLinkErrors(links: SocialLinks): Partial<Record<SocialNetwork, string>> {
  const e: Partial<Record<SocialNetwork, string>> = {};
  for (const [k, v] of Object.entries(links) as [SocialNetwork, string | undefined][]) {
    if (!v || !v.trim()) continue;
    if (!SOCIAL_NETWORKS.includes(k)) { e[k] = 'Unknown network.'; continue; }
    if (v.trim().length > 300) e[k] = 'That address is too long (300 characters at most).';
    else if (!HTTPS_URL.test(v.trim())) e[k] = `Use the full ${NETWORK_LABEL[k]} address, starting with https://`;
  }
  return e;
}

/** Only the links that are set, trimmed, in the network order; the shape the database takes. */
export function cleanSocialLinks(links: SocialLinks): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of SOCIAL_NETWORKS) { const v = links[n]?.trim(); if (v) out[n] = v; }
  return out;
}

/** Safe https link or null (never a javascript: or http: address). */
export const safeHttpsUrl = (u: string | null | undefined): string | null => (u && /^https:\/\//.test(u) ? u : null);

/** The links to show, in network order, only those that are safe addresses. */
export function visibleSocialLinks(links: SocialLinks | null | undefined): Array<{ network: SocialNetwork; url: string }> {
  if (!links) return [];
  const out: Array<{ network: SocialNetwork; url: string }> = [];
  for (const n of SOCIAL_NETWORKS) { const url = safeHttpsUrl(links[n]); if (url) out.push({ network: n, url }); }
  return out;
}

/** A short host-based label for an "other" link: "three.example". */
export function hostLabel(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return 'Website'; }
}
