import type { ProcessSnapshot } from '../hooks/useProcessHistory';

interface SpikeDetailProps {
  snapshot: ProcessSnapshot | null;
  spikeTime: string;
}

export default function SpikeDetail({ snapshot, spikeTime }: SpikeDetailProps) {
  if (!snapshot) {
    return (
      <div className="spike-detail spike-detail--empty">
        No process snapshot captured near this time yet — history builds up while the app runs.
      </div>
    );
  }

  const diffSec = Math.round(Math.abs(snapshot.timestamp - new Date(spikeTime).getTime()) / 1000);

  return (
    <div className="spike-detail">
      <p className="spike-detail__note">
        Closest sample: {diffSec === 0 ? 'same second' : `~${diffSec}s away`} · CPU was{' '}
        {snapshot.cpuPercent.toFixed(1)}% · sorted by memory — per-process CPU% isn't exposed by the
        backend yet, so this shows what was running, not a confirmed cause
      </p>
      <table className="data-table data-table--compact">
        <thead>
          <tr>
            <th>PID</th>
            <th>Process</th>
            <th>Memory (MB)</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.processes.map((p) => (
            <tr key={p.pid}>
              <td>{p.pid}</td>
              <td>{p.name}</td>
              <td>{p.memoryMB}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
