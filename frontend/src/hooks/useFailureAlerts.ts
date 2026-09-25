import { useEffect, useRef } from 'react';
import { dismissAlert, showAlert } from '../lib/alerts';
import type { ConnectionState } from './useSystemMetrics';

interface FailureAlertsInput {
  /** The first load never completed within the startup grace period. */
  startupFailed: boolean;
  /** Re-runs startup (the same action the on-screen Retry button performs). */
  onRetryStartup: () => void;
  /** Live-poll state, meaningful once the dashboard has loaded. */
  connection: ConnectionState;
  /** Set when GPU reads keep failing after they had worked. */
  gpuHasError: boolean;
  /**
   * True while a dropped connection is expected and not worth announcing:
   * the user pressed Stop, services are still starting, or an update is being
   * installed (services are deliberately down for that).
   */
  quiet: boolean;
}

/*
  Watches the error state the data hooks already expose and raises a friendly
  SweetAlert when something genuinely fails. It only *observes* — it starts no
  requests and changes no polling. Each effect fires once per failure (the
  alert layer also de-duplicates), and closes its alert again when the cause
  clears, so a reconnect never leaves a stale "connection lost" on screen.
*/
export function useFailureAlerts({
  startupFailed,
  onRetryStartup,
  connection,
  gpuHasError,
  quiet,
}: FailureAlertsInput): void {
  // Read through a ref so a new callback identity can't re-trigger the effect.
  const retryRef = useRef(onRetryStartup);
  useEffect(() => {
    retryRef.current = onRetryStartup;
  }, [onRetryStartup]);

  // Startup could not finish.
  useEffect(() => {
    if (!startupFailed) return;
    void showAlert('systemInfo', { onRetry: () => retryRef.current() });
    return () => dismissAlert('systemInfo');
  }, [startupFailed]);

  // Live updates stopped after working.
  const offline = connection === 'offline';
  useEffect(() => {
    if (!offline || quiet) return;
    void showAlert('connectionLost');
    return () => dismissAlert('connectionLost');
  }, [offline, quiet]);

  // GPU-only problem. If the whole connection is down that is the real
  // story, so this stays quiet unless live data is otherwise healthy.
  const live = connection === 'live';
  useEffect(() => {
    if (!gpuHasError || !live || quiet) return;
    void showAlert('gpu');
    return () => dismissAlert('gpu');
  }, [gpuHasError, live, quiet]);
}
