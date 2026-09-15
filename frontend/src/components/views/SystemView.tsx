import type { SystemIdentification, SystemSnapshot } from '../../types/system';
import Panel from '../common/Panel';
import { InfoRow, StatTile, TileGrid, ViewContainer } from '../common/Primitives';
import { LoadingState } from '../common/States';

interface SystemViewProps {
  info: SystemIdentification | null;
  infoError: string | null;
  data: SystemSnapshot | null;
}

/*
  System identification. This is reference information the user reads once,
  not something they monitor — so it's a compact two-column label/value
  layout rather than a grid of large cards. "Operating System: Windows 11"
  does not need a quarter of the screen.
*/

export default function SystemView({ info, infoError, data }: SystemViewProps) {
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
        </Panel>
      </ViewContainer>
    );
  }

  if (!info) {
    return (
      <ViewContainer>
        <Panel title="System">
          <LoadingState label="Reading system information" />
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
          detail={info.coreCount !== null ? `${info.coreCount} physical cores` : 'Core count unavailable'}
        />
        <StatTile
          label="Memory"
          value={data ? (data.ram.totalMB / 1024).toFixed(1) : '—'}
          unit={data ? 'GB' : undefined}
          detail={data ? `${(data.ram.availableMB / 1024).toFixed(1)} GB available` : undefined}
        />
        <StatTile label="Architecture" value={info.osArchitecture} detail={`Process: ${info.processArchitecture}`} />
        <StatTile label="App version" value={info.appVersion} detail="System Info" />
      </TileGrid>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Operating system">
          <InfoRow label="OS" value={info.osDescription} />
          <InfoRow label="Machine name" value={info.machineName} />
          <InfoRow label="OS architecture" value={info.osArchitecture} />
          <InfoRow label="Process architecture" value={info.processArchitecture} />
          <InfoRow label="Runtime" value={info.frameworkDescription} />
        </Panel>

        <Panel title="Processor & memory">
          <InfoRow
            label="CPU"
            value={
              info.cpuModel ?? (
                <span className="text-[var(--text-faint)]">Unavailable</span>
              )
            }
          />
          <InfoRow
            label="Physical cores"
            value={
              info.coreCount !== null ? (
                String(info.coreCount)
              ) : (
                <span className="text-[var(--text-faint)]">Unavailable</span>
              )
            }
          />
          <InfoRow label="Logical processors" value={String(info.logicalProcessors)} />
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
