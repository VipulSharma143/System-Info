import { useEffect, useState } from 'react';
import type { SystemIdentification } from '../types/system';
import { API_BASE } from '../lib/apiConfig';

// Bounded startup retry (spec §4): the backend may still be starting when
// this first fires, so a single failed request isn't treated as permanent —
// it's retried on this schedule before surfacing a real error. Same reasoning
// as useSystemMetrics' offline detection, just tuned for a one-shot fetch
// instead of a steady poll.
const RETRY_DELAYS_MS = [300, 600, 1000, 1500, 2000];

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

          if (attemptIndex < RETRY_DELAYS_MS.length) {
            // Still within the startup window — this is the backend not
            // being ready yet, not a permanent failure, so stay quiet and
            // retry rather than flashing "Failed to fetch".
            timer = setTimeout(() => attemptFetch(attemptIndex + 1), RETRY_DELAYS_MS[attemptIndex]);
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
  // (spec §4) instead of leaving the user stuck once the retry budget is spent.
  const retry = () => {
    setError(null);
    setAttempt((a) => a + 1);
  };

  return { info, error, retry };
}
