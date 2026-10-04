export type Severity = 'ok' | 'warn' | 'critical';

export function severity(percent: number): Severity {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warn';
  return 'ok';
}

/** Plain-language word for a usage percentage ("Normal" / "High" / "Critical"). */
export function severityWord(percent: number, labels: [string, string, string] = ['Normal', 'High', 'Critical']): string {
  return labels[{ ok: 0, warn: 1, critical: 2 }[severity(percent)]];
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

/** used/total as a percentage, or null when it cannot be computed honestly. */
export function ratioPercent(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0 || used < 0) return null;
  return Math.min(100, (used / total) * 100);
}


// ---------------------------------------------------------------------------
// Units used by several pages, defined once.
// ---------------------------------------------------------------------------

/** Process memory arrives in MB: "512 MB" / "1.25 GB". */
export function formatMB(mb: number, gbDigits = 2): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(gbDigits)} GB` : `${mb.toFixed(0)} MB`;
}

/** Network rates arrive in KB/s: "812.0 KB/s" / "1.20 MB/s". */
export function formatRate(kbps: number): string {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(2)} MB/s` : `${kbps.toFixed(1)} KB/s`;
}

/** Drive sizes arrive in GB: "512 GB" / "1.8 TB". */
export function formatGB(gb: number, digits = 0): string {
  return gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(digits)} GB`;
}

export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return 'Unavailable';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
