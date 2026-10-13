/** One stretch on one power source, as /api/battery/history returns it. Times are UTC ISO strings. */
export interface BatterySession {
  /** `charge` = charger connected (charging, full or holding); `discharge` = running on the battery. */
  kind: 'charge' | 'discharge';
  startUtc: string;
  /** null while the session is still in progress. */
  endUtc: string | null;
  startPercent: number | null;
  endPercent: number | null;
  durationSec: number;
  /** Seconds inside the session when System Info was not running (PC off or asleep, app closed). */
  gapSec: number;
  /** False when System Info began watching mid-session or after a gap, so the start time is only "no later than". */
  startExact: boolean;
  /** False when the session ended while System Info was not running. */
  endExact: boolean;
  reachedFull: boolean;
  open: boolean;
}

/** The latest battery reading the recorder received, so the page can show that recording works (or why it cannot). */
export interface BatteryWatching {
  status: string | null;
  percent: number | null;
  readingUtc: string;
  /** False when the status ("Unknown") does not say whether the charger is connected. */
  understood: boolean;
}

export interface BatteryHistory {
  hasBattery: boolean;
  retentionDays: number;
  generatedAtUtc: string;
  sessions: BatterySession[];
  /** Null until the recorder has received its first battery reading. */
  watching: BatteryWatching | null;
}
