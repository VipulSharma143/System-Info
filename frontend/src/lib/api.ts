import { API_BASE } from './apiConfig';

/** The one place a backend JSON request is made: base URL, status check and parsing. */
export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  return (await response.json()) as T;
}
