import { API_BASE } from './apiConfig';
import { interpretResponse, type ResetOutcome, type ResetRequest } from './dataReset';
import { isTauri } from './tauri';

/** Sends the request. The custom header makes the browser ask the backend's permission first, so no other web page can trigger a delete. */
export async function resetData(request: ResetRequest, fetchImpl: typeof fetch = fetch): Promise<ResetOutcome> {
  try {
    const res = await fetchImpl(`${API_BASE}/api/data/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SystemInfo-Action': 'reset-data' },
      body: JSON.stringify(request),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    return interpretResponse(res.status, body);
  } catch {
    return { ok: false, message: 'The backend could not be reached, so nothing was deleted.' };
  }
}

/** Restarts the whole app in the desktop shell (the same call the updater uses); in a plain browser it reloads the page. */
export async function restartApp(): Promise<void> {
  if (isTauri()) {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
      return;
    } catch {
      /* fall through to a reload */
    }
  }
  window.location.reload();
}
