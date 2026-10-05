/** The address an OBS "browser source" opens. Public and read-only: it carries the event slug, the field and presentation options, nothing else. */
export type OverlayLayout = 'full' | 'bug' | 'queue' | 'sponsors';
export type OverlayBackground = 'transparent' | 'green' | 'dark';

export const LAYOUT_LABEL: Record<OverlayLayout, string> = {
  full: 'Everything (score bug, fighters, order, sponsors)', bug: 'Score bug only', queue: 'Fight order only', sponsors: 'Sponsors only'
};
export const BACKGROUND_LABEL: Record<OverlayBackground, string> = { transparent: 'Transparent (normal for OBS)', green: 'Green screen', dark: 'Dark (for checking)' };
export const OBS_SIZE = { width: 1920, height: 1080 } as const;

export function overlayUrl(origin: string, base: string, slug: string, field: string | null, opts: { layout?: OverlayLayout; bg?: OverlayBackground } = {}): string {
  const root = `${origin.replace(/\/+$/, '')}/${base.replace(/^\/+|\/+$/g, '')}`.replace(/\/+$/, '');
  const path = `${root}/broadcast/${encodeURIComponent(slug)}${field ? `/${encodeURIComponent(field)}` : ''}`;
  const q = new URLSearchParams();
  if (opts.layout && opts.layout !== 'full') q.set('layout', opts.layout);
  if (opts.bg && opts.bg !== 'transparent') q.set('bg', opts.bg);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
