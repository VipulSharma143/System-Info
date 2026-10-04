import type { ReactNode } from 'react';

import { NOT_REPORTED } from '../../../lib/format';

/** The single rendering of an unknown value. */
export function NotReported({ hint }: { hint?: string }) {
  return (
    <span className="text-[13px] text-[var(--text-faint)]" title={hint}>
      {NOT_REPORTED}
    </span>
  );
}

/** Formats a present value, or renders the shared "Not reported" for null. */
export function val<T>(value: T | null | undefined, format: (v: T) => string): ReactNode {
  return value === null || value === undefined ? <NotReported /> : format(value);
}

export function yesNo(value: boolean | null, yes: string, no: string): ReactNode {
  return value === null ? <NotReported /> : value ? yes : no;
}
