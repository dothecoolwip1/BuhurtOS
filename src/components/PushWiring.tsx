import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { syncPush } from '../lib/push';

/** Window event other components listen to ("a push just arrived"): the bell and My next fight reload straight away. */
export const PUSH_EVENT = 'bos-push';
const ROUTE = /^\/[A-Za-z0-9/_?=&#-]*$/;

/**
 * Connects the service worker to the app: a tap on a notification routes the already-open app in place (the worker sends NAVIGATE), a push that
 * arrives while the app is open refreshes what is on screen, and the device's subscription is re-registered after the browser rotates it.
 * Renders nothing.
 */
export function PushWiring() {
  const nav = useNavigate();
  const { session } = useAuth();
  const userId = session?.user.id;
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; route?: unknown } | null;
      if (!d) return;
      if (d.type === 'NAVIGATE' && typeof d.route === 'string' && ROUTE.test(d.route)) nav(d.route);
      else if (d.type === 'PUSH_RECEIVED') window.dispatchEvent(new Event(PUSH_EVENT));
      else if (d.type === 'PUSH_SUBSCRIPTION_CHANGED' && userId) void syncPush(userId);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [nav, userId]);
  useEffect(() => { if (userId) void syncPush(userId); }, [userId]);
  return null;
}
