import { useEffect, useState } from 'react';
import type { ConnectionState } from '../../hooks/useSystemMetrics';

interface StatusIndicatorProps {
  connection: ConnectionState;
  lastUpdated: number | null;
}

// Renders "● Live · updated 2s ago". The relative age is recomputed on its
// own 1s timer rather than only on poll, so if polling stops the number
// keeps climbing — the user can always tell whether what they're looking at
// is current. Status is never communicated by colour alone: the dot always
// has a word next to it.
export default function StatusIndicator({ connection, lastUpdated }: StatusIndicatorProps) {
  // `now` is held in state and advanced by the interval below rather than
  // read via Date.now() during render — render stays pure, and the ticking
  // is an explicit, cleaned-up subscription to the clock.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const label =
    connection === 'live'
      ? 'Live'
      : connection === 'reconnecting'
        ? 'Reconnecting'
        : connection === 'offline'
          ? 'Offline'
          : 'Connecting';

  const color =
    connection === 'live'
      ? 'var(--accent)'
      : connection === 'reconnecting'
        ? 'var(--warn)'
        : connection === 'offline'
          ? 'var(--critical)'
          : 'var(--text-muted)';

  const age =
    lastUpdated === null ? null : Math.max(0, Math.round((now - lastUpdated) / 1000));

  const ageLabel =
    age === null
      ? null
      : age < 2
        ? 'just now'
        : age < 60
          ? `${age}s ago`
          : `${Math.floor(age / 60)}m ago`;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-1.5 w-1.5">
        {connection === 'live' && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: color }}
          />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      </span>

      <span style={{ color }}>{label}</span>

      {ageLabel !== null && (
        <>
          <span aria-hidden="true">·</span>
          <span>updated {ageLabel}</span>
        </>
      )}
    </span>
  );
}