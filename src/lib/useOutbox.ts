import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { LocalStorageOutbox, Outbox, type OutboxEntry, type Sender } from './outbox';

/** One outbox for the whole app, so every scoring screen shares the same queue. */
export const outbox = new Outbox(new LocalStorageOutbox());

/**
 * Preview-only: there is no backend yet, so "sending" is simulated. The switch lets a tester pretend the signal
 * dropped. Once Supabase is connected this becomes a real call that returns 'retry' on network errors.
 */
const KEY = 'bos-sim-offline';
const readFlag = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
export const link = {
  simulatedOffline: readFlag(),
  set(v: boolean) { this.simulatedOffline = v; try { sessionStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } }
};
const simulatedSender: Sender = async (_e: OutboxEntry) => {
  await new Promise(r => setTimeout(r, 250));
  return link.simulatedOffline || !navigator.onLine ? 'retry' : 'ok';
};

let version = 0;
outbox.subscribe(() => { version++; });
const subscribe = (cb: () => void) => outbox.subscribe(cb);
const snapshot = () => `${version}:${outbox.size}`;

export function useOutbox() {
  useSyncExternalStore(subscribe, snapshot);
  const flush = useCallback(() => outbox.flush(simulatedSender), []);
  useEffect(() => {
    void flush();
    const t = window.setInterval(() => { void flush(); }, 8000);
    const on = () => { void flush(); };
    window.addEventListener('online', on);
    return () => { window.clearInterval(t); window.removeEventListener('online', on); };
  }, [flush]);
  const record = useCallback(async (kind: string, subject: string, payload: unknown) => {
    await outbox.enqueue(kind, subject, payload);
    void flush();
  }, [flush]);
  return { waiting: outbox.size, record, flush };
}
