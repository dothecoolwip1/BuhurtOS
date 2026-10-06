import { useEffect, useMemo, useState } from 'react';
import { buildRulesIndex, readCachedRules, refreshRules, subscribeRules, type RulesData, type RulesIndex } from '../../data/rules';

/** Refresh in the background at most this often while screens are open; the saved copy is shown immediately either way. */
const FRESH_MS = 60_000;

/**
 * The rules library for a screen: the copy saved in this browser at once (works with no signal), refreshed in the background.
 * `error` is set only when there is nothing to show at all; a failed background refresh keeps the saved copy and sets `stale`.
 */
export function useRules(): { index: RulesIndex | null; loading: boolean; error: unknown; stale: boolean; reload: () => void } {
  const [data, setData] = useState<RulesData | null>(() => readCachedRules());
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => subscribeRules(d => { setData(d); setStale(false); setError(null); }), []);
  useEffect(() => {
    const have = readCachedRules();
    if (have && attempt === 0 && Date.now() - Date.parse(have.loadedAt) < FRESH_MS) return;
    let live = true;
    refreshRules().catch(e => { if (!live) return; if (readCachedRules()) setStale(true); else setError(e); });
    return () => { live = false; };
  }, [attempt]);
  const index = useMemo(() => (data ? buildRulesIndex(data) : null), [data]);
  return { index, loading: !data && !error, error: data ? null : error, stale, reload: () => { setError(null); setAttempt(n => n + 1); } };
}
