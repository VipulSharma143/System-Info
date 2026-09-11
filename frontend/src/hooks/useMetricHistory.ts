import { useEffect, useRef, useState } from 'react';

// Purely client-side ring buffer built from values the app already polls —
// no additional requests. Gives the overview sparklines a short trend
// without needing a backend history endpoint.
const MAX_POINTS = 40;

export function useMetricHistory(value: number | undefined) {
  const [points, setPoints] = useState<number[]>([]);
  const last = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (value === undefined || value === last.current) return;
    last.current = value;
    setPoints((prev) => {
      const next = [...prev, value];
      return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
    });
  }, [value]);

  return points;
}
