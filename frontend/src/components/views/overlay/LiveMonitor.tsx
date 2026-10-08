import { memo, useEffect, useState, type ReactNode } from 'react';

import { formatMemory, formatNumber } from '../../../lib/format';
import { hueStyle, usageColor, type Hue } from '../../../lib/hues';

import Sparkline from '../../common/Sparkline';

import { gpuLabel, hotness, orderGpus, type CpuView, type GpuView, type MemoryView } from './model';
import { Meter } from './parts';
import { useSampleHistory } from './useSampleHistory';

/*
  The top of the Overlay: one row per component so CPU, every GPU and RAM can be compared at a glance.
  Values are always on screen (no tooltips needed). A value the platform did not report reads "Unavailable";
  0 is only ever shown when the platform measured 0.
*/

const COLUMNS = 'sm:grid-cols-[minmax(150px,1.1fr)_minmax(200px,1.7fr)_minmax(90px,0.6fr)_minmax(140px,1.2fr)]';

const Unavailable = ({ why }: { why?: string | null }) => <span className="text-[13px] font-normal text-faint" title={why ?? undefined}>Unavailable</span>;

interface RowProps {
  label: string;
  name: string | null;
  hue: Hue;
  usage: number | null;
  /** True until the first sample of this row's source has arrived. */
  pending: boolean;
  tick: number | undefined;
  /** "value" shows `temperature`; "unavailable" the platform has no reading; "na" the component has no temperature. */
  temperature: number | null;
  temperatureKind: 'value' | 'na';
  memory: ReactNode;
  memoryDetail?: ReactNode;
  usageHint?: string | null;
  via?: string | null;
}

const MonitorRow = memo(function MonitorRow({ label, name, hue, usage, pending, tick, temperature, temperatureKind, memory, memoryDetail, usageHint, via }: RowProps) {
  const history = useSampleHistory(usage, tick);
  return (
    <div role="row" className={`grid grid-cols-2 items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3.5 ${COLUMNS}`} style={hueStyle(hue)}>
      <div role="cell" className="col-span-2 min-w-0 sm:col-span-1">
        <div className="flex items-center gap-2 text-[14px] font-semibold"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: 'var(--h)' }} aria-hidden="true" />{label}</div>
        {name && <div className="truncate pl-4 text-[11px] text-faint">{name}</div>}
      </div>

      <div role="cell" className="col-span-2 min-w-0 sm:col-span-1">
        <div className="flex items-end justify-between gap-3">
          <div className="num text-[30px] font-semibold leading-none tracking-tight">
            {usage === null ? (pending ? <span className="text-[22px] text-faint">…</span> : <Unavailable why={usageHint} />) : <>{formatNumber(usage, 0)}<span className="ml-0.5 text-[15px] font-medium text-muted">%</span></>}
          </div>
          <div className="h-7 w-24 shrink-0 max-sm:w-20"><Sparkline points={history} color={usageColor(usage ?? undefined, hue)} height={28} strokeWidth={1.5} /></div>
        </div>
        <div className="mt-2"><Meter percent={usage} hue={hue} label={`${label} utilization`} /></div>
        {via && usage !== null && <div className="mt-1 text-[10px] text-faint">via {via}</div>}
      </div>

      <div role="cell" className="num min-w-0 text-[20px] font-semibold" style={{ color: hotness(temperature) }}>
        {temperatureKind === 'na' ? <span className="font-normal text-faint">—</span> : temperature === null ? (pending ? <span className="text-faint">…</span> : <Unavailable />) : <>{formatNumber(temperature, 0)}<span className="ml-0.5 text-[13px] font-medium text-muted">°C</span></>}
      </div>

      <div role="cell" className="min-w-0">
        <div className="num truncate text-[14px] font-semibold">{memory}</div>
        {memoryDetail && <div className="truncate text-[11px] text-faint">{memoryDetail}</div>}
      </div>
    </div>
  );
});

const SOURCE_NAMES: Record<string, string> = { nvml: 'NVIDIA driver', 'performance-counter': 'Windows counters', sysfs: 'kernel sysfs' };

function ageSeconds(since: number) {
  return Math.max(0, Math.round((Date.now() - since) / 1000));
}

/** Says Live, or how long ago the last sample arrived; re-renders itself, not the table. */
function LiveStamp({ sampledAt, active }: { sampledAt: number | undefined; active: boolean }) {
  const [, setNow] = useState(0);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  useEffect(() => { if (sampledAt !== undefined) setSeenAt(Date.now()); }, [sampledAt]);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow((n) => n + 1), 2000);
    return () => window.clearInterval(id);
  }, [active]);

  if (sampledAt === undefined) return <span className="text-[11px] text-faint">Waiting for first sample…</span>;
  const age = ageSeconds(seenAt);
  const stale = age > 8;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: stale ? 'var(--warn)' : 'var(--ok)' }}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {stale ? `No update for ${age}s` : 'Live'}
    </span>
  );
}

interface LiveMonitorProps {
  cpu: CpuView;
  cpuSampledAt: number | undefined;
  gpus: GpuView[];
  gpuSampledAt: number | undefined;
  gpusLoaded: boolean;
  memory: MemoryView | null;
  active: boolean;
}

function LiveMonitor({ cpu, cpuSampledAt, gpus, gpuSampledAt, gpusLoaded, memory, active }: LiveMonitorProps) {
  const ordered = orderGpus(gpus);
  return (
    <section className="panel overflow-hidden" aria-label="Live system monitor" role="table">
      <header className="flex items-center justify-between gap-3 px-5 py-3.5">
        <h2 className="num text-[13px] font-semibold uppercase tracking-wide text-ink">Live system monitor</h2>
        <LiveStamp sampledAt={cpuSampledAt} active={active} />
      </header>

      <div role="row" className={`hidden gap-x-4 px-5 pb-2 text-[11px] font-medium uppercase tracking-wide text-faint sm:grid ${COLUMNS}`}>
        <span role="columnheader">Component</span><span role="columnheader">Utilization</span><span role="columnheader">Temp</span><span role="columnheader">Memory / usage</span>
      </div>

      <MonitorRow
        label="CPU" name={null} hue="cpu" usage={cpu.usage} pending={cpu.status === 'measuring'} tick={cpuSampledAt}
        temperature={cpu.packageTemperature} temperatureKind="value"
        memory={cpu.active == null || cpu.logical == null ? <Unavailable /> : `${cpu.active} of ${cpu.logical} threads active`}
        memoryDetail={cpu.load ? `${cpu.load} load` : undefined}
      />

      {ordered.map((gpu) => (
        <MonitorRow
          key={gpu.id} label={gpuLabel(gpu, ordered.length)} name={gpu.name} hue="gpu"
          usage={gpu.usage} pending={!gpusLoaded} tick={gpuSampledAt} usageHint={gpu.note}
          temperature={gpu.temperature} temperatureKind="value"
          via={gpu.source ? SOURCE_NAMES[gpu.source] ?? gpu.source : null}
          memory={gpu.vramUsedBytes == null ? <Unavailable /> : gpu.vramTotalBytes != null ? `${formatMemory(gpu.vramUsedBytes)} / ${formatMemory(gpu.vramTotalBytes)}` : formatMemory(gpu.vramUsedBytes)}
          memoryDetail={gpu.kind === 'Integrated' ? 'shared system memory' : gpu.vramPercent != null ? `${formatNumber(gpu.vramPercent, 0)}% of video memory` : undefined}
        />
      ))}

      <MonitorRow
        label="RAM" name={null} hue="ram" usage={memory?.percent ?? null} pending={memory === null} tick={memory?.used}
        temperature={null} temperatureKind="na"
        memory={memory ? `${formatMemory(memory.used)} / ${formatMemory(memory.total)}` : <Unavailable />}
        memoryDetail={memory ? `${formatMemory(memory.available)} available` : undefined}
      />
    </section>
  );
}

export default memo(LiveMonitor);
