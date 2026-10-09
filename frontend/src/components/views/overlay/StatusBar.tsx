import { memo } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { OverlaySnapshot } from '../../../types/overlay';
import { Badge } from '../../common/Primitives';
import { engineLabel, liveState, sourceProblems, type LiveState } from './model';

const STATE: Record<LiveState, { tone: 'ok' | 'warn' | 'critical'; word: string }> = {
  live: { tone: 'ok', word: 'Live' },
  lagging: { tone: 'warn', word: 'Slow' },
  stalled: { tone: 'critical', word: 'Stopped' },
};

interface Props {
  snapshot: OverlaySnapshot;
  now: number;
  compact: boolean;
  onCompact: (v: boolean) => void;
}

function StatusBar({ snapshot, now, compact, onCompact }: Props) {
  const state = liveState(snapshot, now);
  const age = Math.max(0, (now - snapshot.sampledAtMs) / 1000);
  const problems = sourceProblems(snapshot);
  const { tone, word } = STATE[state];

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Badge tone={tone}>{word}</Badge>
        <span className="text-[12px] text-muted">
          {state === 'live' ? `Updated ${age.toFixed(1)} s ago` : `No new sample for ${Math.round(age)} s`}
        </span>
        <span className="text-[12px] text-faint" title="Which processor path the engine uses for its statistics, and how long one sample takes">
          Engine {engineLabel(snapshot.engine.isa)} · {snapshot.engine.cycleMs.toFixed(1)} ms per sample
        </span>
      </div>
      <button type="button" onClick={() => onCompact(!compact)} aria-pressed={compact}
        className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-muted hover:text-ink">
        {compact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        {compact ? 'Full view' : 'Compact'}
      </button>
      {problems.length > 0 && (
        <ul className="basis-full space-y-1 text-[12px] text-warn">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}

export default memo(StatusBar);
