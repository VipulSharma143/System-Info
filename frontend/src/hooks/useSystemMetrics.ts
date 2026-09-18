import { useEffect, useRef, useState } from 'react';
import type { SystemSnapshot } from '../types/system';
import { API_BASE, STARTUP_GRACE_MS } from '../lib/apiConfig';

const POLL_INTERVAL_MS = 2000;

// After this many consecutive failures we stop calling the connection
// "reconnecting" and call it what it is. Keeps a single dropped poll from
// flashing a scary "Offline" badge at the user. Only applies once data has
// loaded at least once — see hasLoadedOnce below for the startup case.
const OFFLINE_AFTER_FAILURES = 3;

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface SystemMetricsState {
  data: SystemSnapshot | null;
  // A real failure, only ever set AFTER at least one successful load —
  // this is what OfflineBanner reads. Never the raw first-attempt
  // "Failed to fetch" from a backend that's simply still starting.
  error: string | null;
  // Set only if the backend never responds within STARTUP_GRACE_MS of the
  // very first attempt. This is the "startup genuinely failed" signal a
  // startup screen should show as a real error; it's null the entire time
  // the backend just hasn't come up yet.
  startupError: string | null;
  connection: ConnectionState;
  // Epoch ms of the last *successful* poll. The UI turns this into
  // "updated 2s ago" so a stale number can never be mistaken for a live
  // one — see the spec's live-update-indicator requirement.
  lastUpdated: number | null;
}

export function useSystemMetrics() {
  const [state, setState] = useState<SystemMetricsState>({
    data: null,
    error: null,
    startupError: null,
    connection: 'connecting',
    lastUpdated: null,
  });

  const failures = useRef(0);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const fetchData = () => {
      fetch(`${API_BASE}/api/system/all`)
        .then((r) => {
          if (!r.ok) throw new Error(`Backend returned ${r.status}`);
          return r.json() as Promise<SystemSnapshot>;
        })
        .then((data) => {
          if (cancelled) return;
          failures.current = 0;
          hasLoadedOnce.current = true;
          setState({
            data,
            error: null,
            startupError: null,
            connection: 'live',
            lastUpdated: Date.now(),
          });
        })
        .catch((err: Error) => {
          if (cancelled) return;
          failures.current += 1;

          if (!hasLoadedOnce.current) {
            // Nothing has ever loaded yet — this is very likely the
            // backend still starting (it can take up to ~30s; see
            // src-tauri/src/process.rs), not a real failure. Stay in
            // "connecting" and keep polling; only surface startupError
            // once the whole grace period has passed with zero success.
            const elapsed = Date.now() - startedAt;
            setState((prev) => ({
              ...prev,
              connection: 'connecting',
              startupError: elapsed >= STARTUP_GRACE_MS ? err.message : null,
            }));
            return;
          }

          // Steady-state behavior, unchanged: data has loaded at least
          // once before, so a failure here is a real (if possibly
          // temporary) disconnect — keep showing the last good data while
          // reconnecting rather than blanking the dashboard.
          setState((prev) => ({
            ...prev,
            error: err.message,
            connection:
              failures.current >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting',
          }));
        });
    };

    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return state;
}