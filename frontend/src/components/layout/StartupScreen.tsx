import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { ALERT_COPY } from '../../lib/errors';
import { isTauri } from '../../lib/tauri';
import type { StartupStep } from '../../lib/startupSteps';
import Button from '../common/Button';
import BrandMark from './BrandMark';

interface StartupScreenProps {
  /** One entry per checklist line, in display order. */
  steps: StartupStep[];
  /** True once STARTUP_GRACE_MS has passed with no successful load. */
  failed: boolean;
  onRetry: () => void;
}

// The one decorative moment in the app: a heartbeat line that draws itself while the backend starts.
function Heartbeat() {
  return (
    <svg viewBox="0 0 240 48" className="h-12 w-60" fill="none" aria-hidden="true">
      <path d="M0 26h70l10-16 14 34 12-26 8 8h126" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        className="heartbeat-line"
        d="M0 26h70l10-16 14 34 12-26 8 8h126"
        stroke="var(--hue-cpu)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

export default function StartupScreen({ steps, failed, onRetry }: StartupScreenProps) {
  const doneCount = steps.filter((step) => step.done).length;
  const failure = ALERT_COPY.systemInfo;

  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center gap-8 px-6 text-ink"
      style={{ background: 'radial-gradient(900px 520px at 50% 0%, var(--bg-glow), transparent 70%), var(--bg)' }}
    >
      <div className="flex flex-col items-center gap-4">
        <BrandMark size={52} />
        <h1 className="num text-[28px] font-bold leading-none">System Info</h1>
        {!failed && <Heartbeat />}
      </div>

      {failed ? (
        <div role="alert" className="panel flex w-full max-w-sm flex-col items-center gap-3 p-6 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--critical)_16%,transparent)] text-critical">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <p className="num text-[16px] font-semibold">{failure.title}</p>
            <p className="mx-auto mt-1 max-w-[18rem] text-[13px] leading-relaxed text-muted">{failure.text}</p>
          </div>
          <Button variant="primary" icon={RefreshCw} onClick={onRetry} className="mt-1">
            Try again
          </Button>
        </div>
      ) : (
        <div className="w-full max-w-sm">
          <div
            className="mb-4 h-1 w-full overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={doneCount}
            aria-label="Startup progress"
          >
            <div className="h-full rounded-full bg-[var(--hue-cpu)] transition-[width] duration-300 ease-out" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-2.5 text-[13px]">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${step.done ? 'bg-[var(--ok)] text-[var(--on-primary)]' : 'border border-line-strong'}`}
                >
                  {step.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className={step.done ? 'text-ink' : 'text-muted'}>{step.label}</span>
              </li>
            ))}
          </ul>
          {isTauri() && (
            <p className="mt-6 rounded-[var(--r-md)] border border-line bg-surface-2 px-4 py-3 text-center text-[12px] leading-relaxed text-muted">
              While this loads: the <span className="font-medium text-ink">System</span> tab has three startup options. Run in the background,
              don’t run in the background, or start automatically at system startup. Pick what suits you once the dashboard opens.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
