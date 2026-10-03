export type Severity = 'ok' | 'warn' | 'critical';

export function severity(percent: number): Severity {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warn';
  return 'ok';
}

// Never renders "Invalid Date" — returns an em dash for anything missing
// or unparsable instead of crashing into a broken-looking cell.
export function formatTimeSafe(value: unknown): string {
  if (typeof value !== 'string') return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
}

export function formatNumber(value: unknown, digits = 1): string {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

// ---------------------------------------------------------------------------
// Memory formatting. One definition each, so no RAM card re-implements them.
// ---------------------------------------------------------------------------

/** What every unknown value reads as. Never "0 B", never blank. */
export const NOT_REPORTED = 'Not reported';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

function scaleBytes(bytes: number): { value: number; unit: (typeof BYTE_UNITS)[number] } | null {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return { value, unit: BYTE_UNITS[unit] };
}

/** Fixed-precision size, e.g. 6442450944 -> "6.00 GB" (1024-based, labelled GB as Windows does). */
export function formatBytes(bytes: number, digits = 2): string {
  const scaled = scaleBytes(bytes);
  if (!scaled) return NOT_REPORTED;
  return scaled.unit === 'B' ? `${scaled.value} B` : `${scaled.value.toFixed(digits)} ${scaled.unit}`;
}

/** Compact size for RAM figures: "16 GB", "10.4 GB", "512 MB". */
export function formatMemory(bytes: number): string {
  const scaled = scaleBytes(bytes);
  if (!scaled) return NOT_REPORTED;
  if (scaled.unit === 'B') return `${scaled.value} B`;
  return `${Number(scaled.value.toFixed(1))} ${scaled.unit}`;
}

/** Memory speeds are mega-transfers per second — never labelled MHz. */
export function formatSpeed(mts: number): string {
  return Number.isFinite(mts) && mts > 0 ? `${mts} MT/s` : NOT_REPORTED;
}

export function formatPercent(value: number, digits = 1): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : NOT_REPORTED;
}

export function formatBits(bits: number): string {
  return Number.isFinite(bits) && bits > 0 ? `${bits}-bit` : NOT_REPORTED;
}

export function formatMemoryType(value: string | null | undefined): string {
  const t = value?.trim();
  return t ? t : NOT_REPORTED;
}

/** Applies `format` to a present value, or returns the fallback for null/undefined. */
export function formatNullable<T>(
  value: T | null | undefined,
  format: (v: T) => string = String,
  fallback: string = NOT_REPORTED
): string {
  return value === null || value === undefined ? fallback : format(value);
}

/** used/total as a percentage, or null when it cannot be computed honestly. */
export function ratioPercent(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0 || used < 0) return null;
  return Math.min(100, (used / total) * 100);
}

