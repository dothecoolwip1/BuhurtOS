import { useCallback, useEffect, useState, type DependencyList } from 'react';

export interface AsyncState<T> { data: T | undefined; error: unknown; loading: boolean }
/** The state plus a way to run the same loader again (for a Retry button). Safe to ignore. */
export interface Reloadable<T> extends AsyncState<T> { reload: () => void }

/** Runs a loader whenever the dependencies change; ignores results that arrive after the inputs changed. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): Reloadable<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: undefined }));
    load().then(
      data => { if (live) setState({ data, error: undefined, loading: false }); },
      error => { if (live) setState({ data: undefined, error, loading: false }); }
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  return { ...state, reload };
}
