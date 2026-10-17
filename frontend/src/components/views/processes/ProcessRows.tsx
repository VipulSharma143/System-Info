import { memo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ProcessInfo } from '../../../types/system';
import { formatMB } from '../../../lib/format';
import { Td, Tr } from '../../common/Table';
import { share, type ProcessGroup } from './model';

function ShareCell({ memoryMB, totalMB, peakMB }: { memoryMB: number; totalMB: number; peakMB: number }) {
  return (
    <>
      <Td className="hidden w-[30%] py-2.5 md:table-cell">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-[var(--h)]" style={{ width: `${share(memoryMB, peakMB)}%` }} />
        </div>
      </Td>
      <Td className="num hidden w-20 py-2.5 text-right text-faint sm:table-cell">{share(memoryMB, totalMB).toFixed(1)}%</Td>
      <Td className="num w-28 py-2.5 text-right text-muted">{formatMB(memoryMB)}</Td>
    </>
  );
}

/** One process (PID, name, size, share). */
export const ProcessRow = memo(function ProcessRow({ p, totalMB, peakMB, indent = false }: { p: ProcessInfo; totalMB: number; peakMB: number; indent?: boolean }) {
  return (
    <Tr>
      <Td className="num w-24 py-2.5 text-faint">{p.pid}</Td>
      <Td className={`py-2.5 font-medium ${indent ? 'pl-8 text-muted' : ''}`}>{p.name}</Td>
      <ShareCell memoryMB={p.memoryMB} totalMB={totalMB} peakMB={peakMB} />
    </Tr>
  );
});

/** Same-named processes as one row with a count; opens to show each member's PID and size. */
export const GroupRow = memo(function GroupRow({ group, totalMB, peakMB }: { group: ProcessGroup; totalMB: number; peakMB: number }) {
  const [open, setOpen] = useState(false);
  const single = group.count === 1;
  if (single) return <ProcessRow p={group.members[0]} totalMB={totalMB} peakMB={peakMB} />;

  return (
    <>
      <Tr>
        <Td className="num w-24 py-2.5 text-faint">{group.count} PIDs</Td>
        <Td className="py-2.5 font-medium">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-left hover:text-[var(--h)]">
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
            {group.name}
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">×{group.count}</span>
          </button>
        </Td>
        <ShareCell memoryMB={group.memoryMB} totalMB={totalMB} peakMB={peakMB} />
      </Tr>
      {open && group.members.map((m) => <ProcessRow key={m.pid} p={m} totalMB={totalMB} peakMB={peakMB} indent />)}
    </>
  );
});
