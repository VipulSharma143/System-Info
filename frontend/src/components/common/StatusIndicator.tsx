interface StatusIndicatorProps {
  live: boolean;
}

export default function StatusIndicator({ live }: StatusIndicatorProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
      <span className="relative flex h-1.5 w-1.5">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
            live ? 'bg-[var(--accent)]' : 'bg-[var(--critical)]'
          }`}
        />
      </span>
      {live ? 'Live' : 'Disconnected'}
    </span>
  );
}
