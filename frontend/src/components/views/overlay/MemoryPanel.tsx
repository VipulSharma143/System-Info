import { memo } from 'react';
import { MemoryStick } from 'lucide-react';

import { formatMemory, formatNumber } from '../../../lib/format';

import { type MemoryView } from './model';
import { Meter, Metric, MetricGrid, Section } from './parts';

const bytes = (n: number | null) => (n == null ? null : formatMemory(n));

/** Live operating-system memory only; module/slot hardware lives on the RAM page. */
function MemoryPanel({ memory }: { memory: MemoryView | null }) {
  return (
    <Section title="Memory" icon={MemoryStick} hue="ram" meta={memory ? `${formatMemory(memory.used)} / ${formatMemory(memory.total)}` : undefined}>
      {memory ? (
        <>
          <Meter percent={memory.percent} hue="ram" label="Memory utilization" />
          <MetricGrid>
            <Metric label="Utilization" value={`${formatNumber(memory.percent, 0)}%`} />
            <Metric label="Used" value={formatMemory(memory.used)} />
            <Metric label="Available" value={formatMemory(memory.available)} detail="Can be given to programs" />
            <Metric label="Free" value={bytes(memory.free)} detail="Completely unused" />
            <Metric label="Cached" value={bytes(memory.cached)} />
            <Metric label="Buffers" value={bytes(memory.buffers)} />
            <Metric label="Swap / page file used" value={bytes(memory.swapUsed)} detail={memory.swapTotal != null ? `of ${formatMemory(memory.swapTotal)}${memory.swapPercent != null ? ` · ${formatNumber(memory.swapPercent, 0)}%` : ''}` : undefined} />
            <Metric label="Swap / page file available" value={bytes(memory.swapFree)} />
          </MetricGrid>
        </>
      ) : (
        <p className="text-[13px] text-faint">Waiting for the first memory sample…</p>
      )}
    </Section>
  );
}

export default memo(MemoryPanel);
