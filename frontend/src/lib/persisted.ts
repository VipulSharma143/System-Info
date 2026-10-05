import { APP_VERSION } from './version';

const PREFIX = 'systeminfo.cache.';
const SCHEMA = 1;

export interface Persisted<T> {
  value: T;
  savedAt: number;
}

export interface PersistSpec<T> {
  name: string;
  maxAgeMs: number;
  /** Minimum gap between writes; the first value of a session is always written. */
  writeEveryMs: number;
  validate: (value: unknown) => value is T;
  /** Drops anything not worth keeping across launches. */
  prepare?: (value: T) => T;
}

interface Envelope {
  schema: number;
  version: string;
  savedAt: number;
  value: unknown;
}

function discard(name: string) {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    // Storage unavailable: nothing to clean up.
  }
}

/** Null on any miss: absent, corrupt, written by another app version or schema, too old, or failing validation. */
export function loadPersisted<T>(spec: PersistSpec<T>): Persisted<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + spec.name);
    if (raw === null) return null;

    const envelope = JSON.parse(raw) as Envelope;
    const age = Date.now() - envelope.savedAt;
    if (
      envelope.schema === SCHEMA &&
      envelope.version === APP_VERSION &&
      age >= 0 &&
      age <= spec.maxAgeMs &&
      spec.validate(envelope.value)
    ) {
      return { value: envelope.value, savedAt: envelope.savedAt };
    }
  } catch {
    // Corrupt JSON or blocked storage: treated as a miss below.
  }
  discard(spec.name);
  return null;
}

/** Never throws; a failed write only means the next launch starts without a cache. */
export function savePersisted<T>(spec: PersistSpec<T>, value: T) {
  try {
    const envelope: Envelope = {
      schema: SCHEMA,
      version: APP_VERSION,
      savedAt: Date.now(),
      value: spec.prepare ? spec.prepare(value) : value,
    };
    localStorage.setItem(PREFIX + spec.name, JSON.stringify(envelope));
  } catch {
    // Quota exceeded or storage blocked.
  }
}
