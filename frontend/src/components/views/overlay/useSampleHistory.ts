import { useEffect, useState } from 'react';

const MAX_POINTS = 60;

/**
 * Short trend that advances on every sample, including unchanged ones (the shared history hook skips repeats,
 * which would freeze a steady load's line). `tick` changes once per backend sample; unknown values add nothing.
 */
export function useSampleHistory(value: number | null, tick: number | undefined): number[] {
  const [points, setPoints] = useState<number[]>([]);

  useEffect(() => {
    if (value === null || tick === undefined) return;
    setPoints((prev) => {
      const next = prev.length >= MAX_POINTS ? prev.slice(prev.length - MAX_POINTS + 1) : prev.slice();
      next.push(value);
      return next;
    });
  }, [value, tick]);

  return points;
}
