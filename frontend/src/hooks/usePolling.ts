import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../lib/api';
import { STARTUP_GRACE_MS } from '../lib/apiConfig';
import { reportDiagnostic } from '../lib/errors';
import { loadPersisted, savePersisted, type PersistSpec } from '../lib/persisted';
import { shareUnchanged } from '../lib/share';
import { scheduleWhenVisible } from '../lib/visibility';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

// Before the first success the backend is probably still starting, so retry quickly.
const STARTUP_RETRY_MS = [300, 600, 1000, 1500, 2000];

// Consecutive failures after data had loaded before the connection is called "offline".
const OFFLINE_AFTER_FAILURES = 3;

interface Options<T> {
  /** Re-fetch this often after a success; `null` fetches once. */
  intervalMs: number | null;
  /** Nothing is requested while false (data already loaded is kept). Default true. */
  enabled?: boolean;
  /** Keeps the last response across launches so the first render does not wait for the backend. Must be a stable object. */
  persist?: PersistSpec<T>;
}

export interface Polled<T> {
  data: T | null;
  /** Epoch ms of the last successful response. */
  lastUpdated: number | null;
  connection: ConnectionState;
  /** `data` came from the previous launch's cache and has not been replaced by a live response yet. */
  stale: boolean;
  /** Nothing loaded within STARTUP_GRACE_MS of the first attempt: startup genuinely failed. */
  startupError: boolean;
  /** Restarts loading with a fresh grace window. */
  retry: () => void;
}

/** The single fetch/poll/retry loop behind the metrics, GPU and system-info hooks. */
export function usePolling<T>(path: string, { intervalMs, enabled = true, persist }: Options<T>): Polled<T> {
  const [state, setState] = useState<Omit<Polled<T>, 'retry'>>(() => {
    const cached = persist ? loadPersisted(persist) : null;
    return {
      data: cached?.value ?? null,
      lastUpdated: cached?.savedAt ?? null,
      connection: 'connecting',
      stale: cached !== null,
      startupError: false,
    };
  });
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef(false);
  const latest = useRef<T | null>(null);
  const lastSaved = useRef(0);

  useEffect(() => {
    if (!persist) return;
    const flush = () => {
      if (latest.current !== null) savePersisted(persist, latest.current);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [persist]);

  useEffect(() => {
    if (!enabled) return;
    if (intervalMs === null && loaded.current && attempt === 0) return;   // fetch-once: already have it

    let cancelled = false;
    let cancelTimer: (() => void) | undefined;
    const controller = new AbortController();
    const startedAt = Date.now();
    let failures = 0;

    const run = async () => {
      try {
        const data = await fetchJson<T>(path, controller.signal);
        if (cancelled) return;
        failures = 0;
        loaded.current = true;
        // Unchanged sections keep their identity, so memoised views skip rendering for them.
        setState((prev) => ({
          data: shareUnchanged(prev.data, data),
          lastUpdated: Date.now(),
          connection: 'live',
          stale: false,
          startupError: false,
        }));
        latest.current = data;
        if (persist && Date.now() - lastSaved.current >= persist.writeEveryMs) {
          lastSaved.current = Date.now();
          savePersisted(persist, data);
        }
        // Hidden window: wait for it to be visible again instead of polling for nobody.
        if (intervalMs !== null) cancelTimer = scheduleWhenVisible(() => void run(), intervalMs);
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        reportDiagnostic(`${path} request failed`, err);

        if (!loaded.current) {
          const startupError = Date.now() - startedAt >= STARTUP_GRACE_MS;
          setState((prev) => ({ ...prev, connection: 'connecting', startupError }));
          cancelTimer = scheduleWhenVisible(() => void run(), STARTUP_RETRY_MS[Math.min(failures - 1, STARTUP_RETRY_MS.length - 1)]);
          return;
        }

        setState((prev) => ({
          ...prev,
          connection: failures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting',
        }));
        cancelTimer = scheduleWhenVisible(() => void run(), intervalMs ?? 2000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
      cancelTimer?.();
    };
  }, [path, intervalMs, enabled, persist, attempt]);

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, startupError: false }));
    setAttempt((a) => a + 1);
  }, []);

  return { ...state, retry };
}
