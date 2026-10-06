/*
  Pure decision logic for the in-app updater: nothing here touches Tauri, the DOM or timers it does not
  receive, so every rule is unit-tested in tests/updateFlow.test.ts (`npm test`).

  Rules this file encodes:
    - Only genuinely transient failures are retried (network blips, a file the OS has not released yet),
      a bounded number of times with jittered exponential backoff. Permanent failures (bad signature, 404,
      user cancelled the password prompt, no disk space, anything unrecognised) are never retried.
    - A download counts as finished only when the bytes received match what the server announced.
    - The installer never starts until the backend's port, process and files are confirmed released.
*/

export type FailureClass = 'transient' | 'permanent' | 'cancelled';

/** Full text of an error including its `cause` chain, for the update log. */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 6; depth += 1) {
    if (current instanceof Error) {
      parts.push(depth === 0 ? current.message : `caused by: ${current.message}`);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(depth === 0 ? String(current) : `caused by: ${String(current)}`);
      current = undefined;
    }
  }
  return parts.join(' | ') || 'unknown error';
}

// Order matters: a user cancelling or a bad signature must win over a vague word like "failed".
const CANCELLED = [/dismissed/i, /cancel/i, /user denied/i, /not authorized/i, /authentication (?:is )?required/i, /exit(?:ed)? (?:with )?(?:code|status)\s*126/i];
const PERMANENT = [
  /signature/i, /minisign/i, /verif(?:y|ication)/i,
  /status code 4\d\d(?!\d)/i, /\b40[134]\b.*(?:http|status)/i, /not found/i,
  /no space left/i, /disk (?:is )?full/i, /os error 28/i,
  /access (?:is )?denied/i, /os error 5\b/i, /permission denied/i, /eacces/i,
  /invalid (?:update|archive|manifest|json)/i,
];
const TRANSIENT = [
  /error sending request/i, /timed? ?out/i, /timeout/i, /connection (?:reset|refused|closed|aborted|error)/i,
  /connect(?:ion)? (?:failed|error)/i, /dns/i, /eai_again/i, /econn(?:reset|refused|aborted)/i,
  /temporar(?:y|ily)/i, /network/i, /\btls\b/i, /ssl/i, /unexpected eof/i, /broken pipe/i,
  /status code (?:429|5\d\d)(?!\d)/i, /incomplete download/i,
  // A file the OS has not released yet: Windows sharing violation / lock violation, Linux ETXTBSY / EBUSY.
  /being used by another process/i, /sharing violation/i, /os error (?:32|33)\b/i, /text file busy/i, /etxtbsy/i, /ebusy/i,
  /files? (?:is|are) still (?:locked|in use)/i,
];

export function classifyUpdateError(err: unknown): FailureClass {
  const text = describeError(err);
  if (CANCELLED.some((re) => re.test(text))) return 'cancelled';
  if (PERMANENT.some((re) => re.test(text))) return 'permanent';
  if (TRANSIENT.some((re) => re.test(text))) return 'transient';
  return 'permanent';   // unknown failures are not retried blindly
}

/** Delay before retry number `attempt` (1-based): base * 2^(attempt-1), capped, with +/-25% jitter. */
export function backoffMs(attempt: number, base = 1000, cap = 8000, random: () => number = Math.random): number {
  const raw = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.75 + random() * 0.5));
}

export interface RetryOptions {
  /** Retries AFTER the first attempt. */
  retries: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  base?: number;
  cap?: number;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  /** Overrides the default classification (tests, or operations with their own rules). */
  classify?: (err: unknown) => FailureClass;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `operation`; repeats it only while failures are transient and retries remain. */
export async function retryTransient<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const { retries, sleep = realSleep, random = Math.random, base, cap, onRetry, classify = classifyUpdateError } = options;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (err) {
      if (attempt >= retries || classify(err) !== 'transient') throw err;
      const delay = backoffMs(attempt + 1, base, cap, random);
      onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }
}

/**
 * True unless the download is demonstrably short. A short read is the dangerous case (a truncated installer);
 * more bytes than announced (a proxy re-encoding the body) is left to the plugin's signature check, so a
 * harmless mismatch never blocks an update. An unknown total only proves the body is not empty.
 */
export function downloadComplete(downloaded: number, total: number | null): boolean {
  if (total === null) return downloaded > 0;
  return downloaded >= total;
}

export interface PrepareResult {
  released: boolean;
  waitedMs: number;
  detail: string;
}

/**
 * Asks the shell to stop the backend and confirm its port, process and files are released. The wait itself is
 * bounded inside the shell; if it ends unreleased it is repeated up to `retries` times (the stop is idempotent),
 * and an unreleased result is returned, never turned into "go ahead and install".
 */
export async function prepareForInstall(
  prepare: (timeoutMs: number) => Promise<PrepareResult>,
  options: { retries?: number; timeoutMs?: number; onAttempt?: (attempt: number, result: PrepareResult) => void } = {}
): Promise<PrepareResult> {
  const { retries = 2, timeoutMs = 10_000, onAttempt } = options;
  let last: PrepareResult = { released: false, waitedMs: 0, detail: 'not attempted' };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    last = await prepare(timeoutMs);
    onAttempt?.(attempt, last);
    if (last.released) return last;
  }
  return last;
}
