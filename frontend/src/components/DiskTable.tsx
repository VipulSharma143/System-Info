import type { DiskInfo } from '../types/system';
import UsageBar from './UsageBar';

interface DiskTableProps {
  disks: DiskInfo[];
}

export default function DiskTable({ disks }: DiskTableProps) {
  if (disks.length === 0) return null;

  return (
    <div className="panel">
      <h2 className="panel__title">Disk</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Mount</th>
            <th>Type</th>
            <th>Used</th>
            <th>Total</th>
            <th>Usage</th>
          </tr>
        </thead>
        <tbody>
          {disks.map((d) => (
            <tr key={d.name}>
              <td>{d.name}</td>
              <td>{d.driveType}</td>
              <td>{d.usedGB} GB</td>
              <td>{d.totalGB} GB</td>
              <td>
                <UsageBar percent={d.usedPercent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
