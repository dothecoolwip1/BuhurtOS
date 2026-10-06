import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { buildRulesIndex, clearRulesCache, readCachedRules, refreshRules, subscribeRules, type RulesData, type RulesIndex } from '../../data/rules';

/** Refresh in the background at most this often while screens are open; the saved copy is shown immediately either way. */
const FRESH_MS = 60_000;

/** A saved copy is shown only to the account it was read for: the owner also reads versions in review, a visitor never does. */
export const savedCopyFits = (d: RulesData | null, viewer: string | null): d is RulesData => !!d && d.viewer === viewer;

/**
 * The rules library for a screen: the copy saved in this browser at once (works with no signal), refreshed in the background.
 * `error` is set only when there is nothing to show at all; a failed background refresh keeps the saved copy and sets `stale`.
 * A copy saved for another account (someone signed out or in on this device) is never shown: it is dropped and read again.
 */
export function useRules(): { index: RulesIndex | null; loading: boolean; error: unknown; stale: boolean; reload: () => void } {
  const { session, loading: authLoading } = useAuth();
  const viewer = session?.user.id ?? null;
  const [data, setData] = useState<RulesData | null>(() => readCachedRules());
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => subscribeRules(d => { setData(d); setStale(false); setError(null); }), []);
  useEffect(() => {
    if (authLoading) return;
    const have = readCachedRules();
    const mine = savedCopyFits(have, viewer);
    if (mine && attempt === 0 && Date.now() - Date.parse(have.loadedAt) < FRESH_MS) return;
    if (have && !mine) { clearRulesCache(); setData(null); }
    let live = true;
    // a read that started for the previous account (sign-in changed mid-flight) is read again for this one
    refreshRules().then(d => (live && !savedCopyFits(d, viewer) ? refreshRules() : d))
      .catch(e => { if (!live) return; if (savedCopyFits(readCachedRules(), viewer)) setStale(true); else setError(e); });
    return () => { live = false; };
  }, [attempt, viewer, authLoading]);
  const shown = !authLoading && savedCopyFits(data, viewer) ? data : null;
  const index = useMemo(() => (shown ? buildRulesIndex(shown) : null), [shown]);
  return { index, loading: !shown && !error, error: shown ? null : error, stale, reload: () => { setError(null); setAttempt(n => n + 1); } };
}
