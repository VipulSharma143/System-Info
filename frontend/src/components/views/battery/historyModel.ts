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

/* ---------- grouping by calendar date ---------- */

/** The sessions of one calendar day, in the viewer's time zone. A session belongs to the day it started; its row says when it ended. */
export interface DateGroup {
  /** `YYYY-MM-DD`. */
  key: string;
  sessions: BatterySession[];
}

/** `YYYY-MM-DD` of an instant in a time zone (the viewer's own when omitted), or null when the timestamp is not a real time. */
export function dateKeyOf(iso: string, timeZone?: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const [y, m, d] = [get('year'), get('month'), get('day')];
  return y && m && d ? `${y}-${m}-${d}` : null;
}

/** A session with a start time that cannot be read cannot be placed on any date, so it is left out rather than guessed. */
export const hasValidStart = (s: BatterySession): boolean => !Number.isNaN(Date.parse(s.startUtc));

/** Newest date first, newest session first inside a date. Dates with no sessions do not exist, so they cannot be picked. */
export function groupByDate(sessions: readonly BatterySession[], timeZone?: string): DateGroup[] {
  const byKey = new Map<string, BatterySession[]>();
  for (const s of newestFirst(sessions.filter(hasValidStart))) {
    const key = dateKeyOf(s.startUtc, timeZone);
    if (key === null) continue;
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)).map(([key, list]) => ({ key, sessions: list }));
}

/** The date to show: the person's pick while it still has records, otherwise the newest date. Null when there is nothing at all. */
export function resolveSelectedDate(groups: readonly DateGroup[], picked: string | null): string | null {
  if (picked !== null && groups.some((g) => g.key === picked)) return picked;
  return groups[0]?.key ?? null;
}

function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "Today", "Yesterday", or "Sat 11 Oct". `nowMs` and the zone can be passed for tests. */
export function dateLabel(key: string, nowMs: number = Date.now(), timeZone?: string, locale?: string): string {
  const today = dateKeyOf(new Date(nowMs).toISOString(), timeZone);
  if (today !== null) {
    if (key === today) return 'Today';
    if (key === shiftDateKey(today, -1)) return 'Yesterday';
  }
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d, 12));
}

/** Time of day only, for rows that sit under a date heading. */
export function formatClock(iso: string, timeZone?: string, locale?: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(d);
}
