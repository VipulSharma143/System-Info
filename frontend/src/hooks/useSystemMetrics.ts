import type { SystemSnapshot } from '../types/system';
import { inlineMessage } from '../lib/errors';
import type { PersistSpec } from '../lib/persisted';
import { usePolling } from './usePolling';

export type { ConnectionState } from './usePolling';

const POLL_INTERVAL_MS = 2000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function isSnapshot(value: unknown): value is SystemSnapshot {
  if (!isRecord(value)) return false;
  const { ram, cpu, battery } = value;
  return (
    isRecord(ram) && typeof ram.totalMB === 'number' && typeof ram.usedPercent === 'number' &&
    isRecord(cpu) && typeof cpu.usedPercent === 'number' &&
    isRecord(battery) && typeof battery.available === 'boolean' &&
    Array.isArray(value.disks) && Array.isArray(value.network) && Array.isArray(value.processes)
  );
}

// The process list is large and changes every second, so it is never kept between launches.
const PERSIST: PersistSpec<SystemSnapshot> = {
  name: 'dashboard',
  maxAgeMs: WEEK_MS,
  writeEveryMs: 15_000,
  validate: isSnapshot,
  prepare: (snapshot) => ({ ...snapshot, processes: [] }),
};

/** The live dashboard snapshot (/api/system/all) — the only data the first screen waits for. */
export function useSystemMetrics() {
  const { data, connection, lastUpdated, stale, startupError } = usePolling<SystemSnapshot>('/api/system/all', {
    intervalMs: POLL_INTERVAL_MS,
    persist: PERSIST,
  });

  return {
    data,
    stale,
    error: data !== null && connection !== 'live' ? inlineMessage('connectionLost') : null,
    startupError: startupError ? inlineMessage('systemInfo') : null,
    connection,
    lastUpdated,
  };
}
