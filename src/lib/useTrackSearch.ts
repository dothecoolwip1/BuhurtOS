import { useEffect } from 'react';
import { trackEvent } from './analytics';

/** Records what people search for (the words only, once they stop typing), so the owner can see what visitors look for and miss. */
export function useTrackSearch(where: string, query: string): void {
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return;
    const t = window.setTimeout(() => trackEvent('search', { where, query: q.slice(0, 60) }), 1500);
    return () => window.clearTimeout(t);
  }, [where, query]);
}
