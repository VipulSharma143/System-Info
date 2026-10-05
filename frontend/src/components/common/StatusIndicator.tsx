import { useEffect, useState } from 'react';
import type { ConnectionState } from '../../hooks/useSystemMetrics';

interface StatusIndicatorProps {
  connection: ConnectionState;
  lastUpdated: number | null;
  /** Status word only, without the "updated Ns ago" readout. */
  compact?: boolean;
}

const LABEL: Record<ConnectionState, string> = {
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  connecting: 'Connecting',
};

const COLOR: Record<ConnectionState, string> = {
  live: 'var(--ok)',
  reconnecting: 'var(--warn)',
  offline: 'var(--critical)',
  connecting: 'var(--text-muted)',
};

function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}



// "● Live · updated 2s ago". The age ticks on its own timer (only when it is shown), so if polling
// stops the number keeps climbing and the user can always tell whether the data is current.
export default function StatusIndicator({ connection, lastUpdated, compact = false }: StatusIndicatorProps) {
  const now = useNow(!compact);
  const color = COLOR[connection];

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[12px] font-medium text-muted" role="status">
      <span className="relative flex h-2 w-2">
        {connection === 'live' && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: color }} />
        )}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      </span>
      <span style={{ color }} aria-live="polite">{LABEL[connection]}</span>
    </span>
  );
}
