import type { SystemIdentification } from '../types/system';
import { inlineMessage } from '../lib/errors';
import { usePolling } from './usePolling';

/** Static host identification: fetched once, when the System page is first opened. */
export function useSystemInfo(enabled: boolean) {
  const { data, startupError, retry } = usePolling<SystemIdentification>('/api/system/info', {
    intervalMs: null,
    enabled,
  });
  return { info: data, error: startupError ? inlineMessage('systemInfo') : null, retry };
}
