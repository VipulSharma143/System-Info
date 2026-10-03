// Placeholder block shown while data loads, so a valid-looking "0 GB" / "0%" is never
// on screen before the real reading arrives.
export default function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-[var(--surface-hover)] ${className}`}
    />
  );
}
