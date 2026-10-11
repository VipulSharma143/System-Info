import type { ReactNode } from 'react';
import { NotReported } from './cells';

/** Formats a present value, or renders the shared "Not reported" for null. */
export function val<T>(value: T | null | undefined, format: (v: T) => string): ReactNode {
  return value === null || value === undefined ? <NotReported /> : format(value);
}

export function yesNo(value: boolean | null, yes: string, no: string): ReactNode {
  return value === null ? <NotReported /> : value ? yes : no;
}
