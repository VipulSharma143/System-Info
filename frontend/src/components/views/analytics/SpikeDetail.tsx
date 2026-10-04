import type { ProcessSnapshot } from '../../../hooks/useProcessHistory';
import { Th, Td, Tr } from '../../common/Table';
import { EmptyState } from '../../common/States';

interface SpikeDetailProps {
  snapshot: ProcessSnapshot | null;
  spikeTime: string;
}

export default function SpikeDetail({ snapshot, spikeTime }: SpikeDetailProps) {
  if (!snapshot) {
    return (
      <div className="rounded-[var(--r-md)] border border-dashed border-line-strong p-3">
        <EmptyState hue="analytics" title="No process snapshot near this time" description="History builds up while the app runs." />
      </div>
    );
  }

  const diffSec = Math.round(Math.abs(snapshot.timestamp - new Date(spikeTime).getTime()) / 1000);

  return (
    <div className="rounded-[var(--r-md)] bg-surface-2 p-4">
      <p className="mb-2 text-[12px] text-faint">
        Closest sample: {diffSec === 0 ? 'same second' : `~${diffSec}s away`} · CPU was{' '}
        {snapshot.cpuPercent.toFixed(1)}% · sorted by memory — per-process CPU% isn't exposed by the
        backend yet, so this shows what was running, not a confirmed cause
      </p>
      <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <Th className="w-16">PID</Th>
            <Th>Process</Th>
            <Th className="text-right">Memory</Th>
          </tr>
        </thead>
        <tbody>
          {snapshot.processes.map((p) => (
            <Tr key={p.pid}>
              <Td className="num text-muted">{p.pid}</Td>
              <Td className="font-medium">{p.name}</Td>
              <Td className="num text-right text-muted">{p.memoryMB} MB</Td>
            </Tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
