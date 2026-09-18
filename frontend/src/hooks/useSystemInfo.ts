import { useEffect, useState } from 'react';
import type { SystemIdentification } from '../types/system';
import { API_BASE, STARTUP_GRACE_MS } from '../lib/apiConfig';

// Fast initial ramp — most cold starts resolve well within this. Once
// exhausted, retries fall back to a steady interval (below) for the
// remainder of STARTUP_GRACE_MS, rather than giving up after a fixed
// ~5.4s total. That fixed budget used to be shorter than Tauri's own
// backend readiness wait (up to ~30s — see src-tauri/src/process.rs),
// which is exactly what produced a premature "Failed to fetch".
const RETRY_DELAYS_MS = [300, 600, 1000, 1500, 2000];
const STEADY_RETRY_MS = 2000;

// Static host/hardware identification. None of this changes while the app
// is running, so it's fetched exactly once on mount rather than joining the
// 2-second poll loop — keeping the "one request per cycle" budget intact.
export function useSystemInfo() {
  const [info, setInfo] = useState<SystemIdentification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const attemptFetch = (attemptIndex: number) => {
      fetch(`${API_BASE}/api/system/info`)
        .then((r) => {
          if (!r.ok) throw new Error(`Backend returned ${r.status}`);
          return r.json() as Promise<SystemIdentification>;
        })
        .then((data) => {
          if (cancelled) return;
          setInfo(data);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;

          const elapsed = Date.now() - startedAt;
          if (elapsed < STARTUP_GRACE_MS) {
            // Still within the startup window — this is the backend not
            // being ready yet, not a permanent failure, so stay quiet and
            // retry rather than flashing "Failed to fetch". Use the fast
            // ramp first, then settle into a steady retry interval for
            // the rest of the grace period.
            const delay =
              attemptIndex < RETRY_DELAYS_MS.length
                ? RETRY_DELAYS_MS[attemptIndex]
                : STEADY_RETRY_MS;
            timer = setTimeout(() => attemptFetch(attemptIndex + 1), delay);
          } else {
            setError(err.message);
          }
        });
    };

    attemptFetch(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Exposed so the System view's error state can offer a real Retry button
  // (spec §4) instead of leaving the user stuck once the retry budget is
  // spent. Each retry() gets its own fresh STARTUP_GRACE_MS window, since
  // the effect re-runs and resets startedAt.
  const retry = () => {
    setError(null);
    setAttempt((a) => a + 1);
  };

  return { info, error, retry };
}