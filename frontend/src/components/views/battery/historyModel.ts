import type { BatterySession, BatteryWatching } from '../../../types/batteryHistory';

/*
  Everything the battery history screen derives from the recorded sessions. Pure functions of the data the backend returns:
  nothing is estimated except the one clearly labelled figure (how long a full battery lasts), and that is computed only from
  measured stretches on battery with no gaps in them.
*/

/** A stretch shorter than this is too short for a per-hour rate to mean anything. */
export const MIN_RATE_SECONDS = 10 * 60;

/** Percentage points gained (+) or lost (−) over the session, or null when either end is unknown. */
export function percentChange(s: BatterySession): number | null {
  return s.startPercent === null || s.endPercent === null ? null : s.endPercent - s.startPercent;
}

/** Points per hour, always positive: how fast the battery drained (discharge) or filled (charge). Null when the stretch has a gap, is too short, or moved the wrong way. */
export function ratePerHour(s: BatterySession): number | null {
  if (s.gapSec > 0 || s.durationSec < MIN_RATE_SECONDS) return null;
  const change = percentChange(s);
  if (change === null) return null;
  const points = s.kind === 'discharge' ? -change : change;
  return points > 0 ? points / (s.durationSec / 3600) : null;
}

export function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  if (sec < 60) return `${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  if (hours < 24) return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h === 0 ? `${days} d` : `${days} d ${h} h`;
}

export interface HistorySummary {
  /** How many times the charger was connected. */
  plugIns: number;
  /** Percentage points added across all charges. */
  chargedPoints: number;
  /** The longest stretch on battery, elapsed time (a gap in it is flagged on the row). */
  longestOnBatterySec: number | null;
  /** Average drain while in use, points per hour, from stretches with no gaps. */
  averageDrainPerHour: number | null;
  /** 100 ÷ average drain: an estimate from the measured drain above, never shown without it. */
  fullBatteryHours: number | null;
}

export function summarize(sessions: readonly BatterySession[]): HistorySummary {
  const charges = sessions.filter((s) => s.kind === 'charge');
  const discharges = sessions.filter((s) => s.kind === 'discharge');

  const chargedPoints = charges.reduce((sum, s) => {
    const change = percentChange(s);
    return change !== null && change > 0 ? sum + change : sum;
  }, 0);

  const longest = discharges.reduce<number | null>((best, s) => (best === null || s.durationSec > best ? s.durationSec : best), null);

  let points = 0;
  let seconds = 0;
  for (const s of discharges) {
    if (ratePerHour(s) === null) continue;
    points += -(percentChange(s) as number);
    seconds += s.durationSec;
  }
  const averageDrainPerHour = seconds > 0 && points > 0 ? points / (seconds / 3600) : null;

  return {
    plugIns: charges.length,
    chargedPoints,
    longestOnBatterySec: longest,
    averageDrainPerHour,
    fullBatteryHours: averageDrainPerHour === null ? null : 100 / averageDrainPerHour,
  };
}

/** Plain-language notes for a row, only the ones that apply. */
export function sessionNotes(s: BatterySession): string[] {
  const notes: string[] = [];
  if (s.open) notes.push('In progress');
  if (!s.startExact) notes.push('Start time is approximate: System Info was not running when it began');
  if (!s.endExact && !s.open) notes.push('Ended while System Info was not running');
  if (s.gapSec > 0) notes.push(`Includes ${formatDuration(s.gapSec)} when System Info was not running (PC off or asleep)`);
  if (s.reachedFull) notes.push('Reached full');
  return notes;
}

/** "Sat 11 Oct, 08:12" in the viewer's time zone (a zone and locale can be passed for tests). */
export function formatWhen(iso: string, timeZone?: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(d);
}

/** Newest first, which is the order people read a history in. */
export const newestFirst = (sessions: readonly BatterySession[]): BatterySession[] =>
  [...sessions].sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc));

/** No reading for this long means the recorder is not receiving the battery any more. */
export const STALE_AFTER_MS = 60_000;

export interface WatchingStatus {
  /** `ok` = recording; `warn` = something the person should know about. */
  tone: 'ok' | 'warn';
  text: string;
}

const STATE_WORDS: Record<string, string> = {
  discharging: 'on battery',
  charging: 'charging',
  'fully charged': 'full, on the charger',
  full: 'full, on the charger',
  'not charging': 'plugged in, not charging',
};

/** One plain sentence about whether the recorder is working, from the latest reading it received. */
export function describeWatching(watching: BatteryWatching | null, nowMs: number): WatchingStatus {
  if (!watching) return { tone: 'warn', text: 'Waiting for the first battery reading. It arrives a few seconds after System Info starts.' };
  if (!watching.understood) {
    return { tone: 'warn', text: `The battery reports its status as "${watching.status ?? 'unknown'}", so System Info cannot tell whether the charger is connected and cannot record changes.` };
  }
  const age = nowMs - Date.parse(watching.readingUtc);
  if (Number.isFinite(age) && age > STALE_AFTER_MS) {
    return { tone: 'warn', text: `No battery reading for ${formatDuration(age / 1000)}. Recording resumes when readings do.` };
  }
  const state = STATE_WORDS[(watching.status ?? '').trim().toLowerCase()] ?? (watching.status ?? 'unknown').toLowerCase();
  return { tone: 'ok', text: `Recording. Right now: ${state}${watching.percent !== null ? `, ${watching.percent}%` : ''}.` };
}
