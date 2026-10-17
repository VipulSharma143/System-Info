import { memo, useMemo } from 'react';
import { ArrowDown, ArrowUp, Waves } from 'lucide-react';
import { formatRate } from '../../../lib/format';
import { summarise } from '../../../lib/network';
import Figure from '../../common/Figure';
import Legend from '../../common/Legend';
import Panel from '../../common/Panel';
import Sparkline from '../../common/Sparkline';
import { Badge } from '../../common/Primitives';

interface Props {
  rx: number;
  tx: number;
  rxHistory: number[];
  txHistory: number[];
  active: boolean;
}

function Reading({ icon: Icon, color, label, value, peak, average }: { icon: typeof ArrowDown; color: string; label: string; value: number; peak?: number; average?: number }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted"><Icon className="h-3.5 w-3.5" style={{ color }} />{label}</div>
      <Figure size="lg" value={formatRate(value)} />
      {peak !== undefined && average !== undefined && (
        <div className="mt-2 text-[12px] text-faint">peak {formatRate(peak)} · average {formatRate(average)}</div>
      )}
    </div>
  );
}

/** Live traffic: two headline readings with their peak and average for the visible window, and one chart on a shared scale. */
function TrafficPanel({ rx, tx, rxHistory, txHistory, active }: Props) {
  const scale = useMemo(() => (rxHistory.length > 0 ? Math.max(...rxHistory, ...txHistory) * 1.15 || 1 : 1), [rxHistory, txHistory]);
  const down = useMemo(() => summarise(rxHistory), [rxHistory]);
  const up = useMemo(() => summarise(txHistory), [txHistory]);

  return (
    <Panel variant="hero" title="Current traffic" icon={Waves} hue="net" action={<Badge tone={active ? 'ok' : 'muted'}>{active ? 'Active' : 'Idle'}</Badge>}>
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
        <Reading icon={ArrowDown} color="var(--hue-net)" label="Download" value={rx} peak={down?.peak} average={down?.average} />
        <Reading icon={ArrowUp} color="var(--hue-power)" label="Upload" value={tx} peak={up?.peak} average={up?.average} />
      </div>
      <div className="relative mt-6 h-28">
        {[1, 0.5, 0].map((f) => (
          <div key={f} className="absolute inset-x-0 flex items-center gap-2 text-[10px] text-faint" style={{ top: `${(1 - f) * 100}%`, transform: 'translateY(-50%)' }}>
            <span className="w-16 shrink-0 text-right">{formatRate(scale * f)}</span>
            <span className="flex-1 border-t border-dashed border-line" />
          </div>
        ))}
        <div className="absolute inset-y-0 left-[4.5rem] right-0">
          <div className="absolute inset-0"><Sparkline points={rxHistory} color="var(--hue-net)" max={scale} height={112} dot /></div>
          <div className="absolute inset-0"><Sparkline points={txHistory} color="var(--hue-power)" max={scale} height={112} dot /></div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Legend items={[{ label: 'Download', color: 'var(--hue-net)' }, { label: 'Upload', color: 'var(--hue-power)' }]} />
        <span className="text-[12px] text-faint">last ~80 seconds</span>
      </div>
    </Panel>
  );
}

export default memo(TrafficPanel);
