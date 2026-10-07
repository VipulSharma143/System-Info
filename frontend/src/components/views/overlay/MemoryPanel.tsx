import { memo } from 'react';
import { MemoryStick } from 'lucide-react';

import { formatMemory, formatNumber, formatSpeed } from '../../../lib/format';
import type { MemoryHardwareInfo } from '../../../types/system';

import { Meter, Metric, MetricGrid, Missing, Section, SubHeading } from './parts';
import { type MemoryView } from './model';

const bytes = (n: number | null) => (n == null ? null : formatMemory(n));

function OsMemory({ memory }: { memory: MemoryView }) {
  return (
    <div className="space-y-2">
      <SubHeading>Operating system view</SubHeading>
      <Meter percent={memory.percent} hue="ram" label="Memory utilization" />
      <MetricGrid>
        <Metric label="Utilization" value={`${formatNumber(memory.percent, 0)}%`} />
        <Metric label="Total" value={formatMemory(memory.total)} />
        <Metric label="Used" value={formatMemory(memory.used)} />
        <Metric label="Available" value={formatMemory(memory.available)} detail="Can be given to programs" />
        <Metric label="Free" value={bytes(memory.free)} detail="Completely unused" />
        <Metric label="Cached" value={bytes(memory.cached)} />
        <Metric label="Buffers" value={bytes(memory.buffers)} />
        <Metric label="Swap / page file" value={bytes(memory.swapUsed)} detail={memory.swapTotal != null ? `of ${formatMemory(memory.swapTotal)}${memory.swapPercent != null ? ` · ${formatNumber(memory.swapPercent, 0)}%` : ''}` : undefined} />
        <Metric label="Swap / page file available" value={bytes(memory.swapFree)} />
      </MetricGrid>
    </div>
  );
}

function Modules({ hw }: { hw: MemoryHardwareInfo | null }) {
  if (!hw) return <p className="text-[12px] text-faint">Reading memory hardware…</p>;
  if (!hw.available || !hw.summary) return <p className="text-[12px] text-faint">{hw.note ?? 'The firmware memory tables are not available to this account.'}</p>;
  const s = hw.summary;
  return (
    <div className="space-y-3">
      <MetricGrid>
        <Metric label="Installed (hardware)" value={bytes(s.installedBytes)} />
        <Metric label="Modules" value={s.moduleCount} detail={s.slotCount != null ? `of ${s.slotCount} slots` : undefined} />
        <Metric label="Type" value={s.memoryType} detail={s.formFactor ?? undefined} />
        <Metric label="Speed" value={s.configuredSpeedMTs == null ? null : formatSpeed(s.configuredSpeedMTs)} detail={s.maxSpeedMTs != null ? `max ${formatSpeed(s.maxSpeedMTs)}` : undefined} />
      </MetricGrid>
      {hw.modules.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="text-faint">
                <th className="py-1 pr-3 font-medium">Slot</th><th className="py-1 pr-3 font-medium">Capacity</th><th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 pr-3 font-medium">Manufacturer</th><th className="py-1 font-medium">Part number</th>
              </tr>
            </thead>
            <tbody>
              {hw.modules.map((m, i) => (
                <tr key={`${m.locator ?? 'slot'}-${i}`} className="border-t border-line">
                  <td className="py-1.5 pr-3">{m.locator ?? <Missing />}</td>
                  <td className="num py-1.5 pr-3">{m.capacityBytes != null ? formatMemory(m.capacityBytes) : <Missing />}</td>
                  <td className="py-1.5 pr-3">{m.memoryType ?? <Missing />}</td>
                  <td className="py-1.5 pr-3">{m.manufacturer ?? <Missing />}</td>
                  <td className="py-1.5">{m.partNumber ?? <Missing />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MemoryPanel({ memory, hardware }: { memory: MemoryView | null; hardware: MemoryHardwareInfo | null }) {
  return (
    <Section title="Memory" icon={MemoryStick} hue="ram" meta={memory ? `${formatMemory(memory.used)} / ${formatMemory(memory.total)}` : undefined}>
      {memory ? <OsMemory memory={memory} /> : <p className="text-[13px] text-faint">Reading memory…</p>}
      <div className="space-y-2">
        <SubHeading>Physical RAM hardware (firmware)</SubHeading>
        <Modules hw={hardware} />
      </div>
    </Section>
  );
}

export default memo(MemoryPanel);
