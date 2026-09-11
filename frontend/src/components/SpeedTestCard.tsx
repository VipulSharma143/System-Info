import { ArrowDown, ArrowUp, Gauge, Loader2 } from 'lucide-react';
import { useSpeedTest } from '../hooks/useSpeedTest';
import Panel from './common/Panel';

function fmt(value: number): string {
  return value.toFixed(2);
}

const PHASE_LABEL: Record<string, string> = {
  ping: 'Measuring latency',
  download: 'Testing download speed',
  upload: 'Testing upload speed',
  complete: 'Speed test complete',
};

function Meter({ percent }: { percent: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
        style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
      />
    </div>
  );
}

// A single, equal-weight readout — used twice per metric (Mbps and MB/s)
// so neither unit reads as the "primary" number and the other as a footnote.
function Reading({ value, unit, label }: { value: number; unit: string; label: string }) {
  return (
    <div className="flex-1">
      <div className="flex items-baseline gap-1.5">
        <span className="tabular text-[28px] font-medium leading-none text-[var(--text)]">
          {fmt(value)}
        </span>
        <span className="text-[13px] text-[var(--text-muted)]">{unit}</span>
      </div>
      <div className="mt-1 text-[12px] text-[var(--text-faint)]">{label}</div>
    </div>
  );
}

// Full detail block for one metric (download or upload): its own section
// with both units shown at the same size, side by side.
function MetricSection({
  icon: Icon,
  label,
  mbps,
  mbPerSecond,
  color,
}: {
  icon: typeof ArrowDown;
  label: string;
  mbps: number;
  mbPerSecond: number;
  color: string;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
        <Icon className="h-4 w-4" style={{ color }} />
        {label}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <Reading value={mbps} unit="Mbps" label="Megabits per second" />
        <Reading value={mbPerSecond} unit="MB/s" label="Megabytes per second" />
      </div>
    </div>
  );
}

export default function SpeedTestCard() {
  const { status, result, error, progress, runSpeedTest } = useSpeedTest();
  const isRunning = status === 'running';
  const phase = progress?.phase ?? 'idle';
  const isTransfer = phase === 'download' || phase === 'upload';
  const percent = Math.min(100, Math.max(0, progress?.percent ?? 0));

  return (
    <Panel
      title="Speed test"
      meta=""
      action={
        <button
          type="button"
          onClick={runSpeedTest}
          disabled={isRunning}
          className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[#0a0c10] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
          {isRunning ? 'Testing…' : 'Run test'}
        </button>
      }
    >
      {isRunning && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[var(--text)]">{PHASE_LABEL[phase] ?? 'Preparing'}</span>
            {isTransfer && <span className="tabular text-[var(--text-muted)]">{percent.toFixed(0)}%</span>}
          </div>
          {isTransfer ? (
            <>
              <Meter percent={percent} />
              <div className="tabular text-[12px] text-[var(--text-muted)]">
                {fmt(progress.mbTransferred)} MB transferred · {fmt(progress.currentMbps)} Mbps current
              </div>
            </>
          ) : (
            <Meter percent={30} />
          )}
        </div>
      )}

      {error && !isRunning && (
        <p className="text-[13px] text-[var(--critical)]" role="alert">
          {error}
        </p>
      )}

      {result && !isRunning && !error && (
        <div className="space-y-3">
          <MetricSection
            icon={ArrowDown}
            label="Download"
            mbps={result.download.mbps}
            mbPerSecond={result.download.mbPerSecond}
            color="var(--info)"
          />
          <MetricSection
            icon={ArrowUp}
            label="Upload"
            mbps={result.upload.mbps}
            mbPerSecond={result.upload.mbPerSecond}
            color="var(--accent)"
          />
          <div className="rounded-md border border-[var(--border)] p-4">
            <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
              <Gauge className="h-4 w-4 text-[var(--text-muted)]" />
              Latency
            </div>
            <Reading value={result.pingMs} unit="ms" label="Round-trip ping" />
          </div>
        </div>
      )}

      {!result && !error && !isRunning && (
        <p className="text-[13px] text-[var(--text-faint)]">
          Run a test to measure current download, upload, and latency.
        </p>
      )}
    </Panel>
  );
}
