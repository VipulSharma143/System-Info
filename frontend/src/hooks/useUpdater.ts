import { useCallback, useEffect, useRef, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '../lib/tauri';

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
    2. stop      — `stop_services` shuts backend + analytics down cleanly, so
                   no process is holding files the installer must replace
                   (Windows locks running .exe files; Linux would otherwise
                   keep running the old binaries).
    3. install   — Windows: the NSIS installer takes over and the app exits
                   (the plugin does this itself); Linux: AppImage is swapped
                   in place / the .deb is installed via pkexec.
    4. relaunch  — the new version starts and the Tauri shell starts every
                   service again from scratch (lib.rs setup) = a clean start.

  If step 3 fails (e.g. the user cancels the Linux password prompt) the
  services are started again, so a failed update never leaves the app
  half-stopped.

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
const CHECK_TIMEOUT_MS = 15_000;
const AUTO_INSTALL_KEY = 'system-info-auto-update';

function readAutoInstall(): boolean {
  try {
    return localStorage.getItem(AUTO_INSTALL_KEY) === '1';
  } catch {
    return false;
  }
}

function describe(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
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
    setProgress({ downloaded: 0, total: null });
    changePhase('downloading');

    try {
      await update.download((event) => {
        if (event.event === 'Started') {
          setProgress({ downloaded: 0, total: event.data.contentLength ?? null });
        } else if (event.event === 'Progress') {
          setProgress((p) => ({ ...p, downloaded: p.downloaded + event.data.chunkLength }));
        }
      });
    } catch (err) {
      setError(`Download failed: ${describe(err)}`);
      changePhase('error');
      return;
    }

    changePhase('installing');
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('stop_services');
      await update.install();
      // Only reached on Linux — on Windows the installer has already
      // terminated this process from inside install().
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      try {
        await invoke('start_services');
      } catch {
        /* nothing more to do — the error below is what matters */
      }
      setError(`Install failed: ${describe(err)}`);
      changePhase('error');
    }
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
        const update = await check({ timeout: CHECK_TIMEOUT_MS });
        setLastChecked(Date.now());

        if (pending.current && pending.current !== update) {
          pending.current.close().catch(() => undefined);
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
        if (manual) {
          setError(describe(err));
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
