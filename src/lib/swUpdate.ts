/**
 * Safe service-worker updates. A new build downloads in the background and WAITS (public/sw.js no longer takes over by itself).
 * The page decides when it is safe to activate: never while a scoring screen is open or while this device holds scoring work that has not
 * been confirmed by the server. There is an explicit emergency path ("Update anyway") for a critical event-day fix; because scoring work is
 * stored in IndexedDB, even that path reloads the page without losing anything.
 */
export interface UpdateSafetyInput {
  /** A scoring screen is open (a match is being scored). */
  scoringOpen: boolean;
  /** Score actions on this device (any account) not yet confirmed by the server. */
  pendingActions: number;
  /** Matches with a half-scored board or an unconfirmed finalization stored on this device. */
  unfinishedBoards: number;
}
export interface UpdateSafety { safe: boolean; reasons: string[] }

export function updateSafety(i: UpdateSafetyInput): UpdateSafety {
  const reasons: string[] = [];
  if (i.scoringOpen) reasons.push('a scoring screen is open');
  if (i.pendingActions > 0) reasons.push(`${i.pendingActions} score ${i.pendingActions === 1 ? 'action is' : 'actions are'} still waiting to reach the server`);
  if (i.unfinishedBoards > 0) reasons.push(`${i.unfinishedBoards} ${i.unfinishedBoards === 1 ? 'match is' : 'matches are'} part-scored or waiting to be made official on this device`);
  return { safe: reasons.length === 0, reasons };
}

/** How many scoring screens are open right now. A counter, so two open screens (or a quick remount) cannot unlock an update early. */
let scoringOpen = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());
export const scoringGuard = {
  enter() { scoringOpen += 1; emit(); },
  leave() { scoringOpen = Math.max(0, scoringOpen - 1); emit(); },
  get open() { return scoringOpen > 0; }
};

export type UpdatePhase = 'none' | 'ready';
let phase: UpdatePhase = 'none';
let waiting: ServiceWorker | null = null;
let reloading = false;
export const updateStore = {
  subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
  get phase() { return phase; }
};

let registration: ServiceWorkerRegistration | null = null;

function setWaiting(w: ServiceWorker | null) {
  waiting = w;
  phase = w ? 'ready' : 'none';
  emit();
}
/** Read the truth from the registration instead of trusting a remembered worker object: workers are replaced and can become redundant. */
function syncWaiting() {
  const w = registration?.waiting ?? null;
  setWaiting(w && navigator.serviceWorker.controller ? w : null);
}

/**
 * Ask the waiting worker to take over. The page reloads once, when the new worker is in control.
 * Browsers occasionally leave the handover pending (skipWaiting never completes while a page is open: seen in Chromium). So if control has not
 * changed after SKIP_WAIT_MS and we are online, drop the old registration and reload: the page then installs the new build fresh, with the same
 * scoring data (it lives in IndexedDB, not in the worker). Never while offline: without a worker or signal the app shell would not load.
 */
export const SKIP_WAIT_MS = 5000;
export function activateUpdate(): boolean {
  syncWaiting();
  if (!waiting) return false;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  window.setTimeout(() => { void handoverFallback(); }, SKIP_WAIT_MS);
  return true;
}

async function handoverFallback(): Promise<void> {
  if (reloading || phase !== 'ready') return;                  // the normal handover worked (the page is already reloading)
  if (!navigator.onLine) { note = 'Could not switch to the new version while offline. Your scoring is safe. Try again when you have signal.'; emit(); return; }
  reloading = true;
  try { await registration?.unregister(); } catch { /* reload anyway */ }
  window.location.reload();
}

let note: string | null = null;
export const updateNote = () => note;

const CHECK_MS = 30 * 60_000;

export function registerServiceWorker(scriptUrl: string): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let lastController = sw.controller;   // null on the very first visit: the first worker claiming the page is not an update
  sw.addEventListener('controllerchange', () => {
    const hadController = lastController !== null;
    lastController = sw.controller;
    if (!hadController) return;
    // A NEW worker took control of a page that already had one: reload once so the page and its files are from the same build.
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  sw.register(scriptUrl).then(reg => {
    registration = reg;
    const watch = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', syncWaiting);
    };
    syncWaiting();
    reg.addEventListener('updatefound', () => { watch(reg.installing); syncWaiting(); });
    watch(reg.installing);
    const check = () => { void reg.update().catch(() => { /* offline: try again later */ }); };
    window.setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    (window as unknown as { __bosCheckUpdate?: () => void }).__bosCheckUpdate = check;
  }).catch(() => { /* the app works without it */ });
}
