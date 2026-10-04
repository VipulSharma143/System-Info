import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { ALERT_COPY } from '../../lib/errors';
import Button from '../common/Button';

export interface StartupStep {
  label: string;
  done: boolean;
}

interface StartupScreenProps {
  // One entry per checklist line, in display order.
  steps: StartupStep[];
  // True once STARTUP_GRACE_MS has passed with no successful load. The checklist is then
  // replaced by an error state, using plain-language catalog copy.
  failed: boolean;
  onRetry: () => void;
}

// Builds the ordered checklist. The four dashboard lines share one flag because they arrive
// together in a single /api/system/all response, not as separate requests. System identity and
// GPU details are not listed: they load in the background once the System page is opened.
export function buildStartupSteps(args: { servicesReady: boolean; metricsLoaded: boolean }): StartupStep[] {
  return [
    { label: 'Starting System Info', done: true },
    { label: 'Loading system services', done: args.servicesReady },
    { label: 'Loading CPU information', done: args.metricsLoaded },
    { label: 'Loading memory information', done: args.metricsLoaded },
    { label: 'Loading storage information', done: args.metricsLoaded },
    { label: 'Loading network information', done: args.metricsLoaded },
  ];
}

// Full-screen replacement for the old inline "Connecting to backend…" text.
// Reuses the app's existing visual language: the same tokens, the shared
// card surface, Loader2 for progress and Button for the retry action.
export default function StartupScreen({ steps, failed, onRetry }: StartupScreenProps) {
  const doneCount = steps.filter((step) => step.done).length;
  const failure = ALERT_COPY.systemInfo;

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-[var(--bg)] px-6 text-[var(--text)]">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
          <Activity className="h-5 w-5 text-[var(--accent)]" strokeWidth={2.2} />
        </span>
        <span className="text-[18px] font-semibold tracking-[-0.01em]">System Info</span>
      </div>

      <div className="card w-full max-w-sm p-5">
        {failed ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-2 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--critical-soft)] text-[var(--critical)]">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[14px] font-semibold">{failure.title}</p>
              <p className="mx-auto mt-1 max-w-[16rem] text-[13px] leading-relaxed text-[var(--text-muted)]">
                {failure.text}
              </p>
            </div>
            <Button variant="primary" icon={RefreshCw} onClick={onRetry} className="mt-1">
              Try again
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-baseline justify-between">
              <p className="text-[13px] font-semibold">Getting things ready</p>
              <p className="tabular text-[12px] text-[var(--text-faint)]">
                {doneCount} of {steps.length}
              </p>
            </div>
            <div
              className="mb-4 h-1 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={doneCount}
              aria-label="Startup progress"
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
            <ul className="flex flex-col gap-2.5">
              {steps.map((step) => (
                <StartupStepRow key={step.label} step={step} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function StartupStepRow({ step }: { step: StartupStep }) {
  return (
    <li className="flex items-center gap-2.5 text-[13px]">
      {step.done ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--accent)]" strokeWidth={2} />
      ) : (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-faint)]" />
      )}
      <span className={step.done ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}>{step.label}</span>
    </li>
  );
}
