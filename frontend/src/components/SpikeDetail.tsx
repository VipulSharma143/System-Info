import type { ProcessSnapshot } from '../hooks/useProcessHistory';
import { Th, Td, Tr } from './common/Table';
import { EmptyState } from './common/States';

interface SpikeDetailProps {
  snapshot: ProcessSnapshot | null;
  spikeTime: string;
}

export default function SpikeDetail({ snapshot, spikeTime }: SpikeDetailProps) {
  if (!snapshot) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-raised)] p-3">
        <EmptyState title="No process snapshot captured near this time yet" description="History builds up while the app runs." />
      </div>
    );
  }

  const diffSec = Math.round(Math.abs(snapshot.timestamp - new Date(spikeTime).getTime()) / 1000);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
      <p className="mb-2 text-[12px] text-[var(--text-faint)]">
        Closest sample: {diffSec === 0 ? 'same second' : `~${diffSec}s away`} · CPU was{' '}
        {snapshot.cpuPercent.toFixed(1)}% · sorted by memory — per-process CPU% isn't exposed by the
        backend yet, so this shows what was running, not a confirmed cause
      </p>
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
              <Td className="tabular text-[var(--text-muted)]">{p.pid}</Td>
              <Td className="font-medium">{p.name}</Td>
              <Td className="tabular text-right text-[var(--text-muted)]">{p.memoryMB} MB</Td>
            </Tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
