import type { DiskInfo } from '../../types/system';
import Panel from '../common/Panel';
import UsageBar from '../common/UsageBar';
import { Badge, StatTile, TileGrid, ViewContainer } from '../common/Primitives';
import { Th, Td, Tr } from '../common/Table';

interface StorageViewProps {
  disks: DiskInfo[];
}

/*
  Storage used to get one large panel per drive, most of it empty. Now each
  drive is a compact row: name, usage bar, and the two numbers that matter
  (free / total). With more than four drives the layout switches to a table
  automatically, so a machine with many mounts doesn't produce a page of
  near-identical cards.
*/

const TABLE_THRESHOLD = 4;

function toneFor(percent: number): 'ok' | 'warn' | 'critical' {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warn';
  return 'ok';
}

function wordFor(percent: number): string {
  if (percent >= 90) return 'Critical';
  if (percent >= 70) return 'Low space';
  return 'Healthy';
}

export default function StorageView({ disks }: StorageViewProps) {
  if (disks.length === 0) {
    return (
      <ViewContainer>
        <Panel title="Storage">
          <p className="text-[13px] text-[var(--text-faint)]">
            No drives reported by the system.
          </p>
        </Panel>
      </ViewContainer>
    );
  }

  const totalGB = disks.reduce((s, d) => s + d.totalGB, 0);
  const freeGB = disks.reduce((s, d) => s + d.freeGB, 0);
  const usedGB = disks.reduce((s, d) => s + d.usedGB, 0);
  const overallPercent = totalGB > 0 ? (usedGB / totalGB) * 100 : 0;
  const fullest = disks.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));

  return (
    <ViewContainer>
      <TileGrid cols={4}>
        <StatTile
          label="Total capacity"
          value={totalGB.toFixed(0)}
          unit="GB"
          detail={`${disks.length} drive${disks.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Used"
          value={usedGB.toFixed(0)}
          unit="GB"
          detail={`${overallPercent.toFixed(1)}% of total`}
          percentForColor={overallPercent}
        />
        <StatTile label="Free" value={freeGB.toFixed(0)} unit="GB" />
        <StatTile
          label="Fullest drive"
          value={fullest.usedPercent.toFixed(0)}
          unit="%"
          detail={fullest.name}
          percentForColor={fullest.usedPercent}
        />
      </TileGrid>

      {disks.length <= TABLE_THRESHOLD ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {disks.map((d) => (
            <Panel
              key={d.name}
              title={d.name}
              meta={d.volumeLabel || d.driveType}
              action={<Badge tone={toneFor(d.usedPercent)}>{wordFor(d.usedPercent)}</Badge>}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="tabular text-[22px] font-medium leading-none text-[var(--text)]">
                  {d.usedPercent.toFixed(0)}
                  <span className="ml-0.5 text-[13px] text-[var(--text-muted)]">%</span>
                </span>
                <span className="tabular text-[12px] text-[var(--text-muted)]">
                  {d.usedGB.toFixed(0)} GB used of {d.totalGB.toFixed(0)} GB
                </span>
              </div>
              <div className="mt-2">
                <UsageBar percent={d.usedPercent} />
              </div>
              <div className="mt-2 flex justify-between text-[12px] text-[var(--text-faint)]">
                <span>{d.freeGB.toFixed(1)} GB free</span>
                <span>{d.driveType}</span>
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel title="Drives" meta={`${disks.length} total`} noPad>
          <div className="overflow-x-auto">
            <table className="table-flush w-full">
              <thead>
                <tr>
                  <Th>Drive</Th>
                  <Th>Type</Th>
                  <Th className="w-[30%]">Usage</Th>
                  <Th className="text-right">Used</Th>
                  <Th className="text-right">Free</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {disks.map((d) => (
                  <Tr key={d.name}>
                    <Td className="font-medium">
                      {d.name}
                      {d.volumeLabel && (
                        <span className="ml-1.5 text-[12px] text-[var(--text-faint)]">
                          {d.volumeLabel}
                        </span>
                      )}
                    </Td>
                    <Td className="text-[var(--text-muted)]">{d.driveType}</Td>
                    <Td>
                      <UsageBar percent={d.usedPercent} compact />
                    </Td>
                    <Td className="tabular text-right">{d.usedGB.toFixed(0)} GB</Td>
                    <Td className="tabular text-right">{d.freeGB.toFixed(0)} GB</Td>
                    <Td className="tabular text-right">{d.totalGB.toFixed(0)} GB</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </ViewContainer>
  );
}
