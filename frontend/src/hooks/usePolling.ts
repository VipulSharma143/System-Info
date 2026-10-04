import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../lib/api';
import { STARTUP_GRACE_MS } from '../lib/apiConfig';
import { reportDiagnostic } from '../lib/errors';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

// Until the first success the backend is most likely still starting, so retry quickly: the
// UI appears moments after the service is ready instead of waiting out a fixed poll interval.
const STARTUP_RETRY_MS = [300, 600, 1000, 1500, 2000];

// Consecutive failures after data had loaded before the connection is called "offline".
const OFFLINE_AFTER_FAILURES = 3;

interface Options {
  /** Re-fetch this often after a success; `null` fetches once. */
  intervalMs: number | null;
  /** Nothing is requested while false (data already loaded is kept). Default true. */
  enabled?: boolean;
}

export interface Polled<T> {
  data: T | null;
  /** Epoch ms of the last successful response. */
  lastUpdated: number | null;
  connection: ConnectionState;
  /** Nothing loaded within STARTUP_GRACE_MS of the first attempt: startup genuinely failed. */
  startupError: boolean;
  /** Restarts loading with a fresh grace window. */
  retry: () => void;
}

/*
  The single fetch/poll/retry loop behind the metrics, GPU and system-info hooks.
    - before the first success: quick retries; `startupError` only after STARTUP_GRACE_MS;
    - after a success: keep showing the last data across failures, move to
      reconnecting/offline, and carry on at `intervalMs`;
    - raw errors go to the developer console only.
*/
export function usePolling<T>(path: string, { intervalMs, enabled = true }: Options): Polled<T> {
  const [state, setState] = useState<Omit<Polled<T>, 'retry'>>({
    data: null,
    lastUpdated: null,
    connection: 'connecting',
    startupError: false,
  });
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (intervalMs === null && loaded.current && attempt === 0) return;   // fetch-once: already have it

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const startedAt = Date.now();
    let failures = 0;

    const run = async () => {
      try {
        const data = await fetchJson<T>(path, controller.signal);
        if (cancelled) return;
        failures = 0;
        loaded.current = true;
        setState({ data, lastUpdated: Date.now(), connection: 'live', startupError: false });
        if (intervalMs !== null) timer = setTimeout(run, intervalMs);
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        reportDiagnostic(`${path} request failed`, err);

        if (!loaded.current) {
          const startupError = Date.now() - startedAt >= STARTUP_GRACE_MS;
          setState((prev) => ({ ...prev, connection: 'connecting', startupError }));
          timer = setTimeout(run, STARTUP_RETRY_MS[Math.min(failures - 1, STARTUP_RETRY_MS.length - 1)]);
          return;
        }

        setState((prev) => ({
          ...prev,
          connection: failures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting',
        }));
        timer = setTimeout(run, intervalMs ?? 2000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [path, intervalMs, enabled, attempt]);

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, startupError: false }));
    setAttempt((a) => a + 1);
  }, []);

  return { ...state, retry };
}
