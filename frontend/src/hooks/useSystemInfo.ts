import { useEffect, useState } from 'react';
import type { SystemIdentification } from '../types/system';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5132' : '';

// Static host/hardware identification. None of this changes while the app
// is running, so it's fetched exactly once on mount rather than joining the
// 2-second poll loop — keeping the "one request per cycle" budget intact.
export function useSystemInfo() {
  const [info, setInfo] = useState<SystemIdentification | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/api/system/info`)
      .then((r) => {
        if (!r.ok) throw new Error(`Backend returned ${r.status}`);
        return r.json() as Promise<SystemIdentification>;
      })
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { info, error };
}
