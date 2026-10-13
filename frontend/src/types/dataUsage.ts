/** How much disk space System Info's saved data uses, from /api/data/usage. */
export interface DataUsagePart {
  id: 'history' | 'battery' | 'cache' | 'other';
  label: string;
  bytes: number;
  files: number;
}

export interface DataUsage {
  /** The folder the data lives in (it differs between Windows and Linux). */
  path: string;
  totalBytes: number;
  totalFiles: number;
  parts: DataUsagePart[];
  /** How many days of history files exist. */
  historyDays: number;
  /** yyyy-MM-dd, or null when there is no history yet. */
  oldestDay: string | null;
  newestDay: string | null;
}
