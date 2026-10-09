import { useEffect, useState } from 'react';
import type { OverlaySnapshot } from '../types/overlay';
import { usePolling } from './usePolling';

const POLL_MS = 1000;

/** The native monitor engine's latest snapshot; fetched only while the Overlay tab is open. */
export function useOverlay(active: boolean) {
  return usePolling<OverlaySnapshot>('/api/overlay', { intervalMs: POLL_MS, enabled: active });
}

/** A clock that ticks once a second while `active`, so "updated N s ago" and the live/stalled state stay honest. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs]);
  return now;
}

const COMPACT_KEY = 'systeminfo.overlay.compact';

/** Compact mode (dials only) is a personal preference kept between launches. */
export function useCompactPreference(): [boolean, (v: boolean) => void] {
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch { return false; }
  });
  const set = (v: boolean) => {
    setCompact(v);
    try { localStorage.setItem(COMPACT_KEY, v ? '1' : '0'); } catch { /* storage unavailable: the choice lasts for this session */ }
  };
  return [compact, set];
}
