import type { HwSensor } from '../../../types/sensors';

/** "41.8 °C", "1.008 V" or "1,200 RPM". Voltages keep three decimals because rails differ by tens of millivolts. */
export function formatSensor(s: Pick<HwSensor, 'kind' | 'value'>): string {
  if (s.value === null || !Number.isFinite(s.value)) return '—';
  if (s.kind === 'temperature') return `${s.value.toFixed(1)} °C`;
  if (s.kind === 'voltage') return `${s.value.toFixed(3)} V`;
  return `${Math.round(s.value).toLocaleString('en-US')} RPM`;
}

/** The limit a temperature is measured against: the critical temperature when known, otherwise the high one. */
export function temperatureLimit(s: Pick<HwSensor, 'kind' | 'highC' | 'criticalC'>): number | null {
  return s.kind === 'temperature' ? (s.criticalC ?? s.highC) : null;
}

/** How full the temperature bar is (0..100), or null when there is no limit to measure against. */
export function limitPercent(s: Pick<HwSensor, 'kind' | 'value' | 'highC' | 'criticalC'>): number | null {
  const limit = temperatureLimit(s);
  return limit !== null && s.value !== null && limit > 0 ? Math.min(100, Math.max(0, (s.value / limit) * 100)) : null;
}

/** "high 84.8 °C · critical 89.8 °C" with only the limits that exist, or null. */
export function limitsText(s: Pick<HwSensor, 'kind' | 'highC' | 'criticalC'>): string | null {
  if (s.kind !== 'temperature') return null;
  const parts = [s.highC !== null ? `high ${s.highC.toFixed(1)} °C` : null, s.criticalC !== null ? `critical ${s.criticalC.toFixed(1)} °C` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}
