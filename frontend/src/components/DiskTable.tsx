import { HardDrive } from 'lucide-react';
import type { DiskInfo } from '../types/system';
import Panel from './common/Panel';
import { Th, Td, Tr } from './common/Table';
import { EmptyState } from './common/States';
import UsageBar from './common/UsageBar';

interface DiskTableProps {
  disks: DiskInfo[];
}

export default function DiskTable({ disks }: DiskTableProps) {
  return (
    <Panel title="Disks" meta={disks.length ? `${disks.length} volumes` : undefined} noPad>
      {disks.length === 0 ? (
        <EmptyState icon={HardDrive} title="No disk volumes reported" />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Mount</Th>
              <Th>Type</Th>
              <Th className="text-right">Used</Th>
              <Th className="text-right">Total</Th>
              <Th className="w-36">Usage</Th>
            </tr>
          </thead>
          <tbody>
            {disks.map((d) => (
              <Tr key={d.name}>
                <Td className="font-medium">{d.name}</Td>
                <Td className="text-[var(--text-muted)]">{d.driveType}</Td>
                <Td className="tabular text-right text-[var(--text-muted)]">{d.usedGB} GB</Td>
                <Td className="tabular text-right text-[var(--text-muted)]">{d.totalGB} GB</Td>
                <Td>
                  <UsageBar percent={d.usedPercent} compact />
                </Td>
              </Tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
