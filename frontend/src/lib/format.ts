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
