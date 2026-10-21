/**
 * Counter evidence saved on THIS browser, readable after the seat changed, the device was replaced or signed out, or its code was withdrawn.
 * Read-only and offline: nothing here calls the network, grants anything or changes storage. It never writes, clears or removes a key.
 *
 * Privacy boundary: storage KEYS are listed, but VALUES are read only for the counter journal (`bos-counter-journal:v1:`) and the older tap
 * queue (`bos-lyst-taps:`). Every other value (auth session, tokens, settings) is never read. Clock intents (`bos-timer-intent:v1:`) are counted
 * by key presence only: the store removes the key once an intent is settled. Probe keys (`...:probe`) are ignored.
 */

export interface KeyedStorage { readonly length: number; key(index: number): string | null; getItem(key: string): string | null }

export const JOURNAL_PREFIX = 'bos-counter-journal:v1:';
export const LEGACY_PREFIX = 'bos-lyst-taps:';
export const TIMER_INTENT_PREFIX = 'bos-timer-intent:v1:';
const isProbe = (k: string) => /(^|:)probe(:|$)/.test(k);
const LABEL_MAX = 120;
const LABEL_FIELDS = ['event', 'fight', 'competition', 'round_label', 'field', 'operator', 'side'] as const;

/** pending: never delivered. held: kept on this phone for a person; `delivered` says whether the server has it (as review evidence) or not. */
export type EvidenceStatus = 'pending' | 'held_undelivered' | 'held_delivered' | 'held_accepted' | 'held_archived' | 'unreadable';
export interface EvidenceItem {
  status: EvidenceStatus;
  id: string | null; kind: 'tap' | 'undo' | null; weight: number | null; round: number | null;
  matchId: string | null; runId: string | null; recordedAt: string | null; recovery: boolean;
  reason: string | null;
  /** The exact stored entry, for an entry that could not be read. */
  raw: string | null;
}
export interface AcceptedTotal { matchId: string | null; round: number; total: number }
export type ContextLabel = Partial<Record<(typeof LABEL_FIELDS)[number], string>>;
export interface SavedRecord {
  key: string; source: 'journal' | 'legacy'; seatId: string;
  /** The exact stored text, always kept for copying, readable or not. */
  raw: string;
  readable: boolean; problem: string | null;
  items: EvidenceItem[];
  /** The counter's own tally the server acknowledged for this seat. Never an official score. */
  accepted: AcceptedTotal[];
  contexts: Record<string, ContextLabel>;
  /** An older queue whose seat also has a journal: the journal copied it on upgrade and this key was kept as a recovery copy. */
  superseded: boolean;
  legacyIds?: string[];
}

/** Every key, in storage order, without reading any value. A storage that cannot be listed gives what was listed before it failed. */
export function listKeys(storage: KeyedStorage): string[] {
  return scanKeys(storage).keys;
}
function scanKeys(storage:KeyedStorage):{keys:string[];failed:boolean}{
  const out: string[] = [];
  try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k !== null) out.push(k); } }
  catch {return{keys:out,failed:true};}
  return{keys:out,failed:false};
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const actionOk = (a: unknown): a is Record<string, unknown> => {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  const round = int(x.round);
  return typeof x.id === 'string' && x.id.length > 0 && round !== null && round >= 1 && round <= 20
    && (x.kind === 'undo' || (x.kind === 'tap' && (x.weight === 1 || x.weight === 2)));
};
function item(a: unknown, status: Exclude<EvidenceStatus, 'unreadable'>, reason: string | null): EvidenceItem {
  if (!actionOk(a)) return { status: 'unreadable', id: null, kind: null, weight: null, round: null, matchId: null, runId: null, recordedAt: null, recovery: false, reason, raw: safeStringify(a) };
  return {
    status, id: a.id as string, kind: a.kind as 'tap' | 'undo', weight: a.kind === 'tap' ? (a.weight as number) : null, round: a.round as number,
    matchId: str(a.matchId), runId: str(a.runId), recordedAt: str(a.recordedAt), recovery: a.recovery === true, reason, raw: null
  };
}
function safeStringify(v: unknown): string { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } }
function labels(v: unknown): Record<string, ContextLabel> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, ContextLabel> = {};
  for (const [match, c] of Object.entries(v as Record<string, unknown>)) {
    if (!c || typeof c !== 'object') continue;
    const l: ContextLabel = {};
    for (const f of LABEL_FIELDS) { const s = str((c as Record<string, unknown>)[f]); if (s && s.trim()) l[f] = s.trim().slice(0, LABEL_MAX); }
    if (Object.keys(l).length) out[match.slice(0, LABEL_MAX)] = l;
  }
  return out;
}

function parseJournal(key: string, raw: string): SavedRecord {
  const base: SavedRecord = { key, source: 'journal', seatId: key.slice(JOURNAL_PREFIX.length), raw, readable: false, problem: null, items: [], accepted: [], contexts: {}, superseded: false };
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { ...base, problem: 'This saved record could not be read. Its exact text is kept below.' }; }
  const l = v as Record<string, unknown> | null;
  if (!l || typeof l !== 'object' || l.version !== 1 || !Array.isArray(l.pending) || !Array.isArray(l.held)) {
    return { ...base, problem: 'This saved record has an unknown format. Its exact text is kept below.' };
  }
  const items: EvidenceItem[] = [
    ...l.pending.map(a => item(a, 'pending', null)),
    ...l.held.map(h => {
      const hh = h as Record<string, unknown> | null;
      if (!hh || typeof hh !== 'object') return item(h, 'held_undelivered', null);
      return item(hh.action, hh.delivered === true ? hh.alreadyAccepted===true?'held_accepted':'held_delivered' : typeof hh.archivedAt==='string'?'held_archived':'held_undelivered', str(hh.reason));
    })
  ];
  const accepted: AcceptedTotal[] = [];
  let odd = false;
  if (l.totals && typeof l.totals === 'object') {
    for (const [k, n] of Object.entries(l.totals as Record<string, unknown>)) {
      const m = /^(?:(.+):)?([1-9]|1[0-9]|20)$/.exec(k);
      if (!m || int(n) === null || (n as number) < 0) { odd = true; continue; }
      accepted.push({ matchId: m[1] ?? null, round: Number(m[2]), total: n as number });
    }
  } else odd = true;
  const bad = items.some(i => i.status === 'unreadable');
  return { ...base, readable: true, items, accepted, contexts: labels(l.contexts),legacyIds:Array.isArray(l.legacyIds)?l.legacyIds.filter((id):id is string=>typeof id==='string'):[],
    problem: bad ? 'Some entries could not be read. Their exact text is kept.' : odd ? 'Some saved totals could not be read. The exact text is kept below.' : null };
}
function parseLegacy(key: string, raw: string): SavedRecord {
  const base: SavedRecord = { key, source: 'legacy', seatId: key.slice(LEGACY_PREFIX.length), raw, readable: false, problem: null, items: [], accepted: [], contexts: {}, superseded: false };
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { ...base, problem: 'This older saved queue could not be read. Its exact text is kept below.' }; }
  if (!Array.isArray(v)) return { ...base, problem: 'This older saved queue has an unknown format. Its exact text is kept below.' };
  const items = v.map(a => item(a, 'pending', null));
  return { ...base, readable: true, items, problem: items.some(i => i.status === 'unreadable') ? 'Some entries could not be read. Their exact text is kept.' : null };
}

/** Every saved counter record on this browser. Reads values only under the two counter prefixes. */
export function readSavedEvidence(storage: KeyedStorage): SavedRecord[] {
  return readRecords(storage,listKeys(storage));
}
function readRecords(storage:KeyedStorage,listed:string[]):SavedRecord[]{
  const keys = listed.filter(k => !isProbe(k));
  const journals = keys.filter(k => k.startsWith(JOURNAL_PREFIX) && k.length > JOURNAL_PREFIX.length);
  const legacy = keys.filter(k => k.startsWith(LEGACY_PREFIX) && k.length > LEGACY_PREFIX.length);
  const out: SavedRecord[] = [];
  for (const k of journals) {
    let raw: string | null = null;
    try { raw = storage.getItem(k); } catch { out.push({ key: k, source: 'journal', seatId: k.slice(JOURNAL_PREFIX.length), raw: '', readable: false, problem: 'This browser refused to read this saved record.', items: [], accepted: [], contexts: {}, superseded: false }); continue; }
    if (raw !== null) out.push(parseJournal(k, raw));
  }
  for (const k of legacy) {
    let raw: string | null = null;
    try { raw = storage.getItem(k); } catch { out.push({ key: k, source: 'legacy', seatId: k.slice(LEGACY_PREFIX.length), raw: '', readable: false, problem: 'This browser refused to read this older saved queue.', items: [], accepted: [], contexts: {}, superseded: false }); continue; }
    if (raw !== null) {
      const record=parseLegacy(k,raw),journal=out.find(r=>r.source==='journal'&&r.seatId===record.seatId&&r.readable);
      const copied=!!journal && record.readable && record.items.every(i=>i.id!==null && journal.legacyIds?.includes(i.id));
      out.push({...record,superseded:copied});
    }
  }
  return out;
}

export interface LocalScoringWork {
  journalPending: number;
  /** Held on this phone and NOT yet on the server. Delivered review evidence is on the server and is not counted. */
  heldUndelivered: number;
  /** Older queues with no journal for their seat (a journal for the seat already copied its queue). */
  legacyPending: number;
  timerIntents: number;
  /** Records or entries that could not be read: unknown is never treated as "nothing waiting". */
  unreadable: number;
  total: number;
  /** True only when nothing is waiting and nothing is unknown. */
  safe: boolean;
}
/** Pure: what saved scoring work would be put at risk by an update or reset of this browser. */
export function countPendingLocalScoring(storage: KeyedStorage): LocalScoringWork {
  const listing=scanKeys(storage),records = readRecords(storage,listing.keys);
  let journalPending = 0, heldUndelivered = 0, legacyPending = 0, unreadable = listing.failed?1:0;
  for (const r of records) {
    if (!r.readable) { if (!(r.source === 'legacy' && r.superseded)) unreadable++; continue; }
    if (r.source === 'legacy') { if (!r.superseded) for (const i of r.items) { if (i.status === 'unreadable') unreadable++; else legacyPending++; } continue; }
    if(r.problem && !r.items.some(i=>i.status==='unreadable'))unreadable++;
    for (const i of r.items) {
      if (i.status === 'pending') journalPending++;
      else if (i.status === 'held_undelivered') heldUndelivered++;
      else if (i.status === 'unreadable') unreadable++;
    }
  }
  const timerIntents = listing.keys.filter(k => k.startsWith(TIMER_INTENT_PREFIX) && !isProbe(k)).length;
  const total = journalPending + heldUndelivered + legacyPending + timerIntents + unreadable;
  return { journalPending, heldUndelivered, legacyPending, timerIntents, unreadable, total, safe: total === 0 };
}

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  pending: 'Not sent yet (only on this phone)',
  held_undelivered: 'Kept for marshal review, not on the server',
  held_delivered: 'On the server for marshal review',
  held_accepted: 'Already accepted by the server (not replayed)',
  held_archived: 'Shown to marshal and archived on this phone (not delivered)',
  unreadable: 'Could not be read (exact text kept)'
};
