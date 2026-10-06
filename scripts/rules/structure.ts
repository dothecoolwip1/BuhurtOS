/**
 * Pack 22 importer, step 3: turns the page text of ONE official document (pdftotext output, one string per page) into provisions in reading order.
 *
 * Principles (see rules-library/README.md):
 *   - every line of the source is accounted for: it belongs to exactly one provision, or it is recorded as repeated page furniture (header, footer,
 *     page number). Nothing is dropped silently; reconcile.ts proves it.
 *   - numbering is only believed when it follows the document's own sequence (1, 1.1, 1.2, 2 ...). A number that does not fit is left in the text and
 *     reported as a possible missed heading for a person to check.
 *   - anything the extractor cannot read with confidence (pages without text, table-like layout, a number printed twice, text before the first
 *     numbered heading) is marked needs_review with the reason. A version with open review items can be stored but never published.
 *   - the official words are not rewritten: lines are trimmed and wrapped lines joined, nothing else.
 */
import { createHash } from 'node:crypto';

export interface SourcePage { page: number; text: string }
export interface SourceLine { id: string; page: number; text: string }
export type ProvisionKind = 'part' | 'section' | 'rule' | 'definition' | 'table' | 'figure' | 'note' | 'appendix' | 'unstructured';
export interface Provision {
  ordinal: number; depth: number; kind: ProvisionKind; number: string | null; title: string | null; body: string;
  page_from: number | null; page_to: number | null; stable_key: string; parent_key: string | null;
  review_status: 'extracted' | 'needs_review' | 'verified'; review_note: string | null;
  topics: string[]; keywords: string[]; cross_refs: string[]; content_sha256: string;
  /** Source line ids ("page:index") this provision was built from. Kept in the structured file for reconciliation; not stored in the database. */
  lines: string[];
}
export interface Furniture { id: string; page: number; text: string; reason: string }
export interface StructureResult {
  provisions: Provision[]; furniture: Furniture[]; lines: SourceLine[];
  /** Lines that looked like a numbered heading but did not fit the sequence: left in the text, listed for review. */
  rejected_numbers: { id: string; text: string; expected: string }[];
  empty_pages: number[];
  detected: { version: string | null; date: string | null };
}

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** The same definition as private.rule_content_sha256 in the database. */
export const contentSha256 = (number: string | null, title: string | null, body: string) => sha256(`${number ?? ''}\n${title ?? ''}\n${body}`);

const norm = (s: string) => s.replace(/ /g, ' ').replace(/[ \t]+$/g, '');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export function splitLines(pages: SourcePage[]): SourceLine[] {
  const out: SourceLine[] = [];
  for (const p of pages) {
    const ls = p.text.replace(/\r\n?/g, '\n').split('\n');
    ls.forEach((t, i) => out.push({ id: `${p.page}:${i}`, page: p.page, text: norm(t) }));
  }
  return out;
}

/** "Page 3 of 12", "3", "- 3 -", "3/12": a page number on its own line. */
const PAGE_NUMBER = /^(?:page\s*)?-?\s*\d{1,4}\s*-?(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const shape = (t: string) => squash(t).toLowerCase().replace(/\d+/g, '#');

/**
 * Repeated page furniture: a line within the first or last three non-empty lines of a page whose shape (digits ignored) appears on at least half of
 * the pages of a document of three pages or more, and page-number lines at the top or bottom of any page.
 */
export function findFurniture(lines: SourceLine[], pageCount: number): Map<string, string> {
  const byPage = new Map<number, SourceLine[]>();
  for (const l of lines) if (squash(l.text)) { const a = byPage.get(l.page) ?? []; a.push(l); byPage.set(l.page, a); }
  const edges = new Map<number, SourceLine[]>();
  for (const [p, ls] of byPage) edges.set(p, [...ls.slice(0, 3), ...ls.slice(Math.max(3, ls.length - 3))]);
  const counts = new Map<string, Set<number>>();
  for (const [p, ls] of edges) for (const l of ls) { const k = shape(l.text); const s = counts.get(k) ?? new Set(); s.add(p); counts.set(k, s); }
  const out = new Map<string, string>();
  for (const [, ls] of edges) for (const l of ls) {
    const t = squash(l.text);
    if (PAGE_NUMBER.test(t)) { out.set(l.id, 'page number'); continue; }
    if (pageCount >= 3 && (counts.get(shape(t))?.size ?? 0) >= Math.ceil(pageCount / 2) && t.length <= 160) out.set(l.id, 'repeated on most pages (header or footer)');
  }
  return out;
}

/** "1", "1.2", "1.2.3." at the start of a line, followed by text. */
const NUMBERED = /^\s*(\d{1,3}(?:\.\d{1,3}){0,5})\.?\)?\s+(\S.*)$/;
const NUMBER_ONLY = /^\s*(\d{1,3}(?:\.\d{1,3}){0,5})\.?\s*$/;
const APPENDIX = /^\s*(appendix|annex|annexe)\s+([A-Z0-9]{1,4})\b[.:\s-]*(.*)$/i;

export function detectVersion(text: string): string | null {
  const m = text.match(/\b(?:version|ver\.?|v)\s*\.?\s*(\d{1,4}(?:\.\d{1,3}){1,3})\b/i);
  return m ? m[1] : null;
}
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
export function detectDate(text: string): string | null {
  const iso = text.match(/\b(20\d\d)-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d\d)\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;   // European day.month.year; confirmed by a person in the overrides
  const md = text.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, 'i'))
    ?? text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?,?\\s+(20\\d\\d)\\b`, 'i'));
  if (md) {
    const [a, b, y] = [md[1], md[2], md[3]];
    const monthWord = isNaN(Number(a)) ? a : b; const day = isNaN(Number(a)) ? b : a;
    const mi = MONTHS.split('|').findIndex(m => m === monthWord.toLowerCase().replace('.', ''));
    const month = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 6, 7, 8, 9, 9, 10, 11, 12][mi];
    return `${y}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

/** "see 4.2", "rule 3.1.4", "§ 6", "section 2.3": provision numbers this text refers to. */
export function crossRefs(text: string, own: string | null): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:§\s*|\b(?:see|rule|rules|section|sections|point|points|article|paragraph|under|in)\s+)(\d{1,3}(?:\.\d{1,3}){0,5})\b/gi)) {
    const n = m[1].replace(/\.$/, '');
    if (n !== own) out.add(n);
  }
  return [...out].slice(0, 40);
}

const TABLE_LINE = /\S {3,}\S.* {3,}\S/;
const isTitleLike = (t: string) => t.length <= 90 && !/[.:;,]$/.test(t) && !/^[a-z]/.test(t);

/** Wrapped lines are joined; a new line is kept before bullets, list letters and after sentence ends followed by a capital. */
export function joinBody(lines: string[]): string {
  const out: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    const prev = out.length ? out[out.length - 1] : '';
    const startsItem = /^([•●▪◦\-–*]|\(?[a-z]\)|\(?[ivx]{1,4}\)|\(?\d{1,2}\))\s/.test(t);
    if (prev && !startsItem && !TABLE_LINE.test(raw) && (!/[.:;!?]$/.test(prev) || /^[a-z(]/.test(t))) out[out.length - 1] = `${prev} ${squash(t)}`;
    else out.push(TABLE_LINE.test(raw) ? t.replace(/\s{3,}/g, '   ') : squash(t));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

const cmp = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function structureDocument(pages: SourcePage[], series: string): StructureResult {
  const lines = splitLines(pages);
  const furnitureIds = findFurniture(lines, pages.length);
  const furniture: Furniture[] = [];
  const emptyPages = pages.filter(p => squash(p.text).replace(/\d+/g, '').length < 20).map(p => p.page);
  const firstText = pages.slice(0, 2).map(p => p.text).join('\n');
  const detected = { version: detectVersion(firstText), date: detectDate(firstText) };

  interface Open { number: string | null; nums: number[]; prefix: string | null; kind: ProvisionKind; title: string | null; lines: SourceLine[]; heads: SourceLine[]; notes: string[]; depth: number }
  const opened: Open[] = [];
  let cur: Open = { number: null, nums: [], prefix: null, kind: 'unstructured', title: null, lines: [], heads: [], notes: [], depth: 0 };
  // The last accepted number at each depth, e.g. [[3], [3,2], [3,2,1]]. An appendix starts a fresh sequence under its own prefix.
  const path: number[][] = [];
  let prefix: string | null = null;
  const rejected: StructureResult['rejected_numbers'] = [];
  const flush = () => { if (cur.heads.length || cur.lines.some(l => squash(l.text))) opened.push(cur); };

  const lastTop = () => path[0]?.[0] ?? 0;
  /** Does n continue the sequence? implied: ancestors that were never printed ("2.1" straight after "1.4"). */
  const fits = (n: number[]): { ok: boolean; gap: boolean; implied: boolean; expected: string } => {
    const d = n.length - 1;
    if (d === 0) {
      const last = lastTop();
      const ok = n[0] > last && n[0] - last <= 3;
      return { ok, gap: ok && n[0] - last > 1, implied: false, expected: String(last + 1) };
    }
    const parent = path[d - 1];
    if (parent && cmp(parent, n.slice(0, d))) {
      const sib = path[d] && cmp(path[d].slice(0, d), parent) ? path[d][d] : 0;
      const ok = n[d] > sib && n[d] - sib <= 3;
      return { ok, gap: ok && n[d] - sib > 1, implied: false, expected: `${parent.join('.')}.${sib + 1}` };
    }
    if (n[d] === 1) { const up = fits(n.slice(0, d)); if (up.ok) return { ok: true, gap: up.gap, implied: true, expected: up.expected }; }
    return { ok: false, gap: false, implied: false, expected: parent ? `${parent.join('.')}.1` : `${lastTop() + 1}` };
  };
  const accept = (nums: number[]) => { for (let k = 0; k < nums.length; k++) path[k] = nums.slice(0, k + 1); path.length = nums.length; };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (furnitureIds.has(l.id)) { furniture.push({ id: l.id, page: l.page, text: l.text, reason: furnitureIds.get(l.id)! }); continue; }
    const t = l.text;
    const app = t.match(APPENDIX);
    if (app && t.trim().length <= 120) {
      flush();
      prefix = `${app[1][0].toUpperCase()}${app[1].slice(1).toLowerCase()} ${app[2].toUpperCase()}`;
      cur = { number: prefix, nums: [], prefix: null, kind: 'appendix', title: squash(app[3]) || null, lines: [], heads: [l], notes: [], depth: 0 };
      path.length = 0;
      continue;
    }
    let m = t.match(NUMBERED);
    let next: SourceLine | null = null;
    if (!m) {
      const only = t.match(NUMBER_ONLY);
      // "4." alone on a line with its heading on the next one
      if (only && i + 1 < lines.length && squash(lines[i + 1].text) && !furnitureIds.has(lines[i + 1].id)) { m = [t, only[1], ''] as unknown as RegExpMatchArray; next = lines[i + 1]; }
    }
    if (m) {
      const nums = m[1].split('.').map(Number);
      const f = fits(nums);
      if (f.ok) {
        flush();
        accept(nums);
        const d = nums.length - 1 + (prefix ? 1 : 0);
        cur = { number: nums.join('.'), nums, prefix, kind: d === 0 ? 'section' : 'rule', title: null, lines: [], heads: [l], notes: [], depth: Math.min(d, 8) };
        if (f.gap) cur.notes.push(`numbering skips to ${nums.join('.')} (expected ${f.expected}): check the official document for a missing provision`);
        if (f.implied) cur.notes.push(`${nums.join('.')} has no printed parent heading`);
        const rest = next ? squash(next.text) : squash(m[2]);
        if (next) { cur.heads.push(next); i++; }
        if (rest) { if (isTitleLike(rest)) cur.title = rest; else cur.lines.push({ ...(next ?? l), text: rest }); }
        continue;
      }
      if (/^\s*\d{1,3}\.\d/.test(t)) rejected.push({ id: l.id, text: squash(t).slice(0, 120), expected: f.expected });
    }
    cur.lines.push(l);
  }
  flush();

  // Provisions with parents, keys and review flags.
  const seenKeys = new Map<string, number>();
  const provisions: Provision[] = [];
  const keyOfNumber = new Map<string, string>();
  const seriesKey = series.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const keyPart = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  opened.forEach((o, idx) => {
    const ordinal = idx + 1;
    const body = joinBody(o.lines.map(l => l.text));
    const ids = [...new Set([...o.heads.map(h => h.id), ...o.lines.map(l => l.id)])];
    const pagesUsed = [...o.heads.map(h => h.page), ...o.lines.filter(l => squash(l.text)).map(l => l.page)];
    const notes = [...o.notes];
    if (o.kind === 'unstructured') notes.push('text before the first numbered heading: check how the official document presents it');
    if (o.lines.some(l => TABLE_LINE.test(l.text))) notes.push('layout looks like a table or columns: compare with the official page');
    const scoped = o.prefix && o.number ? `${o.prefix} ${o.number}` : o.number;
    let key = scoped ? `${seriesKey}:${keyPart(scoped)}` : `${seriesKey}:p${String(ordinal).padStart(4, '0')}`;
    const dup = seenKeys.get(key) ?? 0;
    seenKeys.set(key, dup + 1);
    if (dup) { notes.push(`number ${scoped} is printed more than once in this document`); key = `${key}.dup${dup + 1}`; }
    let parent: string | null = null;
    if (o.nums.length > 1) {
      const pn = o.nums.slice(0, -1).join('.');
      parent = keyOfNumber.get(o.prefix ? `${o.prefix} ${pn}` : pn) ?? null;
    } else if (o.nums.length === 1 && o.prefix) parent = keyOfNumber.get(o.prefix) ?? null;
    if (scoped && !dup) keyOfNumber.set(scoped, key);
    provisions.push({
      ordinal, depth: o.depth, kind: o.kind, number: o.number, title: o.title, body,
      page_from: pagesUsed.length ? Math.min(...pagesUsed) : null, page_to: pagesUsed.length ? Math.max(...pagesUsed) : null,
      stable_key: key, parent_key: parent,
      review_status: notes.length ? 'needs_review' : 'extracted', review_note: notes.length ? notes.join('; ').slice(0, 1000) : null,
      topics: [], keywords: [], cross_refs: crossRefs(body, o.number), content_sha256: contentSha256(o.number, o.title, body), lines: ids
    });
  });
  // A page with no extractable text (an image or a scan) is a figure nobody has read yet: it gets its own provision so it is never silently missing.
  for (const p of emptyPages) {
    const ordinal = provisions.length + 1;
    const body = `Page ${p} of the official document has no extractable text (it is probably an image, a chart or a scan). Read it in the official document.`;
    provisions.push({ ordinal, depth: 0, kind: 'figure', number: null, title: `Page ${p}: not readable as text`, body, page_from: p, page_to: p,
      stable_key: `${seriesKey}:page-${p}`, parent_key: null, review_status: 'needs_review', review_note: 'no extractable text on this page', topics: [], keywords: [], cross_refs: [],
      content_sha256: contentSha256(null, `Page ${p}: not readable as text`, body), lines: [] });
  }
  return { provisions, furniture, lines, rejected_numbers: rejected, empty_pages: emptyPages, detected };
}
