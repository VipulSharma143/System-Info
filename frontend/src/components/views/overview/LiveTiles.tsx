import { memo } from 'react';
import type { SystemSnapshot } from '../../../types/system';
import type { DashboardHistory } from '../../../hooks/useDashboardHistory';
import { formatRate, severity, severityWord } from '../../../lib/format';
import { hueStyle, usageColor, type Hue } from '../../../lib/hues';
import Figure from '../../common/Figure';
import Sparkline from '../../common/Sparkline';
import UsageRing from '../../common/UsageRing';
import { Badge, type BadgeTone } from '../../common/Primitives';

const usageTone = (percent: number): BadgeTone => ({ ok: 'ok', warn: 'warn', critical: 'critical' } as const)[severity(percent)];

function Card({ label, hue, badge, tone, children }: { label: string; hue: Hue; badge: string; tone: BadgeTone; children: React.ReactNode }) {
  return (
    <section className="panel flex min-w-0 flex-col gap-4 p-5" style={hueStyle(hue)}>
      <header className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-ink"><span className="h-2 w-2 rounded-full bg-[var(--h)]" />{label}</span>
        <Badge tone={tone} dot={false}>{badge}</Badge>
      </header>
      {children}
    </section>
  );
}

interface Props {
  cpu: SystemSnapshot['cpu'];
  ram: SystemSnapshot['ram'];
  network: SystemSnapshot['network'];
  history: DashboardHistory;
}

/*
  The three live metrics that change second to second: processor and memory as dials with their recent trend,
  network as two figures with one trend. Only the props each card reads are passed, so a poll that changes just the
  network does not redraw the dials.
*/
function LiveTiles({ cpu, ram, network, history }: Props) {
  const rx = network.reduce((s, n) => s + n.rxKBps, 0);
  const tx = network.reduce((s, n) => s + n.txKBps, 0);
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      <Card label="Processor" hue="cpu" badge={severityWord(cpu.usedPercent)} tone={usageTone(cpu.usedPercent)}>
        <div className="flex items-center gap-5">
          <UsageRing percent={cpu.usedPercent} hue="cpu" size={112} label="busy" />
          <div className="min-w-0 flex-1"><Sparkline points={history.cpu} color={usageColor(cpu.usedPercent, 'cpu')} height={64} dot /><p className="mt-1 text-[11px] text-faint">Recent load</p></div>
        </div>
      </Card>
      <Card label="Memory" hue="ram" badge={`${(ram.usedMB / 1024).toFixed(1)} of ${(ram.totalMB / 1024).toFixed(1)} GB`} tone={usageTone(ram.usedPercent)}>
        <div className="flex items-center gap-5">
          <UsageRing percent={ram.usedPercent} hue="ram" size={112} label="used" />
          <div className="min-w-0 flex-1"><Sparkline points={history.ram} color={usageColor(ram.usedPercent, 'ram')} height={64} dot /><p className="mt-1 text-[11px] text-faint">Recent usage</p></div>
        </div>
      </Card>
      <Card label="Network" hue="net" badge="Live" tone="info">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div><div className="mb-1 text-[11px] text-muted">Download</div><Figure size="md" value={formatRate(rx)} /></div>
          <div><div className="mb-1 text-[11px] text-muted">Upload</div><Figure size="md" value={formatRate(tx)} /></div>
        </div>
        <div><Sparkline points={history.rx} color="var(--hue-net)" max="auto" height={48} dot /><p className="mt-1 text-[11px] text-faint">Recent download</p></div>
      </Card>
    </div>
  );
}

export default memo(LiveTiles);
