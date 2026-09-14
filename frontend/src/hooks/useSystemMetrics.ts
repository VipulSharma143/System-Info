import { useEffect, useState } from 'react';
import type { SystemSnapshot } from '../types/system';

// In dev (npm run dev, port 5173) the backend runs separately, so we need
// its fixed dev-mode port. In production the frontend is served BY the
// backend (see Program.cs's UseStaticFiles/MapFallbackToFile) from
// whatever port Kestrel actually bound to — which varies (the production
// launcher asks for an OS-assigned free port). Same-origin relative paths
// sidestep that entirely: they always hit whatever port served this page.
const API_BASE = import.meta.env.DEV ? 'http://localhost:5132' : '';
const POLL_INTERVAL_MS = 2000;

interface SystemMetricsState {
  data: SystemSnapshot | null;
  error: string | null;
}

export function useSystemMetrics() {
  const [state, setState] = useState<SystemMetricsState>({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;

    const fetchData = () => {
      fetch(`${API_BASE}/api/system/all`)
        .then((r) => {
          if (!r.ok) throw new Error(`Backend returned ${r.status}`);
          return r.json() as Promise<SystemSnapshot>;
        })
        .then((data) => {
          if (!cancelled) setState({ data, error: null });
        })
        .catch((err: Error) => {
          if (!cancelled) setState((prev) => ({ ...prev, error: err.message }));
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
