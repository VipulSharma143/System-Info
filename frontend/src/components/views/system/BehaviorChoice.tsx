import { memo } from 'react';
import { BEHAVIOR_OPTIONS, type StartupBehavior } from '../../../lib/behavior';

interface Props {
  name: string;
  value: StartupBehavior;
  onChange: (value: StartupBehavior) => void;
  disabled?: boolean;
}

/** The three background/startup options as one radio group; shared by the System page and the first-run dialog. */
function BehaviorChoice({ name, value, onChange, disabled = false }: Props) {
  return (
    <div role="radiogroup" aria-label="Background and startup behaviour" className="space-y-1.5">
      {BEHAVIOR_OPTIONS.map((o) => {
        const selected = o.value === value;
        return (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-3 rounded-[var(--r-md)] border px-3.5 py-3 transition-colors ${
              selected ? 'border-[var(--primary)] bg-surface-2' : 'border-line hover:bg-surface-2'
            } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            <input type="radio" name={name} value={o.value} checked={selected} disabled={disabled} onChange={() => onChange(o.value)} className="mt-1 h-4 w-4" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{o.label}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{o.detail}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default memo(BehaviorChoice);
