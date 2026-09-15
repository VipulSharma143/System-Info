import { useEffect, useRef, useState } from 'react';
import type { SystemSnapshot } from '../types/system';

// In dev (npm run dev, port 5173) the backend runs separately, so we need
// its fixed dev-mode port. In production the frontend is served BY the
// backend (see Program.cs's UseStaticFiles/MapFallbackToFile) from
// whatever port Kestrel actually bound to — which varies (the production
// launcher asks for an OS-assigned free port). Same-origin relative paths
// sidestep that entirely: they always hit whatever port served this page.
const API_BASE = import.meta.env.DEV ? 'http://localhost:5132' : '';
const POLL_INTERVAL_MS = 2000;

// After this many consecutive failures we stop calling the connection
// "reconnecting" and call it what it is. Keeps a single dropped poll from
// flashing a scary "Offline" badge at the user.
const OFFLINE_AFTER_FAILURES = 3;

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface SystemMetricsState {
  data: SystemSnapshot | null;
  error: string | null;
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
    connection: 'connecting',
    lastUpdated: null,
  });

  const failures = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const fetchData = () => {
      fetch(`${API_BASE}/api/system/all`)
        .then((r) => {
          if (!r.ok) throw new Error(`Backend returned ${r.status}`);
          return r.json() as Promise<SystemSnapshot>;
        })
        .then((data) => {
          if (cancelled) return;
          failures.current = 0;
          setState({
            data,
            error: null,
            connection: 'live',
            lastUpdated: Date.now(),
          });
        })
        .catch((err: Error) => {
          if (cancelled) return;
          failures.current += 1;
          setState((prev) => ({
            ...prev,
            error: err.message,
            // Keep showing the last good data while reconnecting rather
            // than blanking the dashboard — but the header's staleness
            // counter keeps ticking so it's never mistaken for live.
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
