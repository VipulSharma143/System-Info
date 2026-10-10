import type { CpuDetail } from '../types/cpu';
import { usePolling } from './usePolling';

const POLL_MS = 1000;

/** The CPU tab's document (live load, clocks and temperature plus hardware detail); fetched only while the tab is open. */
export function useCpuDetail(active: boolean) {
  return usePolling<CpuDetail>('/api/system/cpu/detail', { intervalMs: POLL_MS, enabled: active });
}
