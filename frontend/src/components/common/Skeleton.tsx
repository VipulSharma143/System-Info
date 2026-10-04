// Placeholder shown while data loads, so a valid-looking "0 GB" / "0%" is never on screen first.
export default function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-[var(--r-md)] bg-surface-3 ${className}`} />;
}
