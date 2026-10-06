import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncState<T> {
  data: T | undefined; error: unknown;
  /** True only while there is nothing to show yet for these inputs (the first load, or after the inputs changed). Never during a refresh. */
  loading: boolean;
  /** A background refresh of data that is already on screen is running. The screen keeps showing `data`. */
  refreshing?: boolean;
  /** The last background refresh failed; `data` is the last good one (still shown) and `error` stays empty. */
  refreshError?: unknown;
}
/** The state plus a way to run the same loader again (for a Retry button). Safe to ignore. */
export interface Reloadable<T> extends AsyncState<T> { reload: () => void }

const same = (a: readonly unknown[] | null, b: readonly unknown[]) => !!a && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/**
 * Runs a loader whenever the dependencies change; ignores results that arrive after the inputs changed.
 *
 * `deps` say WHAT is loaded (an event id, a slug): when they change, the screen is loading something else.
 * `refreshDeps` (optional) say WHEN to read the same thing again (a live tick, a "record changed" counter, a version): a refresh keeps the data
 * on screen, never reports `loading`, and a failed refresh keeps the last good data instead of blanking the screen. Live updates must update a
 * screen in place, not replace it with a loading state (which unmounts everything below it and loses the scroll position, open sections and input).
 * `reload()` (a Retry button) is a refresh when there is data, a load when there is not.
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList, refreshDeps: DependencyList = []): Reloadable<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });
  const [attempt, setAttempt] = useState(0);
  const identity = useRef<readonly unknown[] | null>(null);
  const hasData = useRef(false);
  useEffect(() => {
    let live = true;
    const refresh = same(identity.current, deps) && hasData.current;
    identity.current = [...deps];
    if (refresh) setState(s => ({ ...s, refreshing: true }));
    else { hasData.current = false; setState(s => ({ ...s, loading: true, error: undefined, refreshing: false, refreshError: undefined })); }
    load().then(
      data => { if (live) { hasData.current = true; setState({ data, error: undefined, loading: false, refreshing: false, refreshError: undefined }); } },
      error => {
        if (!live) return;
        if (refresh) setState(s => ({ ...s, refreshing: false, refreshError: error }));   // keep showing the last good data
        else { hasData.current = false; setState({ data: undefined, error, loading: false, refreshing: false, refreshError: undefined }); }
      }
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ...refreshDeps, attempt]);
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  return { ...state, reload };
}
