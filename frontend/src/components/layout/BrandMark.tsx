/** The product mark: a heartbeat line crossing a rounded tile, in the CPU / memory / network hues. */
export default function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="brand-line" x1="2" y1="0" x2="30" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--hue-cpu)" />
          <stop offset="0.55" stopColor="var(--hue-ram)" />
          <stop offset="1" stopColor="var(--hue-net)" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="10" fill="var(--surface-2)" stroke="var(--line-strong)" strokeWidth="1.5" />
      <path d="M5 17h5l3-7 5 12 3-7h6" stroke="url(#brand-line)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
