import { useEffect, useRef, useState } from 'react';
import type { GpuInfo } from '../types/system';
import { API_BASE } from '../lib/apiConfig';

// GPU gets its own polling cadence (spec §26/§27), separate from the 1s
// CPU/RAM loop — sampling "GPU Engine" performance counters takes its own
// ~200ms settle time per call, so it's polled on a slightly longer interval
// rather than being folded into /api/system/all.
const POLL_INTERVAL_MS = 2000;

export function useSystemGpu() {
  const [gpus, setGpus] = useState<GpuInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failures = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const fetchGpus = () => {
      fetch(`${API_BASE}/api/system/gpu`)
        .then((r) => {
          if (!r.ok) throw new Error(`Backend returned ${r.status}`);
          return r.json() as Promise<GpuInfo[]>;
        })
        .then((data) => {
          if (cancelled) return;
          failures.current = 0;
          setGpus(data);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          failures.current += 1;
          // A GPU read failing is a page-scoped concern (spec §23) — it
          // never blocks or blanks the rest of the System tab, only its
          // own GPU section.
          if (failures.current >= 3) setError(err.message);
        });
    };

    fetchGpus();
    const interval = setInterval(fetchGpus, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { gpus, error };
}
