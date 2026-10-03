import { useState } from 'react';
import { hostLabel, NETWORK_LABEL, normalizeSocialUrl, SOCIAL_NETWORKS, visibleSocialLinks, type SocialLinks, type SocialNetwork } from '../lib/social';

/** Small recognisable icons (inline SVG, currentColor) for each network. */
const ICON: Record<SocialNetwork, React.ReactNode> = {
  facebook: <path d="M14 8h2V5h-2c-2.2 0-3.5 1.4-3.5 3.6V11H8v3h2.5v7h3v-7H16l.5-3h-3V9c0-.6.3-1 .5-1Z" fill="currentColor" stroke="none" />,
  instagram: <><rect x="4" y="4" width="16" height="16" rx="4.5" /><circle cx="12" cy="12" r="3.6" /><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" /></>,
  youtube: <><rect x="3" y="6" width="18" height="12" rx="3.5" /><path d="m10.5 9.5 4.5 2.5-4.5 2.5Z" fill="currentColor" stroke="none" /></>,
  tiktok: <path d="M14 4v9.5a3 3 0 1 1-3-3M14 4c.3 2.6 2 4.3 4.5 4.5" />,
  x: <path d="M5 4h4l10 16h-4L5 4ZM19 4l-6 7M5 20l6-7" />,
  discord: <><path d="M7 6.5A14 14 0 0 1 10 5.5l.5 1a12 12 0 0 1 3 0l.5-1a14 14 0 0 1 3 1c2 3 2.5 6 2.3 9a13 13 0 0 1-4 2l-.9-1.4" /><path d="M6.7 15.5a13 13 0 0 0 4 2l.9-1.4M4.7 15.5c-.2-3 .3-6 2.3-9" /><circle cx="9.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="14.5" cy="12" r="1.2" fill="currentColor" stroke="none" /></>,
  twitch: <path d="M5 4h14v10l-4 4h-3l-2 2H8v-2H5V4Zm5 4v4m4-4v4" />,
  other: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" /></>
};

export function SocialIcon({ network }: { network: SocialNetwork }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[network]}</svg>;
}

/**
 * The public row of a team's or fighter's links: small icon buttons that open in a new tab. Renders nothing when there are no links,
 * so an empty profile shows no empty box.
 */
export function SocialLinksRow({ links, label, website }: { links: SocialLinks | null | undefined; label: string; website?: string | null }) {
  const items = visibleSocialLinks(links);
  const site = website && /^https:\/\//.test(website) ? website : null;
  if (items.length === 0 && !site) return null;
  return (
    <ul className="sociallinks" aria-label={label}>
      {site && <li><a className="sociallink" href={site} target="_blank" rel="noopener noreferrer nofollow" title={hostLabel(site)}><SocialIcon network="other" /><span>{hostLabel(site)}</span></a></li>}
      {items.map(l => (
        <li key={l.network}>
          <a className="sociallink" href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.network === 'other' ? hostLabel(l.url) : NETWORK_LABEL[l.network]} data-network={l.network}>
            <SocialIcon network={l.network} /><span>{l.network === 'other' ? hostLabel(l.url) : NETWORK_LABEL[l.network]}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The editor: one row per network in use, with a per-field error. Values are normalised on blur (https:// added, handles expanded), so a
 * phone keyboard's "Https://" or a bare "facebook.com/..." becomes an address the database accepts instead of a silent failure.
 */
export function SocialLinksEditor({ value, onChange, errors, idPrefix = 'social' }: { value: SocialLinks; onChange: (next: SocialLinks) => void; errors: Partial<Record<SocialNetwork, string>>; idPrefix?: string }) {
  const [nets, setNets] = useState<SocialNetwork[]>(() => SOCIAL_NETWORKS.filter(n => Boolean(value[n])));
  const set = (n: SocialNetwork, v: string) => { const next = { ...value }; if (v.trim() === '') delete next[n]; else next[n] = v; onChange(next); };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {nets.length === 0 && <p className="muted">No links yet. Add one below; they show as small buttons on the public page.</p>}
      {nets.map(n => (
        <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
          <label className="field-in" style={{ flex: 1, minWidth: 0 }} htmlFor={`${idPrefix}-${n}`}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><SocialIcon network={n} /> {NETWORK_LABEL[n]}</span>
            <input id={`${idPrefix}-${n}`} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={n === 'other' ? 'https://your-site.example' : `https://… or @handle`}
              value={value[n] ?? ''} aria-invalid={Boolean(errors[n])} onChange={e => set(n, e.target.value)} onBlur={e => set(n, normalizeSocialUrl(n, e.target.value))} />
            {errors[n] && <span role="alert" style={{ color: 'var(--live)' }}>{errors[n]}</span>}
          </label>
          <button type="button" className="btn btn-line" style={{ marginTop: 26 }} aria-label={`Remove ${NETWORK_LABEL[n]}`} onClick={() => { set(n, ''); setNets(list => list.filter(x => x !== n)); }}>Remove</button>
        </div>
      ))}
      {nets.length < SOCIAL_NETWORKS.length && (
        <label className="field-in" style={{ maxWidth: 280 }}>Add a link
          <select value="" onChange={e => { const n = e.target.value as SocialNetwork; if (n) setNets(list => [...list, n]); }}>
            <option value="">Choose a network…</option>
            {SOCIAL_NETWORKS.filter(n => !nets.includes(n)).map(n => <option key={n} value={n}>{NETWORK_LABEL[n]}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
