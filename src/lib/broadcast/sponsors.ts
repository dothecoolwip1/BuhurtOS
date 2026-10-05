/** Sponsor presentation: title sponsors are always on screen; partners rotate a few at a time. Pure and deterministic from the clock, so every overlay shows the same thing. */
export interface Sponsor { id: string; name: string; logoUrl: string | null; linkUrl: string | null; tier: 'title' | 'partner'; sortOrder: number; onBroadcast: boolean }

export const bySponsorOrder = (a: Sponsor, b: Sponsor): number => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/** The sponsors for the broadcast strip: all title sponsors, then a window of `window` partners that advances every `seconds` seconds. */
export function visibleSponsors(all: readonly Sponsor[], nowMs: number, seconds: number, window = 3): { title: Sponsor[]; partners: Sponsor[]; page: number; pages: number } {
  const on = all.filter(s => s.onBroadcast).sort(bySponsorOrder);
  const title = on.filter(s => s.tier === 'title');
  const partners = on.filter(s => s.tier === 'partner');
  const size = Math.max(1, window);
  const pages = Math.max(1, Math.ceil(partners.length / size));
  const slot = Math.floor(nowMs / (Math.max(3, seconds) * 1000));
  const page = pages === 1 ? 0 : ((slot % pages) + pages) % pages;
  return { title, partners: partners.slice(page * size, page * size + size), page, pages };
}
