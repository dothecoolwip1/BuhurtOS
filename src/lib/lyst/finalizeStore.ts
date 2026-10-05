import { sharedDb, tx } from '../idb';

/**
 * The command id of "Finish match" for one match, kept on the device so pressing Finish again after a lost signal sends the SAME command (the server then
 * answers "already saved") and can never create a second result. Lives in the existing scoring database (the boards store) under its own key prefix.
 */
interface Rec { key: string; userId: string; matchId: string; commandId: string; savedAt: number; review?: 'conflict' }
const memory = new Map<string, Rec>();
const keyOf = (userId: string, matchId: string) => `lyst-final:${userId}:${matchId}`;

export async function loadFinalCommand(userId: string, matchId: string): Promise<{ commandId: string; review?: 'conflict' } | null> {
  const k = keyOf(userId, matchId);
  const db = await sharedDb();
  if (db) { try { const r = (await tx(db, 'boards', 'readonly', s => s.get(k))) as Rec | undefined; if (r && r.userId === userId) return { commandId: r.commandId, review: r.review }; } catch { /* memory */ } }
  const m = memory.get(k);
  return m ? { commandId: m.commandId, review: m.review } : null;
}

export async function saveFinalCommand(userId: string, matchId: string, commandId: string, review?: 'conflict'): Promise<void> {
  const rec: Rec = { key: keyOf(userId, matchId), userId, matchId, commandId, savedAt: Date.now(), review };
  memory.set(rec.key, rec);
  const db = await sharedDb();
  if (db) { try { await tx(db, 'boards', 'readwrite', s => s.put(rec)); } catch { /* memory copy remains for this session */ } }
}

export async function clearFinalCommand(userId: string, matchId: string): Promise<void> {
  const k = keyOf(userId, matchId);
  memory.delete(k);
  const db = await sharedDb();
  if (db) { try { await tx(db, 'boards', 'readwrite', s => s.delete(k)); } catch { /* ignore */ } }
}
