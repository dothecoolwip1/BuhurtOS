import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { LocalStorageOutbox, MemoryStorage, Outbox, type FlushReport, type OutboxEntry, type Sender } from './outbox';
import { drainSubject, type DrainResult } from './outboxWait';
import { realSender } from './scoreSender';

/**
 * Two queues. The real one is saved on the device and sent to the database. The preview one (the /marshal sample screen)
 * lives in memory and only pretends to send, so invented fights can never reach the database.
 */
interface Channel { box: Outbox; send: Sender; version: number; rejected: OutboxEntry[]; subs: Set<() => void> }
const makeChannel = (box: Outbox, send: Sender): Channel => {
  const c: Channel = { box, send, version: 0, rejected: [], subs: new Set() };
  box.subscribe(() => { c.version++; c.subs.forEach(f => f()); });
  return c;
};

/** One outbox for the whole app, so every scoring screen shares the same queue. */
export const outbox = new Outbox(new LocalStorageOutbox());

/** Preview only: the switch lets a tester pretend the signal dropped. */
const KEY = 'bos-sim-offline';
const readFlag = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
export const link = {
  simulatedOffline: readFlag(),
  set(v: boolean) { this.simulatedOffline = v; try { sessionStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } }
};
const simulatedSender: Sender = async () => {
  await new Promise(r => setTimeout(r, 250));
  return link.simulatedOffline || !navigator.onLine ? 'retry' : 'ok';
};

const real = makeChannel(outbox, realSender);
const preview = makeChannel(new Outbox(new MemoryStorage()), simulatedSender);

export function useOutbox(opts: { preview?: boolean } = {}) {
  const ch = opts.preview ? preview : real;
  useSyncExternalStore(
    cb => { ch.subs.add(cb); return () => { ch.subs.delete(cb); }; },
    () => `${ch.version}:${ch.box.size}:${ch.rejected.length}`
  );
  const flush = useCallback(async (): Promise<FlushReport> => {
    const report = await ch.box.flush(ch.send);
    if (report.rejected.length) { ch.rejected = [...ch.rejected, ...report.rejected]; ch.subs.forEach(f => f()); }
    return report;
  }, [ch]);
  useEffect(() => {
    void flush();
    const t = window.setInterval(() => { void flush(); }, 8000);
    const on = () => { void flush(); };
    window.addEventListener('online', on);
    return () => { window.clearInterval(t); window.removeEventListener('online', on); };
  }, [flush]);
  const record = useCallback(async (kind: string, subject: string, payload: unknown) => {
    await ch.box.enqueue(kind, subject, payload);
    void flush();
  }, [ch, flush]);
  /** Send everything waiting for one match. Resolves clear=false if signal never came back in time. */
  const drain = useCallback(async (subject: string): Promise<DrainResult> => {
    const r = await drainSubject(ch.box, ch.send, subject);
    if (r.rejected.length) { ch.rejected = [...ch.rejected, ...r.rejected]; ch.subs.forEach(f => f()); }
    return r;
  }, [ch]);
  const dismissRejected = useCallback((subject?: string) => {
    ch.rejected = subject ? ch.rejected.filter(e => e.subject !== subject) : [];
    ch.subs.forEach(f => f());
  }, [ch]);
  return { waiting: ch.box.size, record, flush, drain, rejected: ch.rejected, dismissRejected };
}
