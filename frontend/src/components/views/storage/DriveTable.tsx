import { memo } from 'react';
import { HardDrive } from 'lucide-react';
import type { DiskInfo } from '../../../types/system';
import { formatGB } from '../../../lib/format';
import Panel from '../../common/Panel';
import { Td, Th, Tr } from '../../common/Table';
import UsageBar from '../../common/UsageBar';

/** Used when a machine has many mounts: a table instead of a page of near-identical cards. */
function DriveTable({ disks }: { disks: DiskInfo[] }) {
  return (
    <Panel title="Drives" icon={HardDrive} hue="disk" meta={`${disks.length} total`} noPad>
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
                  {d.volumeLabel && <span className="ml-2 text-[12px] font-normal text-faint">{d.volumeLabel}</span>}
                </Td>
                <Td className="text-muted">{d.driveType}</Td>
                <Td><UsageBar percent={d.usedPercent} compact hue="disk" /></Td>
                <Td className="num text-right">{formatGB(d.usedGB)}</Td>
                <Td className="num text-right">{formatGB(d.freeGB)}</Td>
                <Td className="num text-right">{formatGB(d.totalGB)}</Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default memo(DriveTable);
