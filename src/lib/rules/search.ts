/**
 * Pack 22: deterministic rules search. No AI, no network: the same words always give the same results, on a phone at the side of the list.
 *
 * What is searched, best first: the rule number ("4.2", "§ 4.2", "rule 4.2"), the title, BuhurtOS search words, the section the rule sits in, the text.
 * Every word typed must be found somewhere (directly, by a simple word-ending match, or through a BuhurtOS synonym). When nothing has every word,
 * the closest matches are offered and clearly called that.
 * Synonyms are BuhurtOS search aids (SEARCH_SYNONYMS below): they only widen what is found, they never change or add rule text.
 */

export interface SearchableRule {
  id: string;
  number: string | null;
  title: string | null;
  body: string;
  keywords?: string[];
  /** Titles of the sections above this rule, outermost first. */
  path?: string[];
  /** Document name, e.g. "Buhurt Rules". */
  document?: string;
}

export interface SearchHit<T extends SearchableRule> { item: T; score: number; exact: boolean; snippet: string; matched: string[] }
export interface SearchResult<T extends SearchableRule> { hits: SearchHit<T>[]; partial: boolean; numberQuery: string | null }

/**
 * BuhurtOS search aids: words people type at an event that the official wording may not use. Each group is searched as one idea.
 * Multi-word entries are phrases. NOT official text; extending this list never changes a rule.
 */
export const SEARCH_SYNONYMS: string[][] = [
  ['armour', 'armor'],
  ['helmet', 'helm', 'helmets', 'head protection'],
  ['grounded', 'ground', 'downed', 'down', 'floor', 'fall', 'fallen'],
  ['fighter', 'fighters', 'competitor', 'competitors', 'athlete', 'athletes'],
  ['striking', 'strike', 'strikes', 'hit', 'hitting', 'hits', 'blow', 'blows'],
  ['accreditation', 'accredited', 'certification', 'certified', 'licence', 'license'],
  ['infraction', 'infractions', 'violation', 'violations'],
  ['two handed', 'two-handed', '2h', 'two hand', 'both hands', 'two hands'],
  ['one handed', 'one-handed', '1h', 'one hand'],
  ['grapple', 'grappling', 'wrestle', 'wrestling', 'throw', 'throws', 'takedown'],
  ['thrust', 'thrusting', 'stab', 'stabbing', 'poke'],
  ['shield', 'shields', 'buckler', 'bucklers'],
  ['card', 'cards'],
  ['disqualify', 'disqualified', 'disqualification', 'dq'],
  ['penalty', 'penalties', 'sanction', 'sanctions', 'punishment', 'deduction'],
  ['warning', 'warnings', 'warn', 'caution'],
  ['back of knee', 'back of the knee', 'behind the knee', 'popliteal'],
  ['neck', 'throat'],
  ['groin', 'crotch'],
  ['marshal', 'marshals', 'referee', 'ref', 'judge', 'official'],
  ['list', 'lists', 'arena', 'ring', 'field'],
  ['protest', 'protests', 'appeal', 'appeals', 'complaint', 'challenge'],
  ['weapon', 'weapons', 'sword', 'axe', 'polearm', 'falchion'],
  ['gauntlet', 'gauntlets', 'glove', 'gloves', 'hand protection'],
  ['passivity', 'passive', 'stalling', 'stall', 'inactive'],
  ['forfeit', 'walkover', 'no show', 'no-show', 'technical win']
];

/** Lower case, accents removed, hyphens / slashes / underscores as spaces, other punctuation dropped (dots inside numbers kept). */
export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[‐-―_/\\-]+/g, ' ')
    .replace(/(\d)\.(?=\d)/g, '$1\u0000')
    .replace(/[^\p{L}\p{N}\u0000§\s]+/gu, ' ')
    .replace(/\u0000/g, '.')
    .replace(/\s+/g, ' ').trim();
}

/** A deliberately small stemmer: plural and common English endings, so "cards" finds "card" and "grappling" finds "grapple". */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3).replace(/(.)\1$/, '$1');
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2).replace(/(.)\1$/, '$1');
  if (w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  if (w.endsWith('e') && w.length > 4) return w.slice(0, -1);
  return w;
}
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'is', 'are', 'be', 'with', 'by', 'at', 'it', 'its', 'what', 'when', 'can', 'i', 'my', 'do', 'does', 'rule', 'rules']);

/** The rule number in a query like "4.2", "§4.2", "rule 4.2.1": null when the query is not a number. */
export function numberQuery(q: string): string | null {
  const m = q.trim().match(/^(?:§|rule|section|art(?:icle)?\.?|point)?\s*(\d{1,3}(?:\.\d{1,3}){0,5})\.?$/i);
  return m ? m[1] : null;
}

interface Prepared { phrase: string; stems: Set<string>; text: string }
const prep = (s: string): Prepared => { const n = normalize(s); return { phrase: ` ${n} `, stems: new Set(n.split(' ').filter(Boolean).map(stem)), text: n }; };
// Rules are reused while a person types. Reuse their normalized search fields, but refresh when any source text changes.
const preparedRules = new WeakMap<SearchableRule, { source: string[]; fields: Prepared[] }>();
function prepareRule(it: SearchableRule): Prepared[] {
  const source = [it.title ?? '', (it.keywords ?? []).join(' · '), [...(it.path ?? []), it.document ?? ''].join(' · '), it.body];
  const cached = preparedRules.get(it);
  if (cached && source.every((s, i) => cached.source[i] === s)) return cached.fields;
  const fields = source.map(prep);
  preparedRules.set(it, { source, fields });
  return fields;
}

/** The query as groups of alternatives: each group must be found. Synonym phrases are matched before single words. */
export function queryGroups(q: string): { label: string; alts: string[] }[] {
  let rest = ` ${normalize(q)} `;
  const groups: { label: string; alts: string[] }[] = [];
  const syn = SEARCH_SYNONYMS.map(g => g.map(normalize));
  // Longest synonym phrases first ("back of the knee" before "knee").
  const phrases = syn.flatMap((g, gi) => g.filter(x => x.includes(' ')).map(x => ({ x, gi }))).sort((a, b) => b.x.length - a.x.length);
  for (const { x, gi } of phrases) {
    if (rest.includes(` ${x} `)) { groups.push({ label: x, alts: syn[gi] }); rest = rest.replace(` ${x} `, ' '); }
  }
  for (const w of rest.split(' ').filter(Boolean)) {
    if (STOP.has(w)) continue;
    const gi = syn.findIndex(g => g.includes(w) || g.map(stem).includes(stem(w)));
    groups.push({ label: w, alts: gi >= 0 ? [...new Set([w, ...syn[gi]])] : [w] });
  }
  return groups;
}

const altFound = (alt: string, p: Prepared, word: string) => (alt.includes(' ') ? p.phrase.includes(` ${alt} `) : p.stems.has(word) || (alt.length >= 4 && p.text.includes(alt)));

/** About 160 characters of the text around the first match, on word boundaries. */
export function snippet(body: string, matched: string[], size = 160): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= size) return flat;
  const low = normalize(flat);
  let at = -1;
  for (const m of matched) { const i = low.indexOf(m.split(' ')[0].slice(0, Math.max(3, m.length - 2))); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return flat.slice(0, size).replace(/\s+\S*$/, '') + '…';
  // normalize() keeps lengths close enough to the original for a window; widen by a few characters to be safe.
  const start = Math.max(0, at - 50);
  const s = flat.slice(start, start + size).replace(/^\S*\s/, start > 0 ? '' : '$&').replace(/\s+\S*$/, '');
  return `${start > 0 ? '…' : ''}${s}${start + size < flat.length ? '…' : ''}`;
}

export function searchRules<T extends SearchableRule>(items: readonly T[], q: string, limit = 60): SearchResult<T> {
  const nq = numberQuery(q);
  const query = q.trim();
  if (!query) return { hits: [], partial: false, numberQuery: null };
  if (nq) {
    const hits = items
      .filter(it => it.number && (it.number === nq || it.number.startsWith(`${nq}.`)))
      .map(it => ({ item: it, score: it.number === nq ? 1000 : 500 - it.number!.split('.').length, exact: it.number === nq, snippet: snippet(it.body, []), matched: [] }))
      .sort((a, b) => b.score - a.score || cmpNumber(a.item.number!, b.item.number!));
    if (hits.length) return { hits: hits.slice(0, limit), partial: false, numberQuery: nq };
  }
  const groups = queryGroups(query);
  if (!groups.length) return { hits: [], partial: false, numberQuery: nq };
  const alternatives = groups.map(g => ({ label: g.label, alts: g.alts.map(alt => ({ alt, word: stem(alt) })) }));
  const phraseQ = normalize(query);
  const scored: SearchHit<T>[] = [];
  for (const it of items) {
    const [title, kw, path, body] = prepareRule(it);
    let score = 0; let found = 0; const matched: string[] = [];
    for (const g of alternatives) {
      let best = 0; let hit: string | null = null;
      for (const { alt, word } of g.alts) {
        const direct = alt === g.label ? 1 : 0.7;   // a synonym counts a little less than the word typed
        const s = (altFound(alt, title, word) ? 12 : 0) + (altFound(alt, kw, word) ? 9 : 0) + (altFound(alt, path, word) ? 4 : 0) + (altFound(alt, body, word) ? 3 : 0);
        if (s * direct > best) { best = s * direct; hit = alt; }
      }
      if (best > 0) { found++; score += best; if (hit) matched.push(hit); }
    }
    if (!found) continue;
    if (phraseQ.includes(' ')) {
      if (title.phrase.includes(` ${phraseQ} `)) score += 30;
      else if (body.phrase.includes(` ${phraseQ} `)) score += 15;
    }
    if (it.number && nq && it.number === nq) score += 50;
    scored.push({ item: it, score, exact: found === groups.length, snippet: '', matched });
  }
  const all = scored.filter(h => h.exact);
  const partial = all.length === 0;
  const need = Math.max(1, Math.ceil(groups.length / 2));
  const list = (partial ? scored.filter(h => h.matched.length >= need) : all)
    .sort((a, b) => b.score - a.score || cmpNumber(a.item.number ?? '', b.item.number ?? '') || (a.item.title ?? '').localeCompare(b.item.title ?? ''));
  return { hits: list.slice(0, limit).map(h => ({ ...h, snippet: snippet(h.item.body, h.matched) })), partial: partial && list.length > 0, numberQuery: nq };
}

/** "2.10" after "2.9"; null numbers last. */
export function cmpNumber(a: string, b: string): number {
  if (!a && !b) return 0; if (!a) return 1; if (!b) return -1;
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; }
  return 0;
}

/** Pieces of `text` with the matched words marked, for <mark>. Case and accents are ignored; the original characters are kept. */
export function highlightParts(text: string, matched: string[]): { text: string; mark: boolean }[] {
  const terms = [...new Set(matched.flatMap(m => m.split(' ')).filter(w => w.length >= 2 && !STOP.has(w)))].map(w => stem(w)).filter(w => w.length >= 2);
  if (!terms.length || !text) return [{ text, mark: false }];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(${terms.map(esc).join('|')})[\\p{L}]*`, 'giu');
  const out: { text: string; mark: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) { if (m.index! > last) out.push({ text: text.slice(last, m.index), mark: false }); out.push({ text: m[0], mark: true }); last = m.index! + m[0].length; }
  if (last < text.length) out.push({ text: text.slice(last), mark: false });
  return out;
}
