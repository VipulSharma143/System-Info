import type { ProcessSnapshot } from '../../hooks/useProcessHistory';
import AnalyticsPanel from '../AnalyticsPanel';

interface AnalyticsViewProps {
  findNearest: (isoTime: string) => ProcessSnapshot | null;
}

export default function AnalyticsView({ findNearest }: AnalyticsViewProps) {
  return (
    <div className="p-5">
      <AnalyticsPanel findNearest={findNearest} />
    </div>
  );
}
