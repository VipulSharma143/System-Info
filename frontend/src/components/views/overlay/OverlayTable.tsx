import { memo, type ReactNode } from 'react';
import { Cpu, Gpu, MemoryStick, Table2 } from 'lucide-react';

import { formatMB, formatMemory, formatNumber } from '../../../lib/format';
import { hueStyle, type Hue } from '../../../lib/hues';
import type { CpuDetail, GpuAdapter, GpuLiveReading, RamInfo, SystemIdentification } from '../../../types/system';

import Panel from '../../common/Panel';
import { Td, Th, Tr } from '../../common/Table';
import UsageBar from '../../common/UsageBar';

const warmth = (celsius: number) => (celsius >= 85 ? 'var(--critical)' : celsius >= 75 ? 'var(--warn)' : undefined);

function Missing({ pending = false }: { pending?: boolean }) {
  return <span className="text-faint" title={pending ? 'Measuring…' : 'Not reported'}>{pending ? '…' : '—'}</span>;
}

function Sub({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-normal text-faint">{children}</div>;
}

function Usage({ percent, hue, pending }: { percent: number | null | undefined; hue: Hue; pending?: boolean }) {
  if (percent == null) return <Missing pending={pending} />;
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <span className="num w-11 shrink-0 text-right font-medium">{formatNumber(percent, 0)}%</span>
      <div className="flex-1"><UsageBar percent={percent} hue={hue} compact hideValue /></div>
    </div>
  );
}

function Temperature({ celsius }: { celsius: number | null | undefined }) {
  if (celsius == null) return <Missing />;
  return <span className="num font-medium" style={{ color: warmth(celsius) }}>{formatNumber(celsius, 0)} °C</span>;
}

function Clock({ mhz, sub }: { mhz: number | null | undefined; sub?: string }) {
  if (mhz == null) return <Missing />;
  return <div><span className="num font-medium">{formatNumber(mhz, 0)} MHz</span>{sub && <Sub>{sub}</Sub>}</div>;
}

function Power({ watts, limit }: { watts: number | null | undefined; limit?: number | null }) {
  if (watts == null) return <Missing />;
  return (
    <div>
      <span className="num font-medium">{formatNumber(watts, watts % 1 === 0 ? 0 : 1)} W</span>
      {limit != null && <Sub>of {formatNumber(limit, 0)} W limit</Sub>}
    </div>
  );
}

function Memory({ used, total, percent, hue }: { used: string | null; total: string | null; percent: number | null | undefined; hue: Hue }) {
  if (used === null) return <Missing />;
  return (
    <div className="min-w-[140px]">
      <span className="num font-medium">{used}</span>
      {total && <span className="text-faint"> / {total}</span>}
      {percent != null && <div className="mt-1"><UsageBar percent={percent} hue={hue} compact hideValue /></div>}
    </div>
  );
}

function Name({ icon: Icon, hue, name, sub }: { icon: typeof Cpu; hue: Hue; name: string; sub?: string }) {
  return (
    <div className="flex min-w-[170px] items-center gap-2.5" style={hueStyle(hue)}>
      <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--h)' }} aria-hidden="true" />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        {sub && <Sub>{sub}</Sub>}
      </div>
    </div>
  );
}

function CpuRow({ cpu, info }: { cpu: CpuDetail | null; info: SystemIdentification | null }) {
  const threads = info ? `${info.physicalCores ?? '—'} cores · ${info.logicalProcessors} threads` : undefined;
  return (
    <Tr>
      <Td><Name icon={Cpu} hue="cpu" name={info?.cpuModel ?? 'Processor'} sub={threads} /></Td>
      <Td><Usage percent={cpu?.totalUsagePercent} hue="cpu" pending={cpu !== null} /></Td>
      <Td><Temperature celsius={cpu?.packageTemperatureC} /></Td>
      <Td><Clock mhz={cpu?.averageClockMhz} sub={cpu?.highestClockMhz != null ? `highest ${formatNumber(cpu.highestClockMhz, 0)} MHz` : undefined} /></Td>
      <Td><Power watts={cpu?.powerWatts} /></Td>
      <Td className="text-faint">—</Td>
      <Td className="text-faint">—</Td>
    </Tr>
  );
}

function GpuRow({ adapter, reading }: { adapter: GpuAdapter; reading: GpuLiveReading | undefined }) {
  const total = reading?.memoryTotalBytes ?? adapter.dedicatedMemoryBytes;
  const used = reading?.memoryUsedBytes;
  const kind = adapter.integrated === null ? undefined : adapter.integrated ? 'Integrated' : 'Discrete';
  const fan = reading?.fanPercent != null ? `${reading.fanPercent}%` : reading?.fanRpm != null ? `${reading.fanRpm} RPM` : null;

  return (
    <Tr>
      <Td><Name icon={Gpu} hue="gpu" name={adapter.name} sub={kind} /></Td>
      <Td><Usage percent={reading?.utilizationPercent} hue="gpu" pending={reading !== undefined} /></Td>
      <Td><Temperature celsius={reading?.temperatureC} /></Td>
      <Td><Clock mhz={reading?.coreClockMhz} sub={reading?.memoryClockMhz != null ? `memory ${formatNumber(reading.memoryClockMhz, 0)} MHz` : undefined} /></Td>
      <Td><Power watts={reading?.powerWatts} limit={reading?.powerLimitWatts} /></Td>
      <Td><Memory used={used != null ? formatMemory(used) : null} total={total ? formatMemory(total) : null} percent={reading?.memoryUsagePercent} hue="gpu" /></Td>
      <Td>{fan ?? <Missing />}</Td>
    </Tr>
  );
}

function RamRow({ ram }: { ram: RamInfo | null }) {
  return (
    <Tr>
      <Td><Name icon={MemoryStick} hue="ram" name="System memory" sub="RAM" /></Td>
      <Td><Usage percent={ram?.usedPercent} hue="ram" /></Td>
      <Td><Missing /></Td>
      <Td><Missing /></Td>
      <Td><Missing /></Td>
      <Td><Memory used={ram ? formatMB(ram.usedMB, 1) : null} total={ram ? formatMB(ram.totalMB, 1) : null} percent={ram?.usedPercent} hue="ram" /></Td>
      <Td><Missing /></Td>
    </Tr>
  );
}

interface OverlayTableProps {
  cpu: CpuDetail | null;
  info: SystemIdentification | null;
  adapters: GpuAdapter[];
  readings: Map<string, GpuLiveReading>;
  ram: RamInfo | null;
}

/** Everything that matters while a game or heavy job runs, on one screen: CPU on top, every GPU below. */
function OverlayTable({ cpu, info, adapters, readings, ram }: OverlayTableProps) {
  return (
    <Panel title="Right now" icon={Table2} hue="overlay" noPad>
      <div className="overflow-x-auto">
        <table className="table-flush w-full">
          <thead>
            <tr>
              <Th>Component</Th>
              <Th>Usage</Th>
              <Th>Temp</Th>
              <Th>Clock</Th>
              <Th>Power</Th>
              <Th>Memory used</Th>
              <Th>Fan</Th>
            </tr>
          </thead>
          <tbody>
            <CpuRow cpu={cpu} info={info} />
            {adapters.map((adapter) => <GpuRow key={adapter.id} adapter={adapter} reading={readings.get(adapter.id)} />)}
            <RamRow ram={ram} />
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default memo(OverlayTable);
