import type { SystemSnapshot } from '../../types/system';
import { useMetricHistory } from '../../hooks/useMetricHistory';
import MetricCard from '../common/MetricCard';
import DiskTable from '../DiskTable';
import NetworkTable from '../NetworkTable';
import ProcessTable from '../ProcessTable';

interface OverviewViewProps {
  data: SystemSnapshot;
}

export default function OverviewView({ data }: OverviewViewProps) {
  const cpuHistory = useMetricHistory(data.cpu.usedPercent);
  const ramHistory = useMetricHistory(data.ram.usedPercent);

  const totalRx = data.network.reduce((sum, n) => sum + n.rxKBps, 0);
  const totalTx = data.network.reduce((sum, n) => sum + n.txKBps, 0);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap gap-3">
        <MetricCard
          label="CPU"
          value={data.cpu.usedPercent.toFixed(1)}
          unit="%"
          percentForColor={data.cpu.usedPercent}
          history={cpuHistory}
        />
        <MetricCard
          label="Memory"
          value={data.ram.usedPercent.toFixed(1)}
          unit="%"
          percentForColor={data.ram.usedPercent}
          history={ramHistory}
          detail={`${data.ram.usedMB.toLocaleString()} / ${data.ram.totalMB.toLocaleString()} MB`}
        />
        <MetricCard
          label="Memory free"
          value={data.ram.availableMB.toLocaleString()}
          unit="MB"
        />
        <MetricCard
          label="Network"
          value={totalRx.toFixed(0)}
          unit="KB/s down"
          detail={`${totalTx.toFixed(0)} KB/s up`}
        />
        <MetricCard label="Processes" value={String(data.processes.length)} unit="running" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DiskTable disks={data.disks} />
        <NetworkTable network={data.network} />
      </div>

      <ProcessTable processes={data.processes} limit={8} showSearch={false} />
    </div>
  );
}
