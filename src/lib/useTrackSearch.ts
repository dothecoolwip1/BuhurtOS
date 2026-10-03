import { useEffect, useRef } from 'react';
import { trackEvent } from './analytics';

/**
 * Counts that a search box was used (which page, once per visit to that page). What was typed is never recorded: search text can be
 * a person's name or anything else, and it would have to be treated as personal information.
 */
export function useTrackSearch(where: string, query: string): void {
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current || query.trim().length < 2) return;
    const t = window.setTimeout(() => { counted.current = true; trackEvent('search', { where }); }, 1500);
    return () => window.clearTimeout(t);
  }, [where, query]);
}
