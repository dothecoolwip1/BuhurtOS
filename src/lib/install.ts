import { useEffect, useState } from 'react';
import { isStandalone } from './push';
import { platformOf, stillDismissed, type Platform } from './pushSupport';

/**
 * Install prompt. Chromium browsers hand over a one-shot "install" event; it is captured as early as possible (this module is imported by main.tsx)
 * and kept until a person presses Install. iPhone/iPad have no such event, so they get the Share → Add to Home Screen steps instead.
 */
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as InstallEvent; emit(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
}

const KEY = 'bos-install-dismissed';
export const INSTALL_ASK_DAYS = 45;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export const dismissInstall = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage can be blocked */ } emit(); };

export interface InstallState {
  /** Show something at all: not already installed, not recently dismissed, and the browser can do it. */
  offer: boolean;
  platform: Platform;
  /** The browser can show its own install dialog right now. */
  native: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useInstall(): InstallState {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const platform = platformOf(navigator.userAgent, navigator.maxTouchPoints);
  const standalone = installed || isStandalone();
  const dismissed = stillDismissed(read(KEY), Date.now(), INSTALL_ASK_DAYS);
  const native = deferred !== null;
  // Only offer where it can work: the native dialog, or instructions on iPhone/iPad. A desktop browser without the event gets nothing.
  const offer = !standalone && !dismissed && (native || platform === 'ios');
  return {
    offer, platform, native,
    install: async () => {
      if (!deferred) return;
      const e = deferred; deferred = null;
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'dismissed') dismissInstall(); else emit();
    },
    dismiss: dismissInstall
  };
}
