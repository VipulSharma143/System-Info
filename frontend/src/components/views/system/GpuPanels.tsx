import { memo } from 'react';
import { MonitorPlay } from 'lucide-react';
import type { GpuInfo } from '../../../types/system';
import { ALERT_COPY } from '../../../lib/errors';
import { formatBytes } from '../../../lib/format';
import { EmptyState, LoadingState } from '../../common/States';
import Panel from '../../common/Panel';
import { InfoRow, Unavailable } from '../../common/Primitives';

// GPU engine instance names look like "pid_1234_luid_0x…_phys_0_eng_0_engtype_3D": show only the engine type.
const engineName = (instance: string) => /engtype_(\w+)/i.exec(instance)?.[1] ?? instance;

const GpuCard = memo(function GpuCard({ gpu, index }: { gpu: GpuInfo; index: number }) {
  const resolution =
    gpu.resolutionWidth && gpu.resolutionHeight
      ? `${gpu.resolutionWidth} × ${gpu.resolutionHeight}${gpu.refreshRateHz ? ` @ ${gpu.refreshRateHz}Hz` : ''}`
      : null;

  return (
    <Panel title={gpu.name ?? `GPU ${index + 1}`} icon={MonitorPlay} hue="sys" meta={gpu.status ?? undefined}>
      <InfoRow label="Processor" value={gpu.videoProcessor ?? <Unavailable />} />
      <InfoRow label="Adapter memory" value={gpu.adapterMemoryBytes !== null ? formatBytes(gpu.adapterMemoryBytes, 1) : <Unavailable />} />
      <InfoRow label="Driver" value={gpu.driverVersion ?? <Unavailable />} hint={gpu.driverDate ?? undefined} />
      <InfoRow label="Display" value={resolution ?? <Unavailable />} />
      {/* Engines are listed individually: 3D, Copy and VideoDecode are not comparable, so they are never summed. */}
      {gpu.engineUsage && gpu.engineUsage.length > 0 ? (
        <div className="pt-2">
          <div className="mb-0.5 text-[12px] font-medium text-muted">Active engines</div>
          {gpu.engineUsage.slice(0, 5).map((e) => (
            <InfoRow key={e.instanceName} label={engineName(e.instanceName)} value={`${e.usagePercent}%`} />
          ))}
        </div>
      ) : (
        <InfoRow label="Engine utilization" value="No engines currently active" />
      )}
    </Panel>
  );
});

interface Props {
  gpus: GpuInfo[] | null;
  error: string | null;
}

/** Scoped to its own panel: failing to read GPU info never blocks the rest of the System page. */
function GpuPanels({ gpus, error }: Props) {
  if (error) {
    return (
      <Panel title="Graphics" icon={MonitorPlay} hue="sys">
        <p className="text-[13px] font-medium text-ink">{ALERT_COPY.gpu.title}</p>
        <p className="mt-1 text-[13px] text-muted">{error}</p>
      </Panel>
    );
  }
  if (gpus === null) {
    return (
      <Panel title="Graphics" icon={MonitorPlay} hue="sys">
        <LoadingState label="Detecting display adapters…" />
      </Panel>
    );
  }
  if (gpus.length === 0) {
    return (
      <Panel title="Graphics" icon={MonitorPlay} hue="sys">
        <EmptyState icon={MonitorPlay} hue="sys" title="No display adapter reported" description="This system did not list a graphics adapter." />
      </Panel>
    );
  }
  // A laptop can report several adapters (integrated + discrete), so this is always a list.
  return (
    <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
      {gpus.map((gpu, i) => (
        <GpuCard key={`${gpu.name ?? 'gpu'}-${i}`} gpu={gpu} index={i} />
      ))}
    </div>
  );
}

export default memo(GpuPanels);
