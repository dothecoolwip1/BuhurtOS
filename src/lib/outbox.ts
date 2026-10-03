/**
 * The scoring outbox. Marshals keep scoring through a short loss of signal: every action is saved on the device first (IndexedDB),
 * given an id the server can de-duplicate on, and sent later.
 *
 * Rules (owner decisions, 2026-10-03):
 *  - Every entry is bound to the user and the event that created it. It is only ever sent while that same user is signed in.
 *  - Order is kept per subject (a match). A problem with one match never blocks another match.
 *  - An entry the server refuses is KEPT, marked rejected, with the reason, until a person discards it or retries it.
 *  - Nothing here finalizes a match. Finalization is a separate online command; see submitMatchResult.
 * Storage and sending are injected, so this file is pure and testable.
 */
import { sharedDb, tx } from './idb';

/** Version of the command envelope the server understands (see public.submit_match_result). Bump with a compatibility window. */
export const COMMAND_SCHEMA = 1;

/** Owner marker for entries imported from the pre Pack 03 outbox, which recorded no account. They are never sent. */
export const LEGACY_USER = 'legacy';

export type EntryStatus = 'pending' | 'rejected';
export interface OutboxEntry<P = unknown> {
  /** Idempotency key. The server ignores a second delivery of the same id. */
  id: string;
  kind: string;
  /** What the action is about, a match id. Entries for one subject stay in order. */
  subject: string;
  eventId: string;
  userId: string;
  /** Local order within this device. */
  seq: number;
  schema: number;
  payload: P;
  createdAt: number;
  attempts: number;
  status: EntryStatus;
  error?: string;
  rejectedAt?: number;
}

/** ok: delivered. offline: no signal, stop everything. retry: this entry could not be delivered right now (server trouble), try again later without blocking other matches. reject: refused on purpose. */
export type SendResult = 'ok' | 'retry' | 'offline' | 'reject';
export type SendOutcome = SendResult | { result: SendResult; error?: string };
export type Sender<P = unknown> = (entry: OutboxEntry<P>) => Promise<SendOutcome>;

export interface OutboxStorage {
  load(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
  /** False when the work only lives in memory (no IndexedDB). */
  readonly durable: boolean;
}

export interface FlushReport { sent: number; rejected: OutboxEntry[]; remaining: number; stoppedOffline: boolean; blocked: string[]; heldForOthers: number }

/** An entry that has been tried this many times and still not gone through is shown as stuck. */
export const STUCK_ATTEMPTS = 20;

const outcome = (o: SendOutcome): { result: SendResult; error?: string } => (typeof o === 'string' ? { result: o } : o);

export class Outbox {
  private entries: OutboxEntry[] = [];
  private ready: Promise<void>;
  private flushing = false;
  private seq = 0;
  private listeners = new Set<() => void>();

  constructor(private storage: OutboxStorage, private now: () => number = Date.now, private newId: () => string = () => crypto.randomUUID()) {
    this.ready = storage.load().then(e => {
      this.entries = e.sort((a, b) => a.seq - b.seq);
      this.seq = this.entries.reduce((m, x) => Math.max(m, x.seq), 0);
      this.emit();
    });
  }

  get durable() { return this.storage.durable; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const l of this.listeners) l(); }
  whenReady() { return this.ready; }

  async all(): Promise<OutboxEntry[]> { await this.ready; return [...this.entries]; }
  /** Pending (not yet accepted) entries of one user. */
  async pending(userId: string): Promise<OutboxEntry[]> { await this.ready; return this.entries.filter(e => e.userId === userId && e.status === 'pending'); }
  /** Entries the server refused, kept for review. */
  async rejected(userId: string): Promise<OutboxEntry[]> { await this.ready; return this.entries.filter(e => e.status === 'rejected' && (e.userId === userId || e.userId === LEGACY_USER)); }

  /** Refused entries of one account (plus unowned legacy ones), synchronously, for the UI (valid after `whenReady`). */
  rejectedList(userId: string): OutboxEntry[] { return this.entries.filter(e => e.status === 'rejected' && (e.userId === userId || e.userId === LEGACY_USER)); }
  /** Cheap synchronous counts for the UI (valid after `whenReady`). */
  waiting(userId: string) { return this.entries.filter(e => e.userId === userId && e.status === 'pending').length; }
  stuck(userId: string) { return this.entries.filter(e => e.userId === userId && e.status === 'pending' && e.attempts >= STUCK_ATTEMPTS).length; }
  rejectedCount(userId: string) { return this.entries.filter(e => e.status === 'rejected' && (e.userId === userId || e.userId === LEGACY_USER)).length; }
  /** Entries on this device that belong to a different account: never sent while you are signed in as someone else. */
  heldForOthers(userId: string) { return this.entries.filter(e => e.userId !== userId && e.status === 'pending').length; }

  async enqueue<P>(ctx: { userId: string; eventId: string }, kind: string, subject: string, payload: P): Promise<OutboxEntry<P>> {
    await this.ready;
    if (!ctx.userId) throw new Error('sign in before scoring: work is saved against your account');
    const entry: OutboxEntry<P> = {
      id: this.newId(), kind, subject, eventId: ctx.eventId, userId: ctx.userId, seq: ++this.seq, schema: COMMAND_SCHEMA,
      payload, createdAt: this.now(), attempts: 0, status: 'pending'
    };
    this.entries.push(entry as OutboxEntry);
    await this.storage.put(entry as OutboxEntry);   // saved on the device before anything is sent
    this.emit();
    return entry;
  }

  /**
   * Send this user's pending entries. Order is kept inside each match. 'offline' stops the run. 'retry' leaves that entry (and the rest of
   * that match) for the next run but carries on with other matches. 'reject' keeps the entry, marked rejected with the reason, and carries on.
   */
  async flush(send: Sender, userId: string): Promise<FlushReport> {
    await this.ready;
    const heldForOthers = this.heldForOthers(userId);
    if (this.flushing) return { sent: 0, rejected: [], remaining: this.waiting(userId), stoppedOffline: false, blocked: [], heldForOthers };
    this.flushing = true;
    let sent = 0;
    const rejected: OutboxEntry[] = [];
    const blocked = new Set<string>();
    let stoppedOffline = false;
    try {
      const mine = this.entries.filter(e => e.userId === userId && e.status === 'pending').sort((a, b) => a.seq - b.seq);
      const subjects = [...new Set(mine.map(e => e.subject))];
      outer: for (const subject of subjects) {
        for (const entry of mine.filter(e => e.subject === subject)) {
          let o: { result: SendResult; error?: string };
          try { o = outcome(await send(entry)); } catch { o = { result: 'offline' }; }
          if (o.result === 'ok') {
            this.entries = this.entries.filter(x => x.id !== entry.id);
            await this.storage.remove(entry.id);
            sent += 1;
          } else if (o.result === 'reject') {
            entry.status = 'rejected'; entry.error = o.error ?? 'refused by the server'; entry.rejectedAt = this.now(); entry.attempts += 1;
            await this.storage.put(entry);
            rejected.push(entry);
          } else {
            entry.attempts += 1;
            if (o.error) entry.error = o.error;
            await this.storage.put(entry);
            if (o.result === 'offline') { stoppedOffline = true; break outer; }
            blocked.add(subject);   // keep this match in order; other matches carry on
            break;
          }
          this.emit();
        }
      }
    } finally { this.flushing = false; this.emit(); }
    return { sent, rejected, remaining: this.waiting(userId), stoppedOffline, blocked: [...blocked], heldForOthers };
  }

  /** Put a refused entry back in the queue (for example after the cause was fixed). */
  async retry(id: string, userId: string): Promise<boolean> {
    await this.ready;
    const e = this.entries.find(x => x.id === id && x.userId === userId && x.status === 'rejected');
    if (!e) return false;
    e.status = 'pending'; e.attempts = 0; e.error = undefined; e.rejectedAt = undefined;
    await this.storage.put(e);
    this.emit();
    return true;
  }

  /** Explicitly throw a refused entry away. Only rejected entries of your own account; pending work cannot be discarded here. */
  async discard(id: string, userId: string): Promise<boolean> {
    await this.ready;
    const e = this.entries.find(x => x.id === id && (x.userId === userId || x.userId === LEGACY_USER) && x.status === 'rejected');
    if (!e) return false;
    this.entries = this.entries.filter(x => x.id !== id);
    await this.storage.remove(id);
    this.emit();
    return true;
  }

  /** Re-read storage (another tab may have written). */
  async reload(): Promise<void> {
    this.entries = (await this.storage.load()).sort((a, b) => a.seq - b.seq);
    this.seq = Math.max(this.seq, this.entries.reduce((m, x) => Math.max(m, x.seq), 0));
    this.emit();
  }
}

export class MemoryStorage implements OutboxStorage {
  readonly durable = false;
  constructor(public data: OutboxEntry[] = []) {}
  async load() { return structuredClone(this.data); }
  async put(entry: OutboxEntry) { this.data = [...this.data.filter(e => e.id !== entry.id), structuredClone(entry)]; }
  async remove(id: string) { this.data = this.data.filter(e => e.id !== id); }
}

/** The real storage: IndexedDB. If it cannot be opened the queue still works in memory for this session, and `durable` says so. */
export class IdbOutboxStorage implements OutboxStorage {
  private mem = new MemoryStorage();
  private db: Promise<IDBDatabase | null>;
  private ok = true;
  constructor(db: Promise<IDBDatabase | null> = sharedDb()) { this.db = db; }
  get durable() { return this.ok; }
  async load(): Promise<OutboxEntry[]> {
    const db = await this.db;
    if (!db) { this.ok = false; return this.mem.load(); }
    try { return (await tx(db, 'outbox', 'readonly', s => s.getAll())) as OutboxEntry[]; } catch { this.ok = false; return this.mem.load(); }
  }
  async put(entry: OutboxEntry) {
    const db = await this.db;
    if (!db) { this.ok = false; return this.mem.put(entry); }
    try { await tx(db, 'outbox', 'readwrite', s => s.put(entry)); } catch { this.ok = false; await this.mem.put(entry); }
  }
  async remove(id: string) {
    const db = await this.db;
    if (!db) { return this.mem.remove(id); }
    try { await tx(db, 'outbox', 'readwrite', s => s.delete(id)); } catch { await this.mem.remove(id); }
  }
}

/**
 * Entries written by the old (pre Pack 03) outbox lived in localStorage under `bos-outbox-v1` with no owner. They cannot safely be
 * sent as anyone, so they are moved into the new store as REFUSED entries with an explanation. Nothing is lost and nothing is replayed.
 */
export async function importLegacyOutbox(storage: OutboxStorage, now: () => number = Date.now, ls: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Promise<number> {
  if (!ls) return 0;
  let raw: string | null = null;
  try { raw = ls.getItem('bos-outbox-v1'); } catch { return 0; }
  if (!raw) return 0;
  let old: { id?: string; kind?: string; subject?: string; payload?: unknown; createdAt?: number; attempts?: number }[] = [];
  try { old = JSON.parse(raw) as typeof old; } catch { return 0; }
  let n = 0;
  for (const e of old) {
    if (!e || typeof e.id !== 'string' || typeof e.subject !== 'string') continue;
    await storage.put({
      id: e.id, kind: String(e.kind ?? 'unknown'), subject: e.subject, eventId: '', userId: LEGACY_USER, seq: 0, schema: 0, payload: e.payload ?? {},
      createdAt: e.createdAt ?? now(), attempts: e.attempts ?? 0, status: 'rejected', rejectedAt: now(),
      error: 'saved by an older version of BuhurtOS with no account recorded, so it is not sent automatically'
    });
    n += 1;
  }
  try { ls.removeItem('bos-outbox-v1'); } catch { /* ignore */ }
  return n;
}
