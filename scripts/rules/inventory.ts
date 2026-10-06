/**
 * Pack 22: reads a saved copy of the governing body's rules page (for Buhurt International: https://www.buhurtinternational.com/rules) and lists
 * every official document it links to, in page order, with the committee section and the sub-heading it sits under.
 *
 * Deterministic and dependency-free so the inventory can be rebuilt from the committed snapshot by anyone:
 *   node scripts/rules/inventory-cli.ts rules-library/buhurt-international/snapshots/2026-10-06-rules-page.html.gz > rules-library/buhurt-international/source-inventory.json
 *
 * It records only what the page itself says (labels, links, grouping). It does not read the documents and it never guesses a version or date:
 * the page does not print them, so they stay null until the document itself is imported.
 */

export type DocumentHost = 'site_file' | 'drive_file' | 'drive_folder';
export interface InventoryDocument {
  /** Stable key from the committee and the label, e.g. "marshal/buhurt-rules". */
  key: string;
  label: string;
  committee: string;
  /** The heading the link sits under on the page, when there is one (only the Authenticity section uses them today). */
  heading: string | null;
  url: string;
  host: DocumentHost;
  /** The file id inside the host: the site file name or the Google Drive id. Lets a later snapshot be matched even when labels change. */
  ref: string;
  /** Position on the page, from 1. */
  order: number;
}
export interface InventorySection { key: string; name: string; intro: string }
export interface Inventory { page_url: string; page_title: string; sections: InventorySection[]; documents: InventoryDocument[] }

const DECODE: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return DECODE[e.toLowerCase()] ?? m;
  });
const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();
export const slug = (s: string) => clean(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** "Here you will find all the Documents that are approved by the Marshal committee ( MC)" → the committee section. */
const COMMITTEE_INTRO = /approved by the (Board of Directors|Marshal committee|Tournament Committee|Authenticity committee)/i;
const COMMITTEE_KEY: Record<string, string> = { 'board of directors': 'executive', 'marshal committee': 'marshal', 'tournament committee': 'tournament', 'authenticity committee': 'authenticity' };
const COMMITTEE_NAME: Record<string, string> = { executive: 'Executive (Board of Directors)', marshal: 'Marshal Committee', tournament: 'Tournament Committee', authenticity: 'Authenticity Committee' };

export function hostOf(url: string): { host: DocumentHost; ref: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const file = u.pathname.match(/\/_files\/ugd\/([A-Za-z0-9_]+\.pdf)$/);
  if (file && /(^|\.)buhurtinternational\.com$/.test(u.hostname)) return { host: 'site_file', ref: file[1] };
  if (u.hostname === 'drive.google.com') {
    const f = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/); if (f) return { host: 'drive_file', ref: f[1] };
    const d = u.pathname.match(/^\/drive\/folders\/([A-Za-z0-9_-]+)/); if (d) return { host: 'drive_folder', ref: d[1] };
  }
  return null;
}

interface Tok { kind: 'text' | 'link'; text: string; href?: string }

/** A flat list of visible text runs and links, in page order (scripts, styles and templates removed). */
export function tokenize(html: string): Tok[] {
  const body = html.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const out: Tok[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>|<[^>]+>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) {
      const href = m[1].match(/\bhref\s*=\s*"([^"]*)"/i)?.[1] ?? m[1].match(/\bhref\s*=\s*'([^']*)'/i)?.[1];
      const text = clean(m[2].replace(/<[^>]+>/g, ' '));
      out.push({ kind: 'link', text, href: href ? decodeEntities(href) : undefined });
    } else if (m[3] !== undefined) {
      const t = clean(m[3]);
      if (t) out.push({ kind: 'text', text: t });
    }
  }
  return out;
}

export function parseRulesPage(html: string): Inventory {
  const title = clean(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] ?? '';
  const toks = tokenize(html);
  const sections: InventorySection[] = [];
  const documents: InventoryDocument[] = [];
  const seen = new Set<string>();
  let section: string | null = null;
  let heading: string | null = null;
  let introBuf: string[] | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'text') {
      const c = t.text.match(COMMITTEE_INTRO);
      if (c) {
        section = COMMITTEE_KEY[c[1].toLowerCase()];
        heading = null;
        introBuf = [t.text];
        // The intro sentence is split around the committee abbreviation, e.g. "( MC)": keep the next short pieces up to the closing bracket.
        for (let j = i + 1; j < toks.length && j < i + 4 && toks[j].kind === 'text' && !/\)/.test(introBuf.join(' ')); j++) introBuf.push(toks[j].text);
        if (!sections.some(s => s.key === section)) sections.push({ key: section, name: COMMITTEE_NAME[section], intro: introBuf.join(' ').replace(/\s+\)/g, ')').replace(/\(\s+/g, '(').replace(/^(.*?\)).*$/, '$1') });
        continue;
      }
      if (/^contact us$/i.test(t.text)) { section = null; heading = null; continue; }
      // A short run of plain text inside a section is a heading the following links sit under ("Helmets Requirements", "General Requirements").
      // The label of a link never reaches here (links are one token), and the forum / email prose is longer or contains punctuation.
      if (section && t.text.length <= 60 && /^[A-Za-z][A-Za-z0-9 &(),'/-]*$/.test(t.text) && !/^(click here|marshal|tournament|executive|authenticity)$/i.test(t.text)) heading = t.text;
      continue;
    }
    if (!section || !t.href) continue;
    const h = hostOf(t.href);
    if (!h) continue;
    const label = t.text;
    if (!label) continue;
    const id = `${h.host}:${h.ref}`;
    if (seen.has(id)) continue;   // the same file linked twice on the page is ONE document
    seen.add(id);
    // A link's own label repeated as plain text right after it is the button caption, not a heading.
    if (heading && slug(heading) === slug(label)) heading = null;
    let key = `${section}/${slug(label)}`;
    if (documents.some(d => d.key === key)) key = `${key}-${slug(heading ?? String(documents.length + 1))}`;
    documents.push({ key, label, committee: section, heading: section === 'authenticity' && h.host !== 'drive_folder' ? heading : null, url: t.href, host: h.host, ref: h.ref, order: documents.length + 1 });
  }
  return { page_url: canonical, page_title: title, sections, documents };
}
