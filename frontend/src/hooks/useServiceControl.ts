import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../lib/tauri';

export type ServiceHealth = 'stopped' | 'starting' | 'running' | 'unavailable';

export interface ServiceStatus {
  backend: ServiceHealth;
  analytics: ServiceHealth;
}

const UNKNOWN_STATUS: ServiceStatus = { backend: 'stopped', analytics: 'stopped' };

// Only meaningful inside the Tauri desktop shell — there is no backend/
// analytics process to start, stop, or exit when this bundle is a plain
// browser tab (the old launcher path). Components using this hook should
// pair it with `isTauri()` to decide whether to render Start/Stop/Exit at
// all (see ServiceControls.tsx), but every function here is still safe to
// call outside Tauri — it just resolves to a no-op with the last known
// (default: stopped) status rather than throwing.
export function useServiceControl() {
  const [status, setStatus] = useState<ServiceStatus>(UNKNOWN_STATUS);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      invoke<ServiceStatus>('get_service_status').then((s) => {
        if (!cancelled) setStatus(s);
      });

      unlisten = await listen<ServiceStatus>('services-status', (event) => {
        if (!cancelled) setStatus(event.payload);
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const start = useCallback(async () => {
    if (!isTauri()) return;
    setPending(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setStatus(await invoke<ServiceStatus>('start_services'));
    } finally {
      setPending(false);
    }
  }, []);

  const stop = useCallback(async () => {
    if (!isTauri()) return;
    setPending(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setStatus(await invoke<ServiceStatus>('stop_services'));
    } finally {
      setPending(false);
    }
  }, []);

  const exit = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    // No await on the resolution — exit_app tears the process down from
    // the Rust side, so there's nothing meaningful left to update state
    // with, and waiting for a response the process may never send back
    // would just hang the button.
    void invoke('exit_app');
  }, []);

  return { status, pending, start, stop, exit };
}
