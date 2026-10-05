import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '../lib/api';
import { reportDiagnostic } from '../lib/errors';
import { loadPersisted, savePersisted, type PersistSpec } from '../lib/persisted';
import { shareUnchanged } from '../lib/share';

interface Options {
  /** Only fetch/poll while true — the RAM tab is mounted even when hidden. */
  active: boolean;
  /** Re-fetch this often after a success. Omit for data that is fetched once. */
  intervalMs?: number;
  /** Failed attempts (with no data yet) before `error` is raised. */
  errorAfter?: number;
  /** Seeds the first render from the previous launch and keeps the latest response for the next one. Must be a stable object. */
  persist?: PersistSpec<unknown>;
}

export interface JsonResource<T> {
  data: T | null;
  /** True only when there is nothing to show and the last attempts failed. */
  error: boolean;
  /** No data yet and no failure yet. */
  loading: boolean;
  retry: () => void;
}

const RETRY_DELAYS_MS = [1000, 3000, 10_000];

/*
  Small fetch-and-poll loop for the RAM page's three independent endpoints.

    - nothing is requested while `active` is false (tab hidden);
    - once data has been shown it is kept on screen across later failures —
      stale-but-real beats blanking the page; the app-level offline banner
      already says when live updates stop;
    - a failure before any data exists retries with a short backoff and only
      becomes `error` after `errorAfter` attempts, so a slow first response
      never flashes an error;
    - raw errors go to the developer console only (reportDiagnostic).
*/
export function useJsonResource<T>(
  path: string,
  { active, intervalMs, errorAfter = 2, persist }: Options
): JsonResource<T> {
  const [data, setData] = useState<T | null>(() => (persist ? (loadPersisted(persist)?.value as T | undefined) ?? null : null));
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    if (!active) return;
    // Fetch-once resources (physical hardware) are not re-requested on every tab switch.
    if (!intervalMs && loaded.current && attempt === 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let failures = 0;

    const run = async () => {
      try {
        const json = await fetchJson<T>(path, controller.signal);
        if (cancelled) return;
        failures = 0;
        loaded.current = true;
        setData((prev) => shareUnchanged(prev, json));
        if (persist) savePersisted(persist, json);
        setError(false);
        if (intervalMs) timer = setTimeout(run, intervalMs);
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        reportDiagnostic(`${path} request failed`, err);
        if (!loaded.current && failures >= errorAfter) setError(true);
        const delay = intervalMs ?? RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)];
        // Fetch-once resources stop after the backoff list is used up; Retry restarts them.
        if (intervalMs || failures <= RETRY_DELAYS_MS.length) timer = setTimeout(run, delay);
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [active, path, intervalMs, errorAfter, persist, attempt]);

  const retry = useCallback(() => {
    setError(false);
    setAttempt((a) => a + 1);
  }, []);

  // Stable identity while nothing changed, so memoised panels that receive the resource skip renders.
  return useMemo(() => ({ data, error, loading: data === null && !error, retry }), [data, error, retry]);
}
