import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Screens are loaded when they are first opened, so a phone on a tournament field downloads the screen it needs instead of the whole site.
 * After a new deploy the old build's files are gone from the server: a tab still running the old build then fails to load a screen it has not
 * opened yet. That failure reloads the page once (the new build then loads); a second failure within a minute is shown by the error boundary
 * instead of reloading in a loop. The offline service worker precaches every screen, so this never happens offline after the first visit.
 */
export const CHUNK_RELOAD_KEY = 'bos-chunk-reload';
const RELOAD_WINDOW_MS = 60_000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** True when this load failure should reload the page: no reload for a failed screen in the last minute. Records the reload when it says yes. */
export function shouldReloadForChunk(store: Store | null, now: number): boolean {
  if (!store) return false;
  try {
    const last = Number(store.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (last && now - last < RELOAD_WINDOW_MS) return false;
    store.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch { return false; }
}

function session(): Store | null { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } }

/** A lazily loaded screen from a module's named export: `lazyPage(() => import('./pages/X'), 'X')`. */
// ComponentType<any> is the same constraint React's own lazy() uses.
export function lazyPage<M, K extends keyof M>(load: () => Promise<M>, name: K): LazyExoticComponent<M[K] & ComponentType<any>> {
  return lazy(async () => {
    try {
      const mod = await load();
      return { default: mod[name] as M[K] & ComponentType<any> };
    } catch (err) {
      if (shouldReloadForChunk(session(), Date.now())) {
        window.location.reload();
        return new Promise<never>(() => {});   // the page is going away; render nothing meanwhile
      }
      throw err;
    }
  });
}
