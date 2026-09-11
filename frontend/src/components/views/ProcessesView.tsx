import type { ProcessInfo } from '../../types/system';
import ProcessTable from '../ProcessTable';

interface ProcessesViewProps {
  processes: ProcessInfo[];
}

export default function ProcessesView({ processes }: ProcessesViewProps) {
  return (
    <div className="p-5">
      <ProcessTable processes={processes} />
    </div>
  );
}
