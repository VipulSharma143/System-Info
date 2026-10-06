import type { CpuDetail } from '../types/system';
import { useJsonResource } from './useJsonResource';

/** Per-core usage, clocks and temperatures; polled only while a page that shows them is open. */
export function useCpuDetail(active: boolean, pollMs = 1500) {
  return useJsonResource<CpuDetail>('/api/system/cpu/detail', { active, intervalMs: pollMs });
}
