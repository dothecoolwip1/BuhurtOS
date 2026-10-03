import type { BoardMode, BoardState } from './fieldScoring';
import { sharedDb, tx } from './idb';

/**
 * The board for a match is kept on the device (IndexedDB), so a refresh or a dropped tab does not lose a half-scored fight.
 * A board belongs to the account and event that started it. `finalizeCommandId` is the idempotency key of the finalization
 * command: it is created once per board, so pressing Save again after a lost signal sends the SAME command, never a second one.
 */
export interface StoredBoard {
  key: string; userId: string; eventId: string; matchId: string; board: BoardState; finalizeCommandId?: string;
  /** Set when the server kept this device's result as a conflict or stale proposal instead of making it official. */
  review?: 'conflict' | 'stale'; savedAt: number;
}

const key = (userId: string, matchId: string) => `${userId}:${matchId}`;
const legacyKey = (matchId: string) => `bos-board-v1:${matchId}`;
const memory = new Map<string, StoredBoard>();   // fallback when IndexedDB is unavailable

const read = async (k: string): Promise<StoredBoard | null> => {
  const db = await sharedDb();
  if (db) { try { return ((await tx(db, 'boards', 'readonly', s => s.get(k))) as StoredBoard | undefined) ?? null; } catch { /* fall through */ } }
  return memory.get(k) ?? null;
};

export async function loadBoard(userId: string, eventId: string, matchId: string, mode: BoardMode): Promise<StoredBoard | null> {
  let rec = await read(key(userId, matchId));
  if (!rec) {
    // A board saved by the older version lived in localStorage without an owner. The person opening the match adopts it once.
    try {
      const raw = localStorage.getItem(legacyKey(matchId));
      if (raw) {
        const v = JSON.parse(raw) as BoardState;
        if (v && v.mode === mode && v.s) { rec = { key: key(userId, matchId), userId, eventId, matchId, board: v, savedAt: Date.now() }; await put(rec); }
        localStorage.removeItem(legacyKey(matchId));
      }
    } catch { /* ignore */ }
  }
  if (!rec || rec.userId !== userId || rec.board.mode !== mode || !rec.board.s) return null;
  return rec;
}

async function put(rec: StoredBoard): Promise<void> {
  memory.set(rec.key, rec);
  const db = await sharedDb();
  if (db) { try { await tx(db, 'boards', 'readwrite', s => s.put(rec)); } catch { /* memory copy remains for this session */ } }
}

export function saveBoard(userId: string, eventId: string, matchId: string, board: BoardState, extra: Partial<Pick<StoredBoard, 'finalizeCommandId' | 'review'>> = {}): Promise<void> {
  const k = key(userId, matchId);
  const prev = memory.get(k);
  return put({ key: k, userId, eventId, matchId, board, finalizeCommandId: extra.finalizeCommandId ?? prev?.finalizeCommandId, review: extra.review ?? prev?.review, savedAt: Date.now() });
}

export async function clearBoard(userId: string, matchId: string): Promise<void> {
  const k = key(userId, matchId);
  memory.delete(k);
  const db = await sharedDb();
  if (db) { try { await tx(db, 'boards', 'readwrite', s => s.delete(k)); } catch { /* ignore */ } }
  try { localStorage.removeItem(legacyKey(matchId)); } catch { /* ignore */ }
}
