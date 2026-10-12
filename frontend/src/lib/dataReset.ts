/*
  The "Reset data" action on the System page. What each choice deletes is decided by the backend (DataResetService); this file
  only holds the list shown to the person, builds the request, and restarts the app once the backend reports success.
*/

export type DataCategory = 'cpu' | 'gpu' | 'battery' | 'network' | 'cache';

export interface DataCategoryInfo {
  id: DataCategory;
  label: string;
  detail: string;
}

export const DATA_CATEGORIES: readonly DataCategoryInfo[] = [
  { id: 'cpu', label: 'CPU', detail: 'Saved CPU usage history' },
  { id: 'gpu', label: 'GPU', detail: 'Cached graphics adapter details (System Info does not keep GPU readings over time)' },
  { id: 'battery', label: 'Battery', detail: 'Charging history and saved battery readings' },
  { id: 'network', label: 'Network', detail: 'Saved network speed history' },
  { id: 'cache', label: 'Other cached information', detail: 'Cached system pages, rebuilt on the next start' },
];

export interface ResetRequest {
  all: boolean;
  categories: DataCategory[];
}

/** Null when nothing is chosen. Choosing every kind is the same as "delete everything", which also clears the whole history folder. */
export function buildRequest(selected: ReadonlySet<DataCategory>, deleteAll: boolean): ResetRequest | null {
  const categories = DATA_CATEGORIES.map((c) => c.id).filter((id) => selected.has(id));
  if (!deleteAll && categories.length === 0) return null;
  const all = deleteAll || categories.length === DATA_CATEGORIES.length;
  return { all, categories: all ? DATA_CATEGORIES.map((c) => c.id) : categories };
}

export interface ResetOutcome {
  ok: boolean;
  message: string;
}

/** Reads the backend's answer. Only an explicit ok from the backend counts as success, so the app never restarts after a failed delete. */
export function interpretResponse(status: number, body: { ok?: boolean; message?: string } | null): ResetOutcome {
  if (status >= 200 && status < 300 && body?.ok === true) return { ok: true, message: body.message ?? 'Done.' };
  return { ok: false, message: body?.message ?? `The backend answered ${status}. Nothing was restarted.` };
}
