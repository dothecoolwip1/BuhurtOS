import type { OfflineMutation } from '../types';

const DB_NAME = 'buhurtos-offline';
const STORE = 'mutations';
const memory = new Map<string, OfflineMutation>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function enqueueMutation(input: Omit<OfflineMutation, 'id' | 'createdAt' | 'attempts' | 'state'>): Promise<OfflineMutation> {
  const item: OfflineMutation = {
    ...input,
    id: globalThis.crypto?.randomUUID?.() ?? `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
    state: 'queued'
  };
  if (!hasIndexedDb()) memory.set(item.id, item);
  else await withStore('readwrite', store => store.put(item));
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync;
      return syncManager?.register('buhurtos-sync');
    }).catch(() => undefined);
  }
  return item;
}

export async function listMutations(): Promise<OfflineMutation[]> {
  if (!hasIndexedDb()) return [...memory.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = await withStore<OfflineMutation[]>('readonly', store => store.getAll());
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateMutation(item: OfflineMutation): Promise<void> {
  if (!hasIndexedDb()) { memory.set(item.id, item); return; }
  await withStore('readwrite', store => store.put(item));
}

export async function removeMutation(id: string): Promise<void> {
  if (!hasIndexedDb()) { memory.delete(id); return; }
  await withStore('readwrite', store => store.delete(id));
}

export type SyncOutcome = { ok: true } | { ok: false; conflict?: boolean; error: string };

export async function flushMutationQueue(executor: (mutation: OfflineMutation) => Promise<SyncOutcome>): Promise<{ synced: number; conflicts: number; failed: number }> {
  const queued = await listMutations();
  let synced = 0;
  let conflicts = 0;
  let failed = 0;

  for (const item of queued.filter(m => m.state === 'queued' || m.state === 'failed')) {
    const syncing = { ...item, state: 'syncing' as const, attempts: item.attempts + 1 };
    await updateMutation(syncing);
    try {
      const result = await executor(syncing);
      if (result.ok === true) {
        await removeMutation(item.id);
        synced += 1;
      } else if (result.conflict) {
        await updateMutation({ ...syncing, state: 'conflict', lastError: result.error });
        conflicts += 1;
      } else {
        await updateMutation({ ...syncing, state: 'failed', lastError: result.error });
        failed += 1;
      }
    } catch (error) {
      await updateMutation({ ...syncing, state: 'failed', lastError: error instanceof Error ? error.message : 'Unknown sync error' });
      failed += 1;
    }
  }

  return { synced, conflicts, failed };
}

export async function retryMutation(id: string): Promise<void> {
  const item = (await listMutations()).find(row => row.id === id);
  if (!item) return;
  await updateMutation({ ...item, state: 'queued', lastError: undefined });
}

export async function discardMutation(id: string): Promise<void> {
  await removeMutation(id);
}
