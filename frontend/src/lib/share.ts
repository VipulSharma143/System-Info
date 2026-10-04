/**
 * Structural sharing for polled JSON: any top-level value that did not change keeps its previous
 * object identity, so memoised views skip rendering for sections that are the same as last poll.
 */
export function shareUnchanged<T>(prev: T | null, next: T): T {
  if (prev === null || typeof prev !== 'object' || typeof next !== 'object' || next === null) return next;
  if (Array.isArray(prev) || Array.isArray(next)) {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  }

  const before = prev as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  let changed = false;

  for (const key of Object.keys(after)) {
    const kept = key in before && JSON.stringify(before[key]) === JSON.stringify(after[key]);
    merged[key] = kept ? before[key] : after[key];
    if (!kept) changed = true;
  }
  if (Object.keys(before).length !== Object.keys(after).length) changed = true;

  return (changed ? merged : prev) as T;
}
