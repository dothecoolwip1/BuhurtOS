/**
 * A very small IndexedDB wrapper for the scoring queue and the scoring boards. One database, two stores.
 * If IndexedDB is not available (some private windows) callers get `null` and fall back to memory for that session,
 * and the UI says the work is not being saved on this device.
 */
export const DB_NAME = 'buhurtos-scoring';
export const DB_VERSION = 1;
export type StoreName = 'outbox' | 'boards';

let opening: Promise<IDBDatabase | null> | null = null;

export function openScoringDb(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<IDBDatabase | null> {
  if (factory === undefined) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('outbox')) {
          const s = db.createObjectStore('outbox', { keyPath: 'id' });
          s.createIndex('userId', 'userId');
          s.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** The shared connection for the app. */
export function sharedDb(): Promise<IDBDatabase | null> {
  opening ??= openScoringDb();
  return opening;
}

export function tx<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
