import type { GpuInfo, SystemIdentification, SystemSnapshot } from '../../types/system';
import Panel from '../common/Panel';
import { InfoRow, StatTile, TileGrid, Unavailable, ViewContainer } from '../common/Primitives';
import { LoadingState } from '../common/States';

interface SystemViewProps {
  info: SystemIdentification | null;
  infoError: string | null;
  onRetryInfo: () => void;
  data: SystemSnapshot | null;
  gpus: GpuInfo[] | null;
  gpuError: string | null;
}

/*
  System identification. This is reference information the user reads once,
  not something they monitor — so it's a compact two-column label/value
  layout rather than a grid of large cards. "Operating System: Windows 11"
  does not need a quarter of the screen.
*/

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return 'Unavailable';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return 'Unavailable';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

function GpuCard({ gpu, index }: { gpu: GpuInfo; index: number }) {
  return (
    <Panel title={gpu.name ?? `GPU ${index + 1}`} meta={gpu.status ?? undefined}>
      <InfoRow
        label="Processor"
        value={gpu.videoProcessor ?? <Unavailable />}
      />
      <InfoRow
        label="Adapter memory"
        value={gpu.adapterMemoryBytes !== null ? formatBytes(gpu.adapterMemoryBytes) : <Unavailable />}
      />
      <InfoRow
        label="Driver"
        value={gpu.driverVersion ?? <Unavailable />}
        hint={gpu.driverDate ?? undefined}
      />
      <InfoRow
        label="Display"
        value={
          gpu.resolutionWidth && gpu.resolutionHeight ? (
            `${gpu.resolutionWidth} × ${gpu.resolutionHeight}${gpu.refreshRateHz ? ` @ ${gpu.refreshRateHz}Hz` : ''}`
          ) : (
            <Unavailable />
          )
        }
      />
      {/*
        Active engines are listed individually (spec §12) rather than
        summed into one "GPU usage" number — different engines (3D, Copy,
        VideoDecode) aren't comparable that way.
      */}
      {gpu.engineUsage && gpu.engineUsage.length > 0 ? (
        <div className="pt-2">
          <div className="mb-1 text-[12px] text-[var(--text-muted)]">Active engines</div>
          {gpu.engineUsage.slice(0, 5).map((e) => (
            <InfoRow key={e.instanceName} label={simplifyEngineName(e.instanceName)} value={`${e.usagePercent}%`} />
          ))}
        </div>
      ) : (
        <InfoRow label="Engine utilization" value="No engines currently active" />
      )}
    </Panel>
  );
}

// GPU Engine instance names look like
// "pid_1234_luid_0x...._phys_0_eng_0_engtype_3D" — pull out just the
// trailing engine type (3D, Copy, VideoDecode, ...) for display.
function simplifyEngineName(instanceName: string): string {
  const match = instanceName.match(/engtype_(\w+)/i);
  return match ? match[1] : instanceName;
}

export default function SystemView({ info, infoError, onRetryInfo, data, gpus, gpuError }: SystemViewProps) {
  if (infoError) {
    return (
      <ViewContainer>
        <Panel title="System">
          <p className="text-[13px] text-[var(--text-muted)]">
            System identification is unavailable — {infoError}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-faint)]">
            Live monitoring is unaffected; only this reference page needs the
            <span className="tabular"> /api/system/info </span> endpoint.
          </p>
          <button
            type="button"
            onClick={onRetryInfo}
            className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-hover)]"
          >
            Retry
          </button>
        </Panel>
      </ViewContainer>
    );
  }

  if (!info) {
    return (
      <ViewContainer>
        <Panel title="System">
          <LoadingState label="Collecting hardware information…" />
        </Panel>
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <TileGrid cols={4}>
        <StatTile
          label="Logical processors"
          value={String(info.logicalProcessors)}
          detail={info.physicalCores !== null ? `${info.physicalCores} physical cores` : 'Physical core count unavailable'}
        />
        <StatTile
          label="Memory"
          value={data ? (data.ram.totalMB / 1024).toFixed(1) : '—'}
          unit={data ? 'GB' : undefined}
          detail={data ? `${(data.ram.availableMB / 1024).toFixed(1)} GB available` : undefined}
        />
        <StatTile label="Architecture" value={info.osArchitecture} detail={`Process: ${info.processArchitecture}`} />
        <StatTile label="Uptime" value={formatUptime(info.uptimeSeconds)} detail="Since last boot" />
      </TileGrid>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="System identity">
          <InfoRow label="Computer name" value={info.machineName} />
          <InfoRow label="Manufacturer" value={info.manufacturer ?? <Unavailable />} />
          <InfoRow label="Model" value={info.model ?? <Unavailable />} />
          <InfoRow label="BIOS version" value={info.biosVersion ?? <Unavailable />} />
          <InfoRow label="Windows edition" value={info.windowsEdition ?? info.osDescription} />
          <InfoRow label="Windows build" value={info.windowsBuild ?? <Unavailable />} />
          <InfoRow label="Uptime" value={formatUptime(info.uptimeSeconds)} />
        </Panel>

        <Panel title="Processor & memory">
          <InfoRow
            label="CPU"
            value={info.cpuModel ?? <Unavailable />}
          />
          <InfoRow
            label="Physical cores"
            value={info.physicalCores !== null ? String(info.physicalCores) : <Unavailable />}
          />
          <InfoRow label="Logical processors" value={String(info.logicalProcessors)} />
          <InfoRow
            label="Current utilization"
            value={data ? `${data.cpu.usedPercent}%` : <Unavailable />}
          />
          <InfoRow
            label="Total memory"
            value={data ? `${(data.ram.totalMB / 1024).toFixed(2)} GB` : '—'}
          />
          <InfoRow
            label="Available memory"
            value={data ? `${(data.ram.availableMB / 1024).toFixed(2)} GB` : '—'}
          />
        </Panel>
      </div>

      {/*
        GPU (spec §11-§14, §25). A laptop can report more than one adapter
        (integrated + discrete), so this always renders as a list rather than
        assuming a single card. Failing to read GPU info never blocks the
        rest of the System page (spec §23) — it's its own scoped panel.
      */}
      {gpuError ? (
        <Panel title="GPU">
          <p className="text-[13px] text-[var(--text-muted)]">
            GPU information is unavailable — {gpuError}
          </p>
        </Panel>
      ) : gpus === null ? (
        <Panel title="GPU">
          <LoadingState label="Detecting display adapters…" />
        </Panel>
      ) : gpus.length === 0 ? (
        <Panel title="GPU">
          <p className="text-[13px] text-[var(--text-faint)]">
            No display adapter reported by this system.
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {gpus.map((gpu, i) => (
            <GpuCard key={`${gpu.name ?? 'gpu'}-${i}`} gpu={gpu} index={i} />
          ))}
        </div>
      )}

      <Panel title="Application">
        <InfoRow label="System Info version" value={info.appVersion} />
        <InfoRow
          label="Historical storage"
          value="Local JSON Lines"
          hint="no external database"
        />
        <InfoRow
          label="Drives detected"
          value={data ? String(data.disks.length) : '—'}
        />
        <InfoRow
          label="Network interfaces"
          value={data ? String(data.network.length) : '—'}
        />
      </Panel>
    </ViewContainer>
  );
}