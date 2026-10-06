/**
 * "Focus Lyst N": the announcer's own choice of which Lyst to look at first. LOCAL ONLY: it lives in this browser's localStorage and nothing
 * else. It writes nothing to the server and changes no other screen (queue, score, timer, camera, OBS). Storage can be missing or throw
 * (a private window, blocked site data), so every access is wrapped and the screen works without it.
 */
export const focusStorageKey = (eventId: string): string => `bos-announcer-focus:${eventId}`;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStore = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function loadFocus(eventId: string, store: Store | null = defaultStore()): string | null {
  if (!eventId || !store) return null;
  try { const v = store.getItem(focusStorageKey(eventId)); return v && v.length <= 80 ? v : null; } catch { return null; }
}

export function saveFocus(eventId: string, focus: string | null, store: Store | null = defaultStore()): void {
  if (!eventId || !store) return;
  try { if (focus) store.setItem(focusStorageKey(eventId), focus); else store.removeItem(focusStorageKey(eventId)); } catch { /* the choice just is not remembered */ }
}
