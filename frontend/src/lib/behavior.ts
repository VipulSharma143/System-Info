/*
  How System Info behaves when its window is closed and when the computer starts.
  The choice is stored by the desktop shell (settings.json in the app data folder), never in the browser,
  because the shell is what acts on it (tray icon, close handling, start-at-login registration).
*/

export type StartupBehavior = 'background' | 'off' | 'startup';

export interface BehaviorOption {
  value: StartupBehavior;
  label: string;
  detail: string;
}

export const BEHAVIOR_OPTIONS: readonly BehaviorOption[] = [
  {
    value: 'background',
    label: 'Always run in the background',
    detail: 'Closing the window keeps System Info running in the notification area, so history keeps being recorded. Open it again from the tray icon.',
  },
  {
    value: 'off',
    label: 'Do not run in the background',
    detail: 'Closing the window quits System Info completely. It starts only when you open it.',
  },
  {
    value: 'startup',
    label: 'Run automatically at system startup',
    detail: 'System Info starts when you sign in, minimised to the notification area, and keeps running there when you close the window.',
  },
] as const;

/** What the desktop shell reports about the preference. */
export interface BehaviorState {
  behavior: StartupBehavior;
  /** True only on a fresh installation that has not been asked yet (never during an update). */
  firstRun: boolean;
  /** False when the tray icon could not be created; the shell then quits on close instead of hiding the window. */
  trayAvailable: boolean;
}

export function isBehavior(value: unknown): value is StartupBehavior {
  return value === 'background' || value === 'off' || value === 'startup';
}

/** Validates the shell's reply; anything unexpected is rejected rather than guessed. */
export function parseBehaviorState(raw: unknown): BehaviorState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isBehavior(r.behavior)) return null;
  return { behavior: r.behavior, firstRun: r.firstRun === true, trayAvailable: r.trayAvailable !== false };
}

/** Only the two background modes need the tray; "off" works without one. */
export function needsTray(behavior: StartupBehavior): boolean {
  return behavior !== 'off';
}
