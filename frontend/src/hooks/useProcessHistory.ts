import { useCallback, useEffect, useRef } from 'react';
import type { ProcessInfo } from '../types/system';

export interface ProcessSnapshot {
  timestamp: number; // client-side capture time (ms since epoch)
  cpuPercent: number;
  processes: ProcessInfo[]; // top N by memory, already sorted by the backend
}

// Fixed-size ring buffer — ~5 min of history at a 2s poll interval, top 8 processes per snapshot.
// Memory only: nothing persisted, nothing sent anywhere. It lives in a ref because only
// `findNearest` ever reads it, so capturing a snapshot never triggers a render.
const MAX_SNAPSHOTS = 150;
const TOP_N = 8;
const MIN_CAPTURE_INTERVAL_MS = 1000;

export function useProcessHistory(cpuPercent: number | undefined, processes: ProcessInfo[] | undefined) {
  const history = useRef<ProcessSnapshot[]>([]);
  const lastCaptured = useRef(0);

  useEffect(() => {
    if (cpuPercent === undefined || !processes) return;
    const now = Date.now();
    if (now - lastCaptured.current < MIN_CAPTURE_INTERVAL_MS) return;
    lastCaptured.current = now;

    history.current.push({ timestamp: now, cpuPercent, processes: processes.slice(0, TOP_N) });
    if (history.current.length > MAX_SNAPSHOTS) history.current.shift();
  }, [cpuPercent, processes]);

  // Nearest-in-time snapshot to an analytics ISO timestamp — an approximation (client clock vs.
  // server clock), labelled as such in the UI.
  const findNearest = useCallback((isoTime: string): ProcessSnapshot | null => {
    const snapshots = history.current;
    if (snapshots.length === 0) return null;
    const target = new Date(isoTime).getTime();
    return snapshots.reduce((best, snap) =>
      Math.abs(snap.timestamp - target) < Math.abs(best.timestamp - target) ? snap : best
    );
  }, []);

  return { findNearest };
}
