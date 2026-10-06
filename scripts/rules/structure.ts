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

export interface OcrLine {
  text: string; conf_mean: number; conf_min: number; words: number; uncertain: string[];
  /** What OCR produced before a bullet glyph was written as the document's own "●"/"○" (read from the page image). */
  raw?: string;
  /** Marks read from the coloured band at the left edge (solid colour, no ink), left out of the text. */
  dropped?: string[];
  /** Set when the page image shows the line is lettering inside a picture (a logo, a copyright on a photo, a drawing's marks): the reason. */
  in_picture?: string;
  box?: number[]; paper?: number; height?: number;
}
export interface SourcePage {
  page: number; text: string;
  /** 'text': the PDF's own text layer (pdftotext); 'ocr': the page is an image of text, read by OCR. */
  method?: 'text' | 'ocr';
  /** The page carries pictures (photos, drawings) in the official document. */
  figures?: boolean;
  ocr_engine?: string; ocr_mean_conf?: number | null;
  /** OCR's own confidence for every non-empty line, in order. */
  ocr_lines?: OcrLine[];
}
export interface SourceLine { id: string; page: number; text: string }
export type ProvisionKind = 'part' | 'section' | 'rule' | 'definition' | 'table' | 'figure' | 'note' | 'appendix' | 'unstructured';
export interface Provision {
  ordinal: number; depth: number; kind: ProvisionKind; number: string | null; title: string | null; body: string;
  page_from: number | null; page_to: number | null; stable_key: string; parent_key: string | null;
  review_status: 'extracted' | 'needs_review' | 'verified'; review_note: string | null;
  topics: string[]; keywords: string[]; cross_refs: string[]; content_sha256: string;
  /** The official pages this provision is on carry pictures: the rule page says so and links to the page. */
  has_figures: boolean;
  /** How its words were read: the PDF's text layer, OCR of a page image, or both. */
  extraction: 'text' | 'ocr' | 'mixed';
  /** Source line ids ("page:index") this provision was built from. Kept in the structured file for reconciliation; not stored in the database. */
  lines: string[];
}
export interface Furniture { id: string; page: number; text: string; reason: string }
export interface StructureResult {
  provisions: Provision[]; furniture: Furniture[]; lines: SourceLine[];
  /** Lines that looked like a numbered heading but did not fit the sequence: left in the text, listed for review. */
  rejected_numbers: { id: string; text: string; expected: string }[];
  /** Reviewed OCR fixes applied to this document (misread or missed lines, checked against the page image). Always reported. */
  ocr_corrections: { id: string; from: string | null; to: string; reason: string }[];
  empty_pages: number[];
  detected: { version: string | null; date: string | null };
}

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** The same definition as private.rule_content_sha256 in the database. */
export const contentSha256 = (number: string | null, title: string | null, body: string) => sha256(`${number ?? ''}\n${title ?? ''}\n${body}`);

// Non-breaking and zero-width spaces (the BI documents put a zero-width space after every heading number) count as plain spaces.
const norm = (s: string) => s.replace(/[\u00a0\u200b\u2009\u202f\ufeff]/g, ' ').replace(/[ \t]+$/g, '');
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
// Groups: 1 the number, 2 its punctuation ("5." / "5)" / none), 3 the rest of the line.
const NUMBERED = /^\s*(\d{1,3}(?:\.\d{1,3}){0,5})(\.?\)?)(?:\s+|(?<=\.)(?=[A-Z]))(\S.*)$/;   // "2.1.Sanctions" (no space) counts too
const NUMBER_ONLY = /^\s*(\d{1,3}(?:\.\d{1,3}){0,5})(\.?)\s*$/;
// One to three stray characters OCR reads from a coloured edge band before a heading number ("_ 4.4.", "—_ 5.", "i 6.").
const OCR_EDGE = /^\s*(?:[_|~\u2014\u2013\-\u2022\u00b7'\u2018\u2019"\u201c\u201d\u00a9\u00ae=]{1,3}|[il]|7(?=\s+\d{1,3}\.))\s*(?=\d)/;   // also "7 4. Scales" and "= 6. Scale"
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

const TABLE_GAPS = /\S {3,}\S.* {3,}\S/;
/** Columns: two or more wide gaps. Not justified prose, where EVERY gap between words is wide ("Competitors   who   deviate   from"). */
const isTableLine = (raw: string) => TABLE_GAPS.test(raw) && !(raw.trim().split(/\s+/).length >= 4 && !/\S \S/.test(raw.trim()));
const TABLE_LINE = { test: isTableLine };
const isTitleLike = (t: string) => t.length <= 90 && !/[.:;,]$/.test(t) && !/^[a-z]/.test(t);

/** Wrapped lines are joined; a new line is kept before bullets, list letters and after sentence ends followed by a capital. */
export function joinBody(lines: string[]): string {
  const out: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    const prev = out.length ? out[out.length - 1] : '';
    if (t.startsWith('|') || prev.startsWith('|')) {
      if (prev && (t.startsWith('|') !== prev.startsWith('|'))) out.push('');
      out.push(t.startsWith('|') ? t : squash(t));
      continue;
    }
    const startsItem = /^([•●▪◦\-–*]|\(?[a-z]\)|\(?[ivx]{1,4}\)|\(?\d{1,2}\))\s/.test(t);
    if (prev && !startsItem && !TABLE_LINE.test(raw) && (!/[.:;!?]$/.test(prev) || /^[a-z(]/.test(t))) out[out.length - 1] = `${prev} ${squash(t)}`;
    else out.push(TABLE_LINE.test(raw) ? t.replace(/\s{3,}/g, '   ') : squash(t));
    if (!TABLE_LINE.test(raw)) out[out.length - 1] = out[out.length - 1].replace(/ {2,}/g, ' ');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

const cmp = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A table-of-contents entry: ends with a page number after dot leaders or a gap, or with "(page N)". */
const TOC_ENTRY = /(\.{3,}|\s{2,}|\t|…)\s*\d{1,3}\s*$|\(page \d{1,3}\)\s*$/i;
/**
 * Furniture that is not rule text but must still be accounted for:
 *   - the table of contents (the heading to the end of its page, and following pages that are mostly contents entries): it is derived from the
 *     headings that follow, and reading it as provisions would print every heading twice;
 *   - "page N/M" footers (the document's own page numbering);
 *   - on OCR pages, lines OCR could barely read that are a few words of logo or artwork, not text.
 */
export function findStructuralFurniture(lines: SourceLine[], pages: SourcePage[]): Map<string, string> {
  const out = new Map<string, string>();
  const byPage = new Map<number, SourceLine[]>();
  for (const l of lines) { const a = byPage.get(l.page) ?? []; a.push(l); byPage.set(l.page, a); }
  const count = pages.length;
  let tocPage: number | null = null;
  for (const [p, ls] of byPage) {
    const h = ls.findIndex(l => /^\s*table of contents?\s*$/i.test(squash(l.text)));
    if (h >= 0 && tocPage === null) { tocPage = p; ls.slice(h).forEach(l => { if (squash(l.text)) out.set(l.id, 'table of contents'); }); }
  }
  // A contents page without the heading: one of the first three pages where at least five lines, and most lines, are contents entries.
  if (tocPage === null) {
    for (const [p, ls] of byPage) {
      if (p > 3) continue;
      const ne = ls.filter(l => squash(l.text));
      const entries = ne.filter(l => TOC_ENTRY.test(l.text.replace(/\s+$/, '')) && /^\s*\d/.test(l.text));
      // From the first entry to the end of the page (wrapped entries lose their page-number gap).
      if (entries.length >= 5 && entries.length / ne.length >= 0.6) { tocPage = p; ne.slice(ne.indexOf(entries[0])).forEach(l => out.set(l.id, 'table of contents')); break; }
    }
  }
  if (tocPage !== null) {
    for (let p = tocPage + 1; byPage.has(p); p++) {
      const ne = byPage.get(p)!.filter(l => squash(l.text));
      // A continuation page: mostly contents entries or short numbered lines, or it says where the contents end.
      const shortNumbered = (l: SourceLine) => /^\s*\d{1,3}(?:\.\d{1,3}){0,4}\.?\s+\S.{0,70}$/.test(l.text) && !/[.;:]$/.test(squash(l.text));
      if (!ne.length || (ne.filter(l => TOC_ENTRY.test(squash(l.text)) || shortNumbered(l)).length / ne.length < 0.7 && !ne.some(l => /end of (the )?content(s)? table/i.test(l.text)))) break;
      ne.forEach(l => out.set(l.id, 'table of contents'));
    }
  }
  for (const [p, ls] of byPage) {
    const ne = ls.filter(l => squash(l.text));
    // The document's own footer: "<title> V. 26.1  4/7". Matched by the version marker and an N/M page number (the printed N is sometimes stale,
    // so it is not required to equal the real page), within the last two lines of the page.
    for (const l of ne.slice(-2)) {
      const t = squash(l.text);
      if (t.length <= 90 && (new RegExp(`\\b${p}\\s*/\\s*${count}\\s*$`).test(t) || (/\b\d{1,3}\s*\/\s*\d{1,3}\s*$/.test(t) && /\b[Vv]\s?\.?\s?\d/.test(t)))) out.set(l.id, 'page footer (page N/M)');
    }
    const pg = pages.find(x => x.page === p);
    if (pg?.method === 'ocr' && pg.ocr_lines) {
      ne.forEach((l, i) => {
        const o = pg.ocr_lines![i];
        // The page image shows lettering inside a picture: not document text. Every such line is listed in the release's picture-text review.
        if (o && o.text === squash(l.text) && o.in_picture && !out.has(l.id)) { out.set(l.id, `OCR: text inside a picture (${o.in_picture})`); return; }
        // Never a numbered heading (after the edge character); otherwise a few words, low confidence, and either very low confidence or several stray
        // symbols (logos read as letters: ")\\) BUHURT(Z").
        const stray = (o?.text.replace(/[A-Za-z0-9\s.,'’&-]/g, '') ?? '').length;
        // Junk only: a few "words" with no real word in them (four letters or more) at low confidence, or logo lettering on the cover. Anything
        // that might be text stays in and is flagged instead (a reviewer can then mark it as text inside a picture, with a reason).
        const realWord = /(^|\s)[A-Za-z]{4,}[.,:;!?]?(?=\s|$)/.test(o?.text ?? '');
        if (o && o.text === squash(l.text) && o.words <= 3 && !NUMBERED.test(o.text.replace(OCR_EDGE, ''))
            && ((o.conf_mean < 50 && !realWord) || (p === 1 && o.conf_mean < 70 && stray >= 2))) out.set(l.id, `OCR: logo or artwork, not text (confidence ${o.conf_mean})`);
      });
    }
  }
  return out;
}

/** Lines on OCR pages that hold a word OCR read with low confidence: line id -> the uncertain words. */
export function uncertainOcrLines(lines: SourceLine[], pages: SourcePage[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const pg of pages) {
    if (pg.method !== 'ocr' || !pg.ocr_lines) continue;
    const ne = lines.filter(l => l.page === pg.page && squash(l.text));
    ne.forEach((l, i) => { const o = pg.ocr_lines![i]; if (o && o.text === squash(l.text) && o.uncertain.length && !o.in_picture) out.set(l.id, o.uncertain); });
  }
  return out;
}

export interface OcrCorrections {
  /** Per line id: OCR read `from`, the page image shows `to`. `from` must match exactly, so a re-extraction that changed the line fails loudly. */
  fix?: Record<string, { from: string; to: string; reason: string }>;
  /** Lines OCR missed entirely, inserted after the given line id. */
  insert?: { after: string; text: string; reason: string }[];
}

/**
 * A table the official document prints, transcribed cell by cell by a reviewer from the page: `replaces` are the source lines the table's words
 * came from, `rows` the cells. A cell "^" continues the cell above (merged rows), "<" the cell to the left (merged columns), "" is an empty
 * cell, "<br>" separates paragraphs inside a cell. The cells must hold exactly the words of the replaced lines, no more, no fewer (checked; an extraction change makes it fail loudly).
 */
export interface TableSpec { replaces: string[]; rows: string[][]; header_rows?: number; note: string }
/** Reviewed layout facts: printed headings without a number (line id -> the heading's words, a prefix of the line) and transcribed tables. */
export interface Layout { headings?: Record<string, { title: string; kind?: ProvisionKind }>; tables?: TableSpec[] }

// "<br>" separates paragraphs inside one cell (layout, not a word).
const words = (s: string) => s.replace(/<br>/g, ' ').split(/\s+/).filter(w => w && w !== '^' && w !== '<');
export function renderTable(t: TableSpec): string[] {
  const width = Math.max(...t.rows.map(r => r.length));
  const row = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => (r[i] ?? '').replace(/\|/g, '/').trim()).join(' | ')} |`;
  const h = t.header_rows ?? 1;
  // No header row: the rows only (the rule page draws a table without a heading row).
  if (h === 0) return t.rows.map(row);
  return [...t.rows.slice(0, h).map(row), `|${' --- |'.repeat(width)}`, ...t.rows.slice(h).map(row)];
}
function checkTableWords(t: TableSpec, texts: string[]): void {
  const src = words(texts.join(' ')).sort();
  const cells = words(t.rows.flat().join(' ')).sort();
  const count = (a: string[]) => a.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>());
  const a = count(src), b = count(cells);
  const missing = [...a].filter(([w, n]) => (b.get(w) ?? 0) < n).map(([w]) => w);
  const extra = [...b].filter(([w, n]) => (a.get(w) ?? 0) < n).map(([w]) => w);
  if (missing.length || extra.length) throw new Error(`table at ${t.replaces[0]}: cells do not hold the source words (missing: ${missing.slice(0, 12).join(' ')}; not in source: ${extra.slice(0, 12).join(' ')})`);
}

export function structureDocument(pages: SourcePage[], series: string, noise: Record<string, string> = {}, corrections: OcrCorrections = {}, layout: Layout = {}): StructureResult {
  const lines = splitLines(pages);
  // Reviewed OCR corrections: only on OCR pages, only where the recorded reading still matches.
  const ocrCorrections: StructureResult['ocr_corrections'] = [];
  const ocrPages = new Set(pages.filter(pg => pg.method === 'ocr').map(pg => pg.page));
  for (const [id, c] of Object.entries(corrections.fix ?? {})) {
    const l = lines.find(x => x.id === id);
    if (!l || !ocrPages.has(l.page)) throw new Error(`OCR correction for ${id}: no such OCR line`);
    if (squash(l.text) !== squash(c.from)) throw new Error(`OCR correction for ${id}: the line now reads "${squash(l.text)}", not "${c.from}"`);
    l.text = c.to; ocrCorrections.push({ id, from: c.from, to: c.to, reason: c.reason });
  }
  for (const [k, ins] of (corrections.insert ?? []).entries()) {
    const at = lines.findIndex(x => x.id === ins.after);
    if (at < 0 || !ocrPages.has(lines[at].page)) throw new Error(`OCR insertion after ${ins.after}: no such OCR line`);
    const id = `${ins.after}+${k + 1}`;
    lines.splice(at + 1, 0, { id, page: lines[at].page, text: ins.text });
    ocrCorrections.push({ id, from: null, to: ins.text, reason: ins.reason });
  }
  const furnitureIds = findFurniture(lines, pages.length);
  for (const [id, why] of findStructuralFurniture(lines, pages)) furnitureIds.set(id, why);
  // A reviewer confirmed these lines are text inside a picture (a watermark, a sign in a photo), not document text.
  for (const [id, why] of Object.entries(noise)) furnitureIds.set(id, `reviewed: text inside a picture (${why})`);
  const uncertain = uncertainOcrLines(lines, pages);
  const pageMeta = new Map(pages.map(p => [p.page, p]));
  const furniture: Furniture[] = [];
  const emptyPages = pages.filter(p => squash(p.text).replace(/\d+/g, '').length < 20).map(p => p.page);
  const NUMBERED_ANY = /^\s*\d{1,3}(?:\.\d{1,3}){0,5}\.?\s+\S/;
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
    const hd = layout.headings?.[l.id];
    if (hd) {
      if (!squash(t).startsWith(hd.title)) throw new Error(`heading ${l.id}: the line reads "${squash(t)}", which does not start with "${hd.title}"`);
      flush();
      const rest = squash(t).slice(hd.title.length).trim();
      cur = { number: null, nums: [], prefix, kind: hd.kind ?? 'section', title: hd.title, lines: rest ? [{ ...l, text: rest }] : [], heads: [l], notes: [], depth: 0 };
      continue;
    }
    const app = t.match(APPENDIX);
    if (app && t.trim().length <= 120) {
      flush();
      prefix = `${app[1][0].toUpperCase()}${app[1].slice(1).toLowerCase()} ${app[2].toUpperCase()}`;
      cur = { number: prefix, nums: [], prefix: null, kind: 'appendix', title: squash(app[3]) || null, lines: [], heads: [l], notes: [], depth: 0 };
      path.length = 0;
      continue;
    }
    // On OCR pages a coloured band at the left edge is sometimes read as one stray character before a heading number ("_ 4.4. Aventails",
    // "i 6. Examples"). For heading detection only, that single character is ignored; it is never kept as text.
    const ht = pageMeta.get(l.page)?.method === 'ocr' ? t.replace(OCR_EDGE, '') : t;
    let m = ht.match(NUMBERED);
    let next: SourceLine | null = null;
    if (!m) {
      const only = ht.match(NUMBER_ONLY);
      // "4." alone on a line with its heading on the next one
      if (only && i + 1 < lines.length && squash(lines[i + 1].text) && !furnitureIds.has(lines[i + 1].id)) { m = [ht, only[1], only[2], ''] as unknown as RegExpMatchArray; next = lines[i + 1]; }
    }
    if (m) {
      const nums = m[1].split('.').map(Number);
      const restText = next ? squash(next.text) : squash(m[3]);
      // A bare top-level number is only a heading when the document prints it with its dot ("5." / "5)"): "6 vs 2 : stop fight" is a sentence.
      // And a heading that skips numbers must at least read like a title.
      const f0 = fits(nums);
      // The exception: a dotless top-level heading the document really prints ("4 Point System for the Season"), recognised only when it reads
      // like a title, skips nothing, and the next numbered line is N.1.
      const nextNumbered = () => { for (let j = i + 1; j < lines.length; j++) { const tx = squash(lines[j].text); if (tx && !furnitureIds.has(lines[j].id)) return tx.replace(OCR_EDGE, ''); } return ''; };
      const bareHeading = nums.length === 1 && m[2] === '' && !f0.gap && isTitleLike(restText) && nextNumbered().startsWith(`${nums[0]}.1`);
      const f = { ...f0, ok: f0.ok && (nums.length > 1 || m[2] !== '' || bareHeading) && (!f0.gap || isTitleLike(restText)) };
      if (f.ok) {
        flush();
        accept(nums);
        const d = nums.length - 1 + (prefix ? 1 : 0);
        cur = { number: nums.join('.'), nums, prefix, kind: d === 0 ? 'section' : 'rule', title: null, lines: [], heads: [l], notes: [], depth: Math.min(d, 8) };
        if (f.gap) cur.notes.push(`numbering skips to ${nums.join('.')} (expected ${f.expected}): check the official document for a missing provision`);
        if (f.implied) cur.notes.push(`${nums.join('.')} has no printed parent heading`);
        const rest = restText;
        if (next) { cur.heads.push(next); i++; }
        if (rest) { if (isTitleLike(rest)) cur.title = rest; else cur.lines.push({ ...(next ?? l), text: rest }); }
        continue;
      }
      if (/^\s*\d{1,3}\.\d/.test(ht)) rejected.push({ id: l.id, text: squash(t).slice(0, 120), expected: f.expected });
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
  const pagesUsedFirst = (o: Open) => Math.min(...[...o.heads, ...o.lines].filter(l => squash(l.text)).map(l => l.page));
  const tableOf = new Map<string, TableSpec>();
  for (const tb of layout.tables ?? []) for (const id of tb.replaces) tableOf.set(id, tb);
  const usedTables = new Set<TableSpec>();
  opened.forEach((o, idx) => {
    const ordinal = idx + 1;
    const texts: string[] = [];
    let tableNotes: string[] = [];
    for (const l of o.lines) {
      const tb = tableOf.get(l.id);
      if (!tb) { texts.push(l.text); continue; }
      if (usedTables.has(tb)) continue;
      usedTables.add(tb);
      const src = o.lines.filter(x => tb.replaces.includes(x.id));
      if (src.length !== tb.replaces.length) throw new Error(`table at ${tb.replaces[0]}: its lines are not all in one provision`);
      checkTableWords(tb, src.map(x => x.text));
      texts.push('', ...renderTable(tb), '');
      tableNotes = [...tableNotes, tb.note];
    }
    const body = joinBody(texts);
    const ids = [...new Set([...o.heads.map(h => h.id), ...o.lines.map(l => l.id)])];
    const pagesUsed = [...o.heads.map(h => h.page), ...o.lines.filter(l => squash(l.text)).map(l => l.page)];
    const notes = [...o.notes];
    let kind = o.kind;
    const topics: string[] = [];
    if (o.kind === 'unstructured') {
      // Text before the first heading (a cover page, an introduction) is not uncertain in itself. It is only suspicious when it holds lines that
      // look like numbered headings the sequence did not accept (then real rules may be hiding in it).
      if (o.lines.some(l => NUMBERED_ANY.test(l.text))) notes.push('text before the first numbered heading contains numbered lines: check whether headings were missed');
      kind = 'note';
      topics.push(pagesUsedFirst(o) === 1 && o.lines.every(l => l.page === 1) ? 'cover' : 'introduction');
    }
    if (o.lines.some(l => !tableOf.has(l.id) && TABLE_LINE.test(l.text))) notes.push('layout looks like a table or columns: compare with the official page');
    if (tableNotes.length && !o.number && body.split('\n').every(x => !x.trim() || x.startsWith('|'))) kind = 'table';
    const low = [...new Set(o.lines.flatMap(l => uncertain.get(l.id) ?? []))];
    if (low.length) notes.push(`OCR could not read some words with confidence: ${low.slice(0, 8).join(', ')}`);
    const scoped = o.prefix && o.number ? `${o.prefix} ${o.number}` : o.number;
    // An unnumbered printed heading keys its provision by its words; other unnumbered text by its position.
    const slug = !scoped && o.heads.length && o.title ? o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) : null;
    let key = scoped ? `${seriesKey}:${keyPart(scoped)}` : slug ? `${seriesKey}:${slug}` : `${seriesKey}:p${String(ordinal).padStart(4, '0')}`;
    const dup = seenKeys.get(key) ?? 0;
    seenKeys.set(key, dup + 1);
    if (dup) { notes.push(`number ${scoped} is printed more than once in this document`); key = `${key}.dup${dup + 1}`; }
    let parent: string | null = null;
    if (o.nums.length > 1) {
      const pn = o.nums.slice(0, -1).join('.');
      parent = keyOfNumber.get(o.prefix ? `${o.prefix} ${pn}` : pn) ?? null;
    } else if (o.nums.length === 1 && o.prefix) parent = keyOfNumber.get(o.prefix) ?? null;
    if (scoped && !dup) keyOfNumber.set(scoped, key);
    const usedPages = [...new Set(pagesUsed)];
    const methods = new Set(usedPages.map(pg => pageMeta.get(pg)?.method ?? 'text'));
    provisions.push({
      ordinal, depth: o.depth, kind, number: o.number, title: o.title, body,
      page_from: pagesUsed.length ? Math.min(...pagesUsed) : null, page_to: pagesUsed.length ? Math.max(...pagesUsed) : null,
      stable_key: key, parent_key: parent,
      review_status: notes.length ? 'needs_review' : 'extracted', review_note: notes.length ? notes.join('; ').slice(0, 1000) : null,
      topics, keywords: [], cross_refs: crossRefs(body, o.number), content_sha256: contentSha256(o.number, o.title, body),
      has_figures: usedPages.some(pg => pageMeta.get(pg)?.figures === true), extraction: methods.size > 1 ? 'mixed' : methods.has('ocr') ? 'ocr' : 'text', lines: ids
    });
  });
  // The changelog (the document's own history of edits) stays readable but is not a rule: kind note, topic changelog, left out of rule search.
  const changelog = new Set<string>();
  for (const pr of provisions) {
    if ((pr.title && /change\s?log/i.test(pr.title)) || (pr.parent_key && changelog.has(pr.parent_key))) { changelog.add(pr.stable_key); pr.kind = 'note'; if (!pr.topics.includes('changelog')) pr.topics.push('changelog'); }
  }
  // A page with no readable text even after OCR holds only pictures. It gets its own provision so it is never silently missing. The body stays
  // EMPTY: BuhurtOS never writes words into official text; the rule page explains a picture-only page and links to it.
  // Picture pages are flagged for a person until someone confirms there is nothing to transcribe.
  // A cover (page 1) that is only artwork needs no review: it holds no rule.
  for (const p of emptyPages) {
    const cover = p === 1;
    const fig: Provision = { ordinal: 0, depth: 0, kind: 'figure', number: null, title: null, body: '', page_from: p, page_to: p,
      stable_key: `${seriesKey}:page-${p}`, parent_key: null, review_status: cover ? 'extracted' : 'needs_review',
      review_note: cover ? 'cover page: artwork only, no text' : 'page without readable text: pictures only?', topics: [cover ? 'cover' : 'pictures'], keywords: [], cross_refs: [],
      content_sha256: contentSha256(null, null, ''), has_figures: true, extraction: pageMeta.get(p)?.method === 'ocr' ? 'ocr' : 'text', lines: [] };
    // In reading order: before the first provision that starts on a later page.
    const at = provisions.findIndex(x => (x.page_from ?? 0) > p);
    provisions.splice(at < 0 ? provisions.length : at, 0, fig);
  }
  provisions.forEach((x, i) => { x.ordinal = i + 1; });
  for (const tb of layout.tables ?? []) if (!usedTables.has(tb)) throw new Error(`table at ${tb.replaces[0]}: no provision holds its lines`);
  // A provision built from corrected OCR lines says so.
  const fixed = new Set(ocrCorrections.map(c => c.id));
  for (const pr of provisions) if (pr.lines.some(id => fixed.has(id))) pr.review_note = [pr.review_note, 'includes OCR corrections checked against the page image'].filter(Boolean).join('; ');
  return { provisions, furniture, lines, rejected_numbers: rejected, empty_pages: emptyPages, detected, ocr_corrections: ocrCorrections };
}
