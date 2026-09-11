import type { NetworkInfo } from '../../types/system';
import NetworkTable from '../NetworkTable';
import SpeedTestCard from '../SpeedTestCard';

interface NetworkViewProps {
  network: NetworkInfo[];
}

export default function NetworkView({ network }: NetworkViewProps) {
  return (
    <div className="space-y-4 p-5">
      <NetworkTable network={network} />
      <SpeedTestCard />
    </div>
  );
}
