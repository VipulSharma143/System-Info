interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string | number> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/*
  A row of mutually exclusive options in one rounded track — used for the
  Analytics time range and the Processes sort order, which previously each
  hand-rolled a slightly different version of this.
*/
export default function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg)] p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`h-6 rounded-[4px] px-2.5 text-[12px] font-medium transition-colors ${
              active
                ? 'bg-[var(--surface-hover)] text-[var(--text)] shadow-[0_0_0_1px_var(--border-strong)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
