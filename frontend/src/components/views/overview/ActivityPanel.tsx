import { memo } from 'react';
import { Activity } from 'lucide-react';
import Legend from '../../common/Legend';
import Panel from '../../common/Panel';
import Sparkline from '../../common/Sparkline';

/** CPU and memory drawn on one shared 0–100% axis, so they can be compared at a glance. */
function ActivityPanel({ cpu, ram }: { cpu: number[]; ram: number[] }) {
  return (
    <Panel
      title="System activity"
      icon={Activity}
      hue="overview"
      meta="last ~80 seconds"
      action={<Legend items={[{ label: 'Processor', color: 'var(--hue-cpu)' }, { label: 'Memory', color: 'var(--hue-ram)' }]} />}
    >
      <div className="relative h-28">
        {[0, 50, 100].map((tick) => (
          <div key={tick} className="absolute inset-x-0 flex items-center gap-2 text-[10px] text-faint" style={{ top: `${100 - tick}%`, transform: 'translateY(-50%)' }}>
            <span className="w-7 shrink-0 text-right">{tick}%</span>
            <span className="flex-1 border-t border-dashed border-line" />
          </div>
        ))}
        <div className="absolute inset-y-0 left-9 right-0">
          <div className="absolute inset-0"><Sparkline points={ram} color="var(--hue-ram)" height={112} /></div>
          <div className="absolute inset-0"><Sparkline points={cpu} color="var(--hue-cpu)" height={112} dot /></div>
        </div>
      </div>
    </Panel>
  );
}

export default memo(ActivityPanel);
