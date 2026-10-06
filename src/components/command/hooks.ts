import { useEffect, useRef, useState } from 'react';

/** The current time, re-read every `ms`. Only the component that calls it re-renders. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

/** Calls `fn` every `ms` while the page is visible, and once when it comes back to the front or the connection returns. The latest `fn` is always used. */
export function usePoll(ms: number, fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    const wake = () => { if (!document.hidden) ref.current(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
  }, [ms]);
}
