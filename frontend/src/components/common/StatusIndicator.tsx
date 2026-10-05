import type { ConnectionState } from '../../hooks/useSystemMetrics';

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

export default function StatusIndicator({ connection }: { connection: ConnectionState }) {
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
