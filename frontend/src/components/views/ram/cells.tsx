import { NOT_REPORTED } from '../../../lib/format';

/** The single rendering of an unknown value. */
export function NotReported({ hint }: { hint?: string }) {
  return (
    <span className="text-[13px] font-normal text-faint" title={hint}>
      {NOT_REPORTED}
    </span>
  );
}
