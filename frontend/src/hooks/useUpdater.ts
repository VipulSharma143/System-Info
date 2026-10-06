import { useCallback, useEffect, useRef, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '../lib/tauri';
import { inlineMessage, reportDiagnostic, type AlertKind } from '../lib/errors';
import { showAlert } from '../lib/alerts';
import { classifyUpdateError, describeError, downloadComplete, prepareForInstall, retryTransient, type PrepareResult } from '../lib/updateFlow';

/*
  In-app updates, end to end.

  Source of updates: `latest.json`, attached to every GitHub Release by
  release.yml and fetched by tauri-plugin-updater from the endpoint in
  tauri.conf.json (plugins.updater). The plugin verifies the installer's
  minisign signature against the public key baked into the app before it
  installs anything, so a hijacked download can't become code execution.

  Flow when an update is installed (installNow):

    1. download  — services keep running, the dashboard stays live, progress
                   is reported through `progress`.
    2. release   — `prepare_for_update` stops the backend and WAITS until its
                   port, process and every file in the backend folder are
                   released (Windows keeps a just-exited .exe locked for a
                   moment; Linux reports ETXTBSY). The installer never starts
                   on a locked file, which is what made the first attempt fail
                   while an immediate Retry (files free by then) succeeded.
    3. install   — Windows: the NSIS installer takes over and the app exits
                   (the plugin does this itself); Linux: AppImage is swapped
                   in place / the .deb is installed via pkexec.
    4. relaunch  — the new version starts and the Tauri shell starts every
                   service again from scratch (lib.rs setup) = a clean start.

  Failures are classified (lib/updateFlow.ts): transient ones (network blip,
  a file not yet released) are retried a bounded number of times with jittered
  backoff; permanent ones (bad signature, 404, cancelled password prompt, no
  disk space, anything unrecognised) are not. Every failure's full cause chain
  is written to update.log at the moment it happens. If step 3 fails the
  services are started again, so a failed update never leaves the app
  half-stopped. A finished download is kept, so Retry does not download again.

  Checks run automatically a few seconds after the dashboard has loaded, then
  every CHECK_INTERVAL_MS while the app stays open; the Updates tab can also
  trigger one manually. Automatic checks fail silently (an offline laptop
  shouldn't nag); manual ones report the error.
*/

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error';

export interface AvailableUpdate {
  version: string;
  date?: string;
  notes: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

const FIRST_CHECK_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 30_000;
const CHECK_RETRIES = 2;
const DOWNLOAD_RETRIES = 2;
const INSTALL_RETRIES = 2;
const AUTO_INSTALL_KEY = 'system-info-auto-update';

function readAutoInstall(): boolean {
  try {
    return localStorage.getItem(AUTO_INSTALL_KEY) === '1';
  } catch {
    return false;
  }
}

// Raw updater errors (URLs, TLS/DNS causes, installer output) are for developers.
// They go to the console; the UI shows catalog copy and raises a friendly alert.
function fail(kind: AlertKind, context: string, err: unknown): string {
  reportDiagnostic(context, err);
  void showAlert(kind);
  return inlineMessage(kind);
}

/** One line to update.log in the data folder (best effort; the log must never break an update). */
async function logUpdate(line: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('log_update_event', { line: `${new Date().toISOString()} [ui] ${line}` });
  } catch {
    /* logging is diagnostics only */
  }
}

async function prepareShell(timeoutMs: number): Promise<PrepareResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<PrepareResult>('prepare_for_update', { timeoutMs });
}

export function useUpdater(enabled: boolean) {
  const supported = isTauri();

  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: null });
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [autoInstall, setAutoInstallState] = useState<boolean>(readAutoInstall);

  const pending = useRef<Update | null>(null);
  // The pending update whose installer bytes are already downloaded and complete: Retry skips the download.
  const downloaded = useRef<Update | null>(null);
  // Mirrors `phase` for use inside timers/async code, where the state value
  // captured by the closure would be stale.
  const phaseRef = useRef<UpdatePhase>('idle');
  const autoInstallRef = useRef(autoInstall);

  const changePhase = useCallback((next: UpdatePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const installNow = useCallback(async () => {
    const update = pending.current;
    if (!supported || !update) return;
    if (phaseRef.current === 'downloading' || phaseRef.current === 'installing') return;

    setError(null);
    const { invoke } = await import('@tauri-apps/api/core');

    // 1. Download (skipped when a previous attempt already finished it). Transient network failures are retried.
    if (downloaded.current !== update) {
      changePhase('downloading');
      try {
        await retryTransient(
          async () => {
            let received = 0;
            let total: number | null = null;
            setProgress({ downloaded: 0, total: null });
            await update.download((event) => {
              if (event.event === 'Started') {
                total = event.data.contentLength ?? null;
                received = 0;
                setProgress({ downloaded: 0, total });
              } else if (event.event === 'Progress') {
                received += event.data.chunkLength;
                setProgress((p) => ({ ...p, downloaded: p.downloaded + event.data.chunkLength }));
              }
            });
            if (!downloadComplete(received, total)) throw new Error(`incomplete download: received ${received} of ${total ?? 'unknown'} bytes`);
          },
          {
            retries: DOWNLOAD_RETRIES,
            onRetry: (attempt, delay, err) => void logUpdate(`download attempt ${attempt} failed (${describeError(err)}); retrying in ${delay} ms`),
          }
        );
        downloaded.current = update;
      } catch (err) {
        void logUpdate(`download failed [${classifyUpdateError(err)}]: ${describeError(err)}`);
        setError(fail('updateDownload', 'update download failed', err));
        changePhase('error');
        return;
      }
    }

    // 2 + 3. Release the backend's files, then install. Both steps repeat only for transient failures.
    changePhase('installing');
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= INSTALL_RETRIES; attempt += 1) {
      try {
        const released = await prepareForInstall(prepareShell, {
          onAttempt: (n, r) => void logUpdate(`prepare attempt ${n + 1}: released=${r.released} waited=${r.waitedMs} ms ${r.detail}`),
        });
        if (!released.released) throw new Error(`files are still locked: ${released.detail}`);
        await update.install();
        // Only reached on Linux — on Windows the installer has already terminated this process from inside install().
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
        return;
      } catch (err) {
        lastError = err;
        const kind = classifyUpdateError(err);
        void logUpdate(`install attempt ${attempt + 1} failed [${kind}]: ${describeError(err)}`);
        if (kind !== 'transient' || attempt >= INSTALL_RETRIES) break;
        await new Promise((resolve) => window.setTimeout(resolve, 750 * (attempt + 1)));
      }
    }

    try {
      await invoke('start_services');
    } catch {
      /* nothing more to do — the error below is what matters */
    }
    setError(fail('updateInstall', 'update install failed', lastError));
    changePhase('error');
  }, [supported, changePhase]);

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (!supported) return;
      const busy = phaseRef.current;
      if (busy === 'checking' || busy === 'downloading' || busy === 'installing') return;

      // An already-found update is kept as-is by automatic re-checks; only a
      // manual check re-queries the server.
      if (!manual && busy === 'available') return;

      changePhase('checking');
      setError(null);

      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        // Only transient failures (cold DNS/TLS, a dropped connection) are retried, with backoff. A permanent
        // failure (bad manifest, 404) is reported at once, and the first failure's cause chain is logged now,
        // while it is still the real one.
        const update: Update | null = await retryTransient(() => check({ timeout: CHECK_TIMEOUT_MS }), {
          retries: CHECK_RETRIES,
          onRetry: (attempt, delay, err) => void logUpdate(`update check attempt ${attempt} failed (${describeError(err)}); retrying in ${delay} ms`),
        });
        setLastChecked(Date.now());

        if (pending.current && pending.current !== update) {
          pending.current.close().catch(() => undefined);
          downloaded.current = null;
        }
        pending.current = update;

        if (update) {
          setAvailable({ version: update.version, date: update.date, notes: update.body ?? '' });
          changePhase('available');
          if (!manual && autoInstallRef.current) void installNow();
        } else {
          setAvailable(null);
          changePhase('up-to-date');
        }
      } catch (err) {
        void logUpdate(`update check failed [${classifyUpdateError(err)}]: ${describeError(err)}`);
        if (manual) {
          // The error that crosses the IPC boundary is only the outermost
          // message ("error sending request for url ..."). Ask Rust to redo
          // the check and report the whole cause chain (DNS/TLS/timeout/...).
          // That chain is developer diagnostics: it is logged, never shown.
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            reportDiagnostic('update check cause chain', await invoke<string>('diagnose_update_check'));
          } catch {
            /* diagnostics are best-effort */
          }
          setError(fail('updateCheck', 'update check failed', err));
          changePhase('error');
        } else {
          console.warn('[updater] automatic update check failed:', err);
          changePhase('idle');
        }
      }
    },
    [supported, changePhase, installNow]
  );

  // Automatic checks: once shortly after the dashboard is up, then periodically.
  useEffect(() => {
    if (!supported || !enabled) return;
    const first = window.setTimeout(() => void runCheck(false), FIRST_CHECK_DELAY_MS);
    const repeat = window.setInterval(() => void runCheck(false), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(repeat);
    };
  }, [supported, enabled, runCheck]);

  const setAutoInstall = useCallback((value: boolean) => {
    autoInstallRef.current = value;
    setAutoInstallState(value);
    try {
      localStorage.setItem(AUTO_INSTALL_KEY, value ? '1' : '0');
    } catch {
      /* storage unavailable — the setting just won't persist */
    }
  }, []);

  const checkNow = useCallback(() => runCheck(true), [runCheck]);

  return {
    supported,
    phase,
    available,
    progress,
    error,
    lastChecked,
    autoInstall,
    setAutoInstall,
    checkNow,
    installNow,
  };
}

export type UpdaterApi = ReturnType<typeof useUpdater>;
