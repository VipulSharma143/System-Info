import type { DataUsage, DataUsagePart } from '../types/dataUsage';

/** "0 B", "4.5 KB", "12.3 MB", "1.20 GB": binary units (1 KB = 1024 B), the way Windows and most file managers report sizes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : unit >= 3 ? 2 : 1)} ${units[unit]}`;
}

function dayLabel(isoDay: string, locale?: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? isoDay : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** "12 days, 1 Oct 2026 to 12 Oct 2026", "1 day, 12 Oct 2026", or "No history yet". */
export function historyRange(usage: Pick<DataUsage, 'historyDays' | 'oldestDay' | 'newestDay'>, locale?: string): string {
  if (usage.historyDays <= 0 || !usage.oldestDay || !usage.newestDay) return 'No history yet';
  const days = `${usage.historyDays} ${usage.historyDays === 1 ? 'day' : 'days'}`;
  return usage.oldestDay === usage.newestDay
    ? `${days}, ${dayLabel(usage.oldestDay, locale)}`
    : `${days}, ${dayLabel(usage.oldestDay, locale)} to ${dayLabel(usage.newestDay, locale)}`;
}

/** What share of the total a part takes, 0..100 (0 when there is nothing stored). */
export function sharePercent(part: Pick<DataUsagePart, 'bytes'>, totalBytes: number): number {
  return totalBytes > 0 ? Math.min(100, Math.max(0, (part.bytes / totalBytes) * 100)) : 0;
}

/** "12 files" / "1 file" / "none". */
export function fileCount(files: number): string {
  return files <= 0 ? 'none' : `${files.toLocaleString('en-US')} ${files === 1 ? 'file' : 'files'}`;
}
