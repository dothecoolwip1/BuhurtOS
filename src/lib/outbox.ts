/**
 * Offline-first event outbox. Marshals keep scoring when the signal drops: every action is saved on the device first,
 * given an id the server can de-duplicate on, and sent later in the order it happened.
 * Storage and sending are injected, so this file is pure and testable.
 */
export interface OutboxEntry<P = unknown> {
  /** Idempotency key. The server must ignore a second delivery of the same id. */
  id: string;
  kind: string;
  /** What the action is about, usually a match id. Entries for one subject stay in order. */
  subject: string;
  payload: P;
  createdAt: number;
  attempts: number;
}

export type SendResult = 'ok' | 'retry' | 'reject';
export type Sender<P = unknown> = (entry: OutboxEntry<P>) => Promise<SendResult>;

export interface OutboxStorage {
  load(): Promise<OutboxEntry[]>;
  save(entries: OutboxEntry[]): Promise<void>;
}

export interface FlushReport { sent: number; rejected: OutboxEntry[]; remaining: number; stoppedOffline: boolean }

export class Outbox {
  private entries: OutboxEntry[] = [];
  private ready: Promise<void>;
  private flushing = false;
  private listeners = new Set<() => void>();

  constructor(private storage: OutboxStorage, private now: () => number = Date.now, private newId: () => string = () => crypto.randomUUID()) {
    this.ready = storage.load().then(e => { this.entries = e; this.emit(); });
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const l of this.listeners) l(); }

  async pending(): Promise<OutboxEntry[]> { await this.ready; return [...this.entries]; }
  get size() { return this.entries.length; }

  async enqueue<P>(kind: string, subject: string, payload: P): Promise<OutboxEntry<P>> {
    await this.ready;
    const entry: OutboxEntry<P> = { id: this.newId(), kind, subject, payload, createdAt: this.now(), attempts: 0 };
    this.entries.push(entry as OutboxEntry);
    await this.storage.save(this.entries);
    this.emit();
    return entry;
  }

  /**
   * Send in order. A 'retry' (no signal, server busy) stops the run so order is kept and nothing is lost.
   * A 'reject' (the server refused it for good, for example the match was already finalised) removes the entry and
   * reports it, so a person can see what did not go through. Never silently dropped.
   */
  async flush(send: Sender): Promise<FlushReport> {
    await this.ready;
    if (this.flushing) return { sent: 0, rejected: [], remaining: this.entries.length, stoppedOffline: false };
    this.flushing = true;
    let sent = 0;
    const rejected: OutboxEntry[] = [];
    let stoppedOffline = false;
    try {
      while (this.entries.length) {
        const head = this.entries[0];
        let result: SendResult;
        try { result = await send(head); } catch { result = 'retry'; }
        head.attempts += 1;
        if (result === 'retry') { stoppedOffline = true; await this.storage.save(this.entries); break; }
        this.entries.shift();
        if (result === 'ok') sent += 1; else rejected.push(head);
        await this.storage.save(this.entries);
        this.emit();
      }
    } finally { this.flushing = false; this.emit(); }
    return { sent, rejected, remaining: this.entries.length, stoppedOffline };
  }
}

export class MemoryStorage implements OutboxStorage {
  constructor(public data: OutboxEntry[] = []) {}
  async load() { return structuredClone(this.data); }
  async save(entries: OutboxEntry[]) { this.data = structuredClone(entries); }
}

/** IndexedDB would be sturdier for large queues; localStorage is enough for a few hundred small score events. */
export class LocalStorageOutbox implements OutboxStorage {
  constructor(private key = 'bos-outbox-v1') {}
  async load(): Promise<OutboxEntry[]> {
    try { const raw = localStorage.getItem(this.key); return raw ? (JSON.parse(raw) as OutboxEntry[]) : []; } catch { return []; }
  }
  async save(entries: OutboxEntry[]) {
    try { localStorage.setItem(this.key, JSON.stringify(entries)); } catch { /* quota or blocked: the in-memory queue still works this session */ }
  }
}
