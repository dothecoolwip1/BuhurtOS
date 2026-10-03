import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthContext';
import { IdbOutboxStorage, MemoryStorage, Outbox, importLegacyOutbox, type FlushReport, type OutboxEntry, type Sender } from './outbox';
import { drainSubject, type DrainResult } from './outboxWait';
import { realSender } from './scoreSender';

/**
 * Two queues. The real one is saved on the device (IndexedDB) and sent to the database, only while the account that created each entry
 * is signed in. The preview one (the /marshal sample screen) lives in memory and only pretends to send, so invented fights can never
 * reach the database.
 */
interface Channel { box: Outbox; send: Sender; version: number; subs: Set<() => void> }
const makeChannel = (box: Outbox, send: Sender): Channel => {
  const c: Channel = { box, send, version: 0, subs: new Set() };
  box.subscribe(() => { c.version++; c.subs.forEach(f => f()); });
  return c;
};

const storage = new IdbOutboxStorage();
/** One outbox for the whole app, so every scoring screen shares the same queue. */
export const outbox = new Outbox(storage);
void outbox.whenReady().then(() => importLegacyOutbox(storage)).then(n => { if (n > 0) void outbox.reload(); });

/** Preview only: the switch lets a tester pretend the signal dropped. */
const KEY = 'bos-sim-offline';
const readFlag = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
export const link = {
  simulatedOffline: readFlag(),
  set(v: boolean) { this.simulatedOffline = v; try { sessionStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } }
};
const simulatedSender: Sender = async () => {
  await new Promise(r => setTimeout(r, 250));
  return link.simulatedOffline || !navigator.onLine ? 'offline' : 'ok';
};

const real = makeChannel(outbox, realSender);
const preview = makeChannel(new Outbox(new MemoryStorage()), simulatedSender);
const PREVIEW_CTX = { userId: 'preview', eventId: 'preview' };

export function useOutbox(opts: { preview?: boolean; eventId?: string } = {}) {
  const ch = opts.preview ? preview : real;
  const { session } = useAuth();
  const userId = opts.preview ? PREVIEW_CTX.userId : session?.user.id ?? '';
  const eventId = opts.preview ? PREVIEW_CTX.eventId : opts.eventId ?? '';
  useSyncExternalStore(
    cb => { ch.subs.add(cb); return () => { ch.subs.delete(cb); }; },
    () => `${ch.version}:${userId}`
  );
  const flush = useCallback(async (): Promise<FlushReport> => {
    if (!userId) return { sent: 0, rejected: [], remaining: 0, stoppedOffline: false, blocked: [], heldForOthers: ch.box.heldForOthers('') };
    return ch.box.flush(ch.send, userId);
  }, [ch, userId]);
  useEffect(() => {
    void flush();
    const t = window.setInterval(() => { void flush(); }, 8000);
    const on = () => { void flush(); };
    window.addEventListener('online', on);
    return () => { window.clearInterval(t); window.removeEventListener('online', on); };
  }, [flush]);
  const record = useCallback(async (kind: string, subject: string, payload: unknown) => {
    if (!userId) return;
    await ch.box.enqueue({ userId, eventId }, kind, subject, payload);
    void flush();
  }, [ch, flush, userId, eventId]);
  /** Send everything waiting for one match. Resolves clear=false if signal never came back in time. */
  const drain = useCallback((subject: string): Promise<DrainResult> => drainSubject(ch.box, ch.send, userId, subject), [ch, userId]);
  const rejected: OutboxEntry[] = userId ? ch.box.rejectedList(userId) : [];
  const discardRejected = useCallback(async (subject?: string) => {
    for (const e of ch.box.rejectedList(userId)) if (!subject || e.subject === subject) await ch.box.discard(e.id, userId);
  }, [ch, userId]);
  const retryRejected = useCallback(async (subject?: string) => {
    for (const e of ch.box.rejectedList(userId)) if (!subject || e.subject === subject) await ch.box.retry(e.id, userId);
    void flush();
  }, [ch, userId, flush]);
  return {
    waiting: userId ? ch.box.waiting(userId) : 0, stuck: userId ? ch.box.stuck(userId) : 0, heldForOthers: ch.box.heldForOthers(userId),
    durable: ch.box.durable, record, flush, drain, rejected, discardRejected, retryRejected, signedIn: Boolean(userId)
  };
}
