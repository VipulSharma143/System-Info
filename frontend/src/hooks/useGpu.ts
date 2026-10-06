import type { GpuHardwareInfo, GpuLiveInfo } from '../types/system';
import type { PersistSpec } from '../lib/persisted';
import { useJsonResource } from './useJsonResource';

const LIVE_POLL_MS = 2000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function isHardware(value: unknown): value is GpuHardwareInfo {
  if (typeof value !== 'object' || value === null) return false;
  const { available, adapters } = value as Partial<GpuHardwareInfo>;
  return (
    typeof available === 'boolean' &&
    Array.isArray(adapters) &&
    adapters.every((a) => typeof a === 'object' && a !== null && typeof a.id === 'string' && typeof a.name === 'string')
  );
}

const HARDWARE_CACHE: PersistSpec<unknown> = {
  name: 'gpu-hardware',
  maxAgeMs: MONTH_MS,
  writeEveryMs: 0,
  validate: isHardware,
};

/** Adapter facts are fetched once and remembered between launches; telemetry is polled only while the page is open. */
export function useGpu(active: boolean, pollMs = LIVE_POLL_MS) {
  const hardware = useJsonResource<GpuHardwareInfo>('/api/system/gpus/hardware', { active, persist: HARDWARE_CACHE });
  const live = useJsonResource<GpuLiveInfo>('/api/system/gpus/live', {
    active: active && hardware.data?.available === true,
    intervalMs: pollMs,
  });
  return { hardware, live };
}
