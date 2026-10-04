import type { GpuInfo } from '../types/system';
import { inlineMessage } from '../lib/errors';
import { usePolling } from './usePolling';

// GPU engine utilisation is live, but it is only read while the System page is on screen.
const POLL_INTERVAL_MS = 2000;

export function useSystemGpu(active: boolean) {
  const { data, connection, startupError } = usePolling<GpuInfo[]>('/api/system/gpu', {
    intervalMs: POLL_INTERVAL_MS,
    enabled: active,
  });
  // GPU trouble is scoped to the GPU panel; it never blocks the rest of the app.
  const failing = startupError || connection === 'offline';
  return { gpus: data, error: failing ? inlineMessage('gpu') : null };
}
