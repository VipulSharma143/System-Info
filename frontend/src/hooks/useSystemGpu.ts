import { useEffect, useRef, useState } from 'react';
import type { GpuInfo } from '../types/system';
import { API_BASE, STARTUP_GRACE_MS } from '../lib/apiConfig';
import { inlineMessage, reportDiagnostic } from '../lib/errors';

// GPU gets its own polling cadence (spec §26/§27), separate from the 1s
// CPU/RAM loop — sampling "GPU Engine" performance counters takes its own
// ~200ms settle time per call, so it's polled on a slightly longer interval
// rather than being folded into /api/system/all.
const POLL_INTERVAL_MS = 2000;

// Steady-state behavior (after at least one successful load): how many
// consecutive failed polls before treating a GPU read as genuinely broken.
const OFFLINE_AFTER_FAILURES = 3;

export function useSystemGpu() {
  const [gpus, setGpus] = useState<GpuInfo[] | null>(null);
  // A real failure, only ever set AFTER at least one successful load.
  const [error, setError] = useState<string | null>(null);
  // Set only if the backend never returns a GPU list within
  // STARTUP_GRACE_MS of the first attempt — the "startup genuinely
  // failed" signal, distinct from "still starting".
  const [startupError, setStartupError] = useState<string | null>(null);
  const failures = useRef(0);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const fetchGpus = () => {
      fetch(`${API_BASE}/api/system/gpu`)
        .then((r) => {
          if (!r.ok) throw new Error(`Backend returned ${r.status}`);
          return r.json() as Promise<GpuInfo[]>;
        })
        .then((data) => {
          if (cancelled) return;
          failures.current = 0;
          hasLoadedOnce.current = true;
          setGpus(data);
          setError(null);
          setStartupError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          failures.current += 1;
          reportDiagnostic('gpu request failed', err);

          if (!hasLoadedOnce.current) {
            // Still within the startup window — the backend/native engine
            // may simply not be ready yet. Stay quiet until the shared
            // grace period genuinely runs out.
            const elapsed = Date.now() - startedAt;
            if (elapsed >= STARTUP_GRACE_MS) setStartupError(inlineMessage('systemInfo'));
            return;
          }

          // Steady-state behavior, unchanged: a GPU read failing after
          // data has already loaded once is a page-scoped concern (spec
          // §23) — it never blocks or blanks the rest of the System tab,
          // only its own GPU section, and only after a few failed polls.
          if (failures.current >= OFFLINE_AFTER_FAILURES) setError(inlineMessage('gpu'));
        });
    };

    fetchGpus();
    const interval = setInterval(fetchGpus, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { gpus, error, startupError };
}