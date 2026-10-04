import { memo } from 'react';
import { Cpu, Laptop, Package } from 'lucide-react';
import type { SystemIdentification, SystemSnapshot } from '../../../types/system';
import { formatUptime } from '../../../lib/format';
import Panel from '../../common/Panel';
import { InfoRow, StatTile, TileGrid, Unavailable } from '../../common/Primitives';

export const SystemTiles = memo(function SystemTiles({ info, ram }: { info: SystemIdentification; ram: SystemSnapshot['ram'] }) {
  return (
    <TileGrid cols={4}>
      <StatTile hue="cpu" label="Logical processors" value={String(info.logicalProcessors)} detail={info.physicalCores !== null ? `${info.physicalCores} physical cores` : 'Physical core count unavailable'} />
      <StatTile hue="ram" label="Memory" value={(ram.totalMB / 1024).toFixed(1)} unit="GB" detail={`${(ram.availableMB / 1024).toFixed(1)} GB available`} />
      <StatTile hue="sys" label="Architecture" value={info.osArchitecture} detail={`Process: ${info.processArchitecture}`} />
      <StatTile hue="sys" label="Uptime" value={formatUptime(info.uptimeSeconds)} detail="Since last boot" />
    </TileGrid>
  );
});

export const IdentityPanels = memo(function IdentityPanels({ info, ram, cpuPercent }: { info: SystemIdentification; ram: SystemSnapshot['ram']; cpuPercent: number }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
      <Panel title="This computer" icon={Laptop} hue="sys">
        <InfoRow label="Computer name" value={info.machineName} />
        <InfoRow label="Manufacturer" value={info.manufacturer ?? <Unavailable />} />
        <InfoRow label="Model" value={info.model ?? <Unavailable />} />
        <InfoRow label="BIOS version" value={info.biosVersion ?? <Unavailable />} />
        <InfoRow label="Operating system" value={info.windowsEdition ?? info.osDescription} />
        <InfoRow label="Build" value={info.windowsBuild ?? <Unavailable />} />
        <InfoRow label="Uptime" value={formatUptime(info.uptimeSeconds)} />
      </Panel>

      <Panel title="Processor and memory" icon={Cpu} hue="cpu">
        <InfoRow label="CPU" value={info.cpuModel ?? <Unavailable />} />
        <InfoRow label="Physical cores" value={info.physicalCores !== null ? String(info.physicalCores) : <Unavailable />} />
        <InfoRow label="Logical processors" value={String(info.logicalProcessors)} />
        <InfoRow label="Current utilization" value={`${cpuPercent.toFixed(1)}%`} />
        <InfoRow label="Total memory" value={`${(ram.totalMB / 1024).toFixed(2)} GB`} />
        <InfoRow label="Available memory" value={`${(ram.availableMB / 1024).toFixed(2)} GB`} />
      </Panel>
    </div>
  );
});

export const ApplicationPanel = memo(function ApplicationPanel({ info, drives, interfaces }: { info: SystemIdentification; drives: number; interfaces: number }) {
  return (
    <Panel title="This app" icon={Package} hue="sys">
      <InfoRow label="System Info version" value={info.appVersion} />
      <InfoRow label="History storage" value="Local JSON Lines" hint="no external database" />
      <InfoRow label="Drives detected" value={drives} />
      <InfoRow label="Network interfaces" value={interfaces} />
    </Panel>
  );
});
