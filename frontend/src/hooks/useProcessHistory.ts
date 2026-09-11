import { useEffect, useRef, useState } from 'react';
import type { ProcessInfo } from '../types/system';

export interface ProcessSnapshot {
  timestamp: number; // client-side capture time (ms since epoch)
  cpuPercent: number;
  processes: ProcessInfo[]; // top N by memory, already sorted by the backend
}

// Fixed-size ring buffer — ~5 min of history at a 2s poll interval, capped
// to the top 8 processes per snapshot. Kept in memory only, nothing
// persisted, nothing sent anywhere: this is the "lightweight" version of
// spike correlation, not a monitoring subsystem.
const MAX_SNAPSHOTS = 150;
const TOP_N = 8;
const MIN_CAPTURE_INTERVAL_MS = 1000;

export function useProcessHistory(cpuPercent: number | undefined, processes: ProcessInfo[] | undefined) {
  const [history, setHistory] = useState<ProcessSnapshot[]>([]);
  const lastCaptured = useRef(0);

  useEffect(() => {
    if (cpuPercent === undefined || !processes) return;
    const now = Date.now();
    if (now - lastCaptured.current < MIN_CAPTURE_INTERVAL_MS) return;
    lastCaptured.current = now;

    setHistory((prev) => {
      const next = [...prev, { timestamp: now, cpuPercent, processes: processes.slice(0, TOP_N) }];
      return next.length > MAX_SNAPSHOTS ? next.slice(next.length - MAX_SNAPSHOTS) : next;
    });
  }, [cpuPercent, processes]);

  // Nearest-in-time snapshot to an analytics-service ISO timestamp — an
  // approximation (client clock vs. server clock), labeled as such in the UI.
  function findNearest(isoTime: string): ProcessSnapshot | null {
    if (history.length === 0) return null;
    const target = new Date(isoTime).getTime();
    let closest = history[0];
    let bestDiff = Math.abs(closest.timestamp - target);
    for (const snap of history) {
      const diff = Math.abs(snap.timestamp - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = snap;
      }
    }
    return closest;
  }

  return { history, findNearest };
}
