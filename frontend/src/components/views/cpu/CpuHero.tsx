import { memo } from 'react';
import { Cpu, Thermometer } from 'lucide-react';

import type { CpuDetail } from '../../../types/cpu';
import { usageColor } from '../../../lib/hues';
import Panel from '../../common/Panel';
import Sparkline from '../../common/Sparkline';
import Figure from '../../common/Figure';
import { Badge } from '../../common/Primitives';
import Gauge from '../overlay/Gauge';
import { formatTemp, liveState, measured, sourceLabel, type LiveState } from '../overlay/model';
import { describeCoreCounts, describeHybrid } from './model';

const STATE: Record<LiveState, { tone: 'ok' | 'warn' | 'critical'; word: string }> = {
  live: { tone: 'ok', word: 'Live' },
  lagging: { tone: 'warn', word: 'Slow' },
  stalled: { tone: 'critical', word: 'Stopped' },
};

/** Headline: which processor this is, how busy it is right now and how hot, with the last minute of both. */
function CpuHero({ detail, now }: { detail: CpuDetail; now: number }) {
  const { identity, live } = detail;
  const state = detail.live ? liveState(detail, now) : null;
  const age = Math.max(0, (now - detail.sampledAtMs) / 1000);
  const usage = measured(detail.history.usage);
  const temps = measured(detail.history.temperature);
  const temp = formatTemp(live?.temperatureC ?? null);
  const counts = describeCoreCounts(detail);
  const hybrid = describeHybrid(detail);
  const meta = [identity.vendor, identity.architecture].filter(Boolean).join(' · ');

  return (
    <Panel variant="hero" hue="cpu" icon={Cpu} title={identity.model ?? 'Processor'} meta={meta || undefined}
      action={state ? <Badge tone={STATE[state].tone}>{STATE[state].word}</Badge> : <Badge tone="muted">Starting</Badge>}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
        <Gauge percent={live?.usagePercent ?? null} hue="cpu" size={148} unknown="Measuring…" />

        <div className="min-w-[200px] flex-1">
          <div className="h-[64px]"><Sparkline points={usage} color={usageColor(live?.usagePercent ?? 0, 'cpu')} height={64} /></div>
          <p className="mt-1 text-[11px] text-faint">Utilization, last minute{state === 'live' ? ` · updated ${age.toFixed(1)} s ago` : state ? ` · no new sample for ${Math.round(age)} s` : ''}</p>
        </div>

        <div className="min-w-[200px] flex-1">
          <div className="flex items-center gap-2 text-[12px] text-muted"><Thermometer className="h-3.5 w-3.5" />Temperature</div>
          <div className="mt-1.5">
            {temp ? <Figure size="lg" value={Math.round(live!.temperatureC!)} unit="°C" /> : <span className="text-[15px] text-faint">Not reported</span>}
          </div>
          {temps.length > 1 && <div className="mt-2 h-[34px]"><Sparkline points={temps} color="var(--hue-cpu)" max="auto" height={34} /></div>}
          <p className="mt-1 text-[11px] leading-snug text-faint">
            {temp ? `Read from ${sourceLabel(live?.temperatureSource ?? null) ?? 'the system sensor'}` : (live?.temperatureNote ?? 'This computer does not report a CPU temperature.')}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {counts && <Badge tone="info" dot={false}>{counts}</Badge>}
        {hybrid && <Badge tone="muted" dot={false}>{hybrid}</Badge>}
        {detail.topology.packages !== null && detail.topology.packages > 1 && <Badge tone="muted" dot={false}>{detail.topology.packages} sockets</Badge>}
        {identity.virtualized === true && <Badge tone="warn">Virtual machine</Badge>}
      </div>
    </Panel>
  );
}

export default memo(CpuHero);
