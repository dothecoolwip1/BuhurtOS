import type { OfflineMutation } from '../types';

const DB_NAME = 'buhurtos-offline';
const DB_VERSION = 2;
const STORE = 'mutations';
const MAX_AUTOMATIC_ATTEMPTS = 8;
const STALE_SYNC_MS = 2 * 60 * 1000;
const memory = new Map<string, OfflineMutation>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function isoNow(): string {
  return new Date().toISOString();
}

export function retryDelayMs(attempts: number): number {
  const safeAttempts = Math.max(1, attempts);
  return Math.min(5 * 60 * 1000, 2000 * 2 ** (safeAttempts - 1));
}

function normalizeMutation(item: OfflineMutation): OfflineMutation {
  return {
    ...item,
    updatedAt: item.updatedAt || item.createdAt,
    attempts: Number.isFinite(item.attempts) ? item.attempts : 0
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' });
      if (!store.indexNames.contains('state')) store.createIndex('state', 'state', { unique: false });
      if (!store.indexNames.contains('nextAttemptAt')) store.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
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
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync;
    await syncManager?.register('buhurtos-sync');
  } catch {
    // Browsers without Background Sync still flush on reconnect from AppState.
  }
}

export async function enqueueMutation(
  input: Omit<OfflineMutation, 'id' | 'createdAt' | 'updatedAt' | 'attempts' | 'state'>
): Promise<OfflineMutation> {
  const now = isoNow();
  const item: OfflineMutation = {
    ...input,
    id: globalThis.crypto?.randomUUID?.() ?? 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    state: 'queued'
  };
  if (!hasIndexedDb()) memory.set(item.id, item);
  else await withStore('readwrite', store => store.put(item));
  await registerBackgroundSync();
  return item;
}

export async function listMutations(): Promise<OfflineMutation[]> {
  const rows = !hasIndexedDb()
    ? [...memory.values()]
    : await withStore<OfflineMutation[]>('readonly', store => store.getAll());
  return rows.map(normalizeMutation).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateMutation(item: OfflineMutation): Promise<void> {
  const normalized = { ...normalizeMutation(item), updatedAt: isoNow() };
  if (!hasIndexedDb()) {
    memory.set(normalized.id, normalized);
    return;
  }
  await withStore('readwrite', store => store.put(normalized));
}

export async function removeMutation(id: string): Promise<void> {
  if (!hasIndexedDb()) {
    memory.delete(id);
    return;
  }
  await withStore('readwrite', store => store.delete(id));
}

export type SyncOutcome = { ok: true } | { ok: false; conflict?: boolean; retryable?: boolean; error: string };

function dueForAutomaticRetry(item: OfflineMutation, nowMs: number): boolean {
  if (item.state === 'conflict') return false;
  if (item.attempts >= MAX_AUTOMATIC_ATTEMPTS && item.state === 'failed') return false;
  if (item.state === 'syncing') {
    const lastTouched = Date.parse(item.updatedAt || item.createdAt);
    return Number.isFinite(lastTouched) && nowMs - lastTouched >= STALE_SYNC_MS;
  }
  if (item.state !== 'queued' && item.state !== 'failed') return false;
  if (!item.nextAttemptAt) return true;
  const due = Date.parse(item.nextAttemptAt);
  return !Number.isFinite(due) || due <= nowMs;
}

export async function flushMutationQueue(
  executor: (mutation: OfflineMutation) => Promise<SyncOutcome>
): Promise<{ synced: number; conflicts: number; failed: number; deferred: number }> {
  const queued = await listMutations();
  const nowMs = Date.now();
  let synced = 0;
  let conflicts = 0;
  let failed = 0;
  let deferred = 0;

  for (const item of queued) {
    if (!dueForAutomaticRetry(item, nowMs)) {
      if (item.state === 'queued' || item.state === 'failed' || item.state === 'syncing') deferred += 1;
      continue;
    }

    const syncing: OfflineMutation = {
      ...item,
      state: 'syncing',
      attempts: item.attempts + 1,
      lastError: undefined,
      nextAttemptAt: undefined,
      updatedAt: isoNow()
    };
    await updateMutation(syncing);

    try {
      const result = await executor(syncing);
      if (result.ok === true) {
        await removeMutation(item.id);
        synced += 1;
        continue;
      }

      if (result.conflict) {
        await updateMutation({ ...syncing, state: 'conflict', lastError: result.error, nextAttemptAt: undefined });
        conflicts += 1;
        continue;
      }

      const shouldRetry = result.retryable !== false && syncing.attempts < MAX_AUTOMATIC_ATTEMPTS;
      await updateMutation({
        ...syncing,
        state: 'failed',
        lastError: result.error,
        nextAttemptAt: shouldRetry ? new Date(Date.now() + retryDelayMs(syncing.attempts)).toISOString() : undefined
      });
      failed += 1;
    } catch (error) {
      const shouldRetry = syncing.attempts < MAX_AUTOMATIC_ATTEMPTS;
      await updateMutation({
        ...syncing,
        state: 'failed',
        lastError: error instanceof Error ? error.message : 'Unknown sync error',
        nextAttemptAt: shouldRetry ? new Date(Date.now() + retryDelayMs(syncing.attempts)).toISOString() : undefined
      });
      failed += 1;
    }
  }

  if ((await listMutations()).some(item => item.state === 'queued' || item.state === 'failed')) {
    await registerBackgroundSync();
  }

  return { synced, conflicts, failed, deferred };
}

export async function retryMutation(id: string): Promise<void> {
  const item = (await listMutations()).find(row => row.id === id);
  if (!item) return;
  await updateMutation({ ...item, state: 'queued', attempts: 0, nextAttemptAt: undefined, lastError: undefined });
  await registerBackgroundSync();
}

export async function discardMutation(id: string): Promise<void> {
  await removeMutation(id);
}
