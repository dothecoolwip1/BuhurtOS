import { useEffect, useState, type DependencyList } from 'react';

export interface AsyncState<T> { data: T | undefined; error: unknown; loading: boolean }

/** Runs a loader whenever the dependencies change; ignores results that arrive after the inputs changed. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: undefined }));
    load().then(
      data => { if (live) setState({ data, error: undefined, loading: false }); },
      error => { if (live) setState({ data: undefined, error, loading: false }); }
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
