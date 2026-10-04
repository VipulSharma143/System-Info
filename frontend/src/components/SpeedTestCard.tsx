import { ArrowDown, ArrowUp, Gauge, Play, type LucideIcon } from 'lucide-react';
import { useSpeedTest } from '../hooks/useSpeedTest';
import { ALERT_COPY } from '../lib/errors';
import { hueStyle } from '../lib/hues';
import Button from './common/Button';
import Figure from './common/Figure';
import Panel from './common/Panel';

const PHASE_LABEL: Record<string, string> = {
  ping: 'Measuring latency',
  download: 'Testing download speed',
  upload: 'Testing upload speed',
  complete: 'Speed test complete',
};

const fmt = (value: number) => value.toFixed(2);

function Meter({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
      <div className="h-full rounded-full bg-[var(--h)] transition-[width] duration-200" style={{ width: `${Math.min(100, Math.max(2, percent))}%` }} />
    </div>
  );
}

// Both units at equal weight, so neither reads as the "real" number and the other as a footnote.
function Result({ icon: Icon, label, color, primary, secondary }: {
  icon: LucideIcon;
  label: string;
  color: string;
  primary: { value: number; unit: string };
  secondary?: { value: number; unit: string };
}) {
  return (
    <div className="rounded-[var(--r-md)] bg-surface-2 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-ink">
        <Icon className="h-4 w-4" style={{ color }} />
        {label}
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Figure size="md" value={fmt(primary.value)} unit={primary.unit} />
        {secondary && <Figure size="md" value={fmt(secondary.value)} unit={secondary.unit} />}
      </div>
    </div>
  );
}

export default function SpeedTestCard() {
  const { status, result, error, progress, runSpeedTest } = useSpeedTest();
  const running = status === 'running';
  const phase = progress?.phase ?? 'idle';
  const transferring = phase === 'download' || phase === 'upload';
  const percent = Math.min(100, Math.max(0, progress?.percent ?? 0));

  return (
    <Panel
      title="Speed test"
      icon={Gauge}
      hue="net"
      meta="against a remote server"
      action={
        <Button variant="primary" size="sm" icon={running ? undefined : Play} loading={running} onClick={runSpeedTest}>
          {running ? 'Testing…' : result ? 'Run again' : 'Run test'}
        </Button>
      }
    >
      <div style={hueStyle('net')}>
        {running && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink">{PHASE_LABEL[phase] ?? 'Preparing'}</span>
              {transferring && <span className="num text-muted">{percent.toFixed(0)}%</span>}
            </div>
            <Meter percent={transferring ? percent : 30} />
            {transferring && (
              <div className="num text-[12px] text-muted">
                {fmt(progress.mbTransferred)} MB transferred · {fmt(progress.currentMbps)} Mbps now
              </div>
            )}
          </div>
        )}

        {error && !running && (
          <div role="alert" className="flex items-start gap-2.5 text-[13px]">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--warn)]" />
            <div>
              <p className="font-medium text-ink">{ALERT_COPY.speedTest.title}</p>
              <p className="mt-0.5 text-muted">{error}</p>
            </div>
          </div>
        )}

        {result && !running && !error && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Result icon={ArrowDown} label="Download" color="var(--hue-net)" primary={{ value: result.download.mbps, unit: 'Mbps' }} secondary={{ value: result.download.mbPerSecond, unit: 'MB/s' }} />
            <Result icon={ArrowUp} label="Upload" color="var(--hue-power)" primary={{ value: result.upload.mbps, unit: 'Mbps' }} secondary={{ value: result.upload.mbPerSecond, unit: 'MB/s' }} />
            <Result icon={Gauge} label="Latency" color="var(--text-muted)" primary={{ value: result.pingMs, unit: 'ms' }} />
          </div>
        )}

        {!result && !error && !running && (
          <p className="text-[13px] text-muted">Run a test to measure your current download speed, upload speed and latency.</p>
        )}
      </div>
    </Panel>
  );
}
