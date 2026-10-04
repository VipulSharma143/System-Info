import type { SystemSnapshot } from '../types/system';
import { inlineMessage } from '../lib/errors';
import { usePolling } from './usePolling';

export type { ConnectionState } from './usePolling';

const POLL_INTERVAL_MS = 2000;

/** The live dashboard snapshot (/api/system/all) — the only data the first screen waits for. */
export function useSystemMetrics() {
  const { data, connection, lastUpdated, startupError } = usePolling<SystemSnapshot>('/api/system/all', {
    intervalMs: POLL_INTERVAL_MS,
  });

  return {
    data,
    // Only ever set after a first successful load; before that the backend is just starting.
    error: data !== null && connection !== 'live' ? inlineMessage('connectionLost') : null,
    startupError: startupError ? inlineMessage('systemInfo') : null,
    connection,
    lastUpdated,
  };
}
