/*
  User-facing error copy — the single place the wording lives.

  The rule this file enforces: what the user reads is written here, in plain
  language, and the raw technical error (fetch failures, URLs, ports, status
  codes, stack traces) never reaches the screen. Hooks and components pick a
  message by *kind* instead of forwarding `err.message`. The raw error is
  handed to `reportDiagnostic`, which only writes to the developer console.

  The same text is used for the popup alert (lib/alerts.ts) and for any inline
  state that needs to say the same thing, so the two can never drift apart.
*/

export type AlertTone = 'error' | 'warning' | 'info' | 'question';

export type AlertKind =
  | 'systemInfo'
  | 'connectionLost'
  | 'gpu'
  | 'updateCheck'
  | 'updateDownload'
  | 'updateInstall'
  | 'speedTest'
  | 'serviceStart'
  | 'serviceStop'
  | 'confirmExit';

export interface AlertCopy {
  tone: AlertTone;
  title: string;
  text: string;
}

export const ALERT_COPY: Record<AlertKind, AlertCopy> = {
  // Startup could not finish, or the very first system read failed.
  systemInfo: {
    tone: 'error',
    title: 'Unable to load system information',
    text: "We couldn't retrieve the latest system data. Please try again.",
  },
  // Live polling stopped after having worked (steady-state disconnect).
  connectionLost: {
    tone: 'warning',
    title: 'Live updates paused',
    text: "We've lost contact with the system monitor. The last known data is still shown, and we'll reconnect automatically.",
  },
  gpu: {
    tone: 'info',
    title: 'Graphics details unavailable',
    text: "We couldn't read information about your graphics hardware. Everything else keeps working.",
  },
  updateCheck: {
    tone: 'warning',
    title: 'Unable to check for updates',
    text: "We couldn't reach the update service. Check your internet connection and try again.",
  },
  updateDownload: {
    tone: 'error',
    title: "Update couldn't be downloaded",
    text: 'The download was interrupted. Check your internet connection and try again.',
  },
  updateInstall: {
    tone: 'error',
    title: "Update couldn't be installed",
    text: 'Something went wrong while installing the update. Your current version is unchanged. Please try again.',
  },
  speedTest: {
    tone: 'warning',
    title: "Speed test couldn't finish",
    text: 'Check your internet connection and try again.',
  },
  serviceStart: {
    tone: 'error',
    title: 'Unable to start monitoring',
    text: "System Info couldn't start its monitoring services. Please try again.",
  },
  serviceStop: {
    tone: 'error',
    title: 'Unable to stop monitoring',
    text: "System Info couldn't stop its monitoring services. Please try again.",
  },
  confirmExit: {
    tone: 'question',
    title: 'Exit System Info?',
    text: 'This stops monitoring and closes the app.',
  },
};

/** The plain-language sentence for a kind — for inline states that mirror an alert. */
export function inlineMessage(kind: AlertKind): string {
  return ALERT_COPY[kind].text;
}

/**
 * Developer-only diagnostics. `console.debug` is hidden by default in browser
 * devtools (it sits under "Verbose"), so polling loops don't spam the console,
 * but the raw cause is still one click away when someone is debugging.
 */
export function reportDiagnostic(context: string, error: unknown): void {
  console.debug(`[system-info] ${context}:`, error);
}

// Patterns that mean "this string was written for developers".
const TECHNICAL_PATTERNS: RegExp[] = [
  /localhost/i,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/, // IPv4 address
  /\[[0-9a-f:]{2,}\]/i, // IPv6 literal
  /:\d{2,5}\b/, // :port
  /https?:\/\//i,
  /\/api\//i,
  /failed to fetch/i,
  /networkerror/i,
  /network error/i,
  /load failed/i,
  /err_[a-z_]+/i, // ERR_CONNECTION_REFUSED and friends
  /econn\w+/i,
  /\bat\s+\S+\s*\(.*:\d+:\d+\)/, // stack frame
  /\bstack\b/i,
  /exception/i,
  /caused by/i,
  /error sending request/i,
];

/** True when the text looks like a raw developer/network message. */
export function looksTechnical(text: string): boolean {
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Safety net for anything that might still carry a raw message into the UI:
 * returns the text untouched when it reads as plain language, otherwise the
 * fallback. Nothing in the app is expected to hit the fallback — callers pass
 * catalog copy — this exists so a future regression can't leak a URL.
 */
export function safeMessage(text: string | null | undefined, fallback: string): string {
  if (!text || looksTechnical(text)) return fallback;
  return text;
}
