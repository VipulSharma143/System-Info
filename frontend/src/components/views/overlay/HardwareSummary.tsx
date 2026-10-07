import { memo } from 'react';
import { Server } from 'lucide-react';

import { formatMemory } from '../../../lib/format';
import type { MemoryHardwareInfo, SystemIdentification } from '../../../types/system';

import { Badge, InfoRow } from '../../common/Primitives';

import { topologyLabel, type CpuView, type GpuView, type MemoryView } from './model';
import { Missing, Section } from './parts';

interface HardwareSummaryProps {
  info: SystemIdentification | null;
  cpu: CpuView;
  gpus: GpuView[];
  memory: MemoryView | null;
  hardware: MemoryHardwareInfo | null;
}

function Availability({ label, ok, off }: { label: string; ok: boolean | null; off: string }) {
  if (ok === null) return <Badge tone="muted">{label}: checking</Badge>;
  return <Badge tone={ok ? 'ok' : 'muted'}>{label}: {ok ? 'available' : off}</Badge>;
}

function HardwareSummary({ info, cpu, gpus, memory, hardware }: HardwareSummaryProps) {
  const host = info ? [info.manufacturer, info.model].filter(Boolean).join(' ') : '';
  const installedBytes = hardware?.summary?.installedBytes;
  const installed = installedBytes != null ? formatMemory(installedBytes) : null;
  return (
    <Section title="Hardware" icon={Server} hue="sys" meta={info?.machineName}>
      <div>
        <InfoRow label="CPU" value={info?.cpuModel ?? <Missing />} />
        <InfoRow label="CPU topology" value={topologyLabel(cpu) ?? <Missing />} />
        <InfoRow label="GPU" value={gpus.length ? gpus.map((g) => g.name).join(' · ') : <Missing />} />
        <InfoRow label="RAM (operating system)" value={memory ? formatMemory(memory.total) : <Missing />} />
        <InfoRow label="RAM (hardware)" value={installed ?? <Missing />} />
        <InfoRow label="Operating system" value={info?.osDescription ?? <Missing />} />
        <InfoRow label="Architecture" value={info ? `${info.osArchitecture} (process ${info.processArchitecture})` : <Missing />} />
        <InfoRow label="Device" value={host || <Missing />} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Availability label="CPU temperature" ok={cpu.status === 'unavailable' ? null : cpu.packageTemperature != null} off="not reported" />
        <Availability label="CPU power" ok={cpu.status === 'unavailable' ? null : cpu.power != null} off="not reported" />
        <Availability label="GPU telemetry" ok={gpus.length ? gpus.some((g) => g.status === 'live') : null} off="none" />
        <Availability label="Memory modules" ok={hardware ? hardware.available && (hardware.modules.length > 0) : null} off="not exposed" />
      </div>
    </Section>
  );
}

export default memo(HardwareSummary);
