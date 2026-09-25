import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { ALERT_COPY } from '../../lib/errors';
import Button from '../common/Button';

export interface StartupStep {
  label: string;
  done: boolean;
}

interface StartupScreenProps {
  // One entry per checklist line, in display order. "Loading CPU
  // information" / "…memory…" / "…storage…" / "…network…" all share a
  // single `done` value (metricsLoaded) — see buildStartupSteps() below —
  // because all four come back together in one /api/system/all payload,
  // not as four independent requests. Faking independent completion for
  // them would be dishonest about what the app is actually doing.
  steps: StartupStep[];
  // True once STARTUP_GRACE_MS has elapsed with no success on at least one
  // of the underlying sources. When true, the checklist is replaced with a
  // genuine error state — this is a real failure, not "still starting". The
  // wording is always the plain-language catalog copy, never the raw error.
  failed: boolean;
  onRetry: () => void;
}

// Builds the ordered checklist from the individual completion flags. Kept
// as a standalone function (rather than inlined in the component) so
// App.tsx can construct `steps` without either side having to duplicate
// the label text or the grouping logic.
//
//   Starting System Info   — true the instant this screen renders; it
//                             represents the app process itself having
//                             started, which is a precondition for this
//                             component existing at all, not a network call.
//   Loading system services — Tauri's services-status event (backend
//                             process actually answering /health).
//                             Auto-true outside Tauri: on Linux, start-all.sh
//                             already starts the three processes before the
//                             browser tab even opens, so there is no
//                             separate "starting services" phase from the
//                             frontend's point of view there.
//   Fetching system information — useSystemInfo's info !== null
//   Loading CPU/memory/storage/network information — all four share
//                             useSystemMetrics' data !== null; they are one
//                             payload from /api/system/all, not four calls.
//   Loading GPU information — useSystemGpu's gpus !== null
export function buildStartupSteps(args: {
  servicesReady: boolean;
  infoLoaded: boolean;
  metricsLoaded: boolean;
  gpuLoaded: boolean;
}): StartupStep[] {
  return [
    { label: 'Starting System Info', done: true },
    { label: 'Loading system services', done: args.servicesReady },
    { label: 'Fetching system information', done: args.infoLoaded },
    { label: 'Loading CPU information', done: args.metricsLoaded },
    { label: 'Loading memory information', done: args.metricsLoaded },
    { label: 'Loading storage information', done: args.metricsLoaded },
    { label: 'Loading network information', done: args.metricsLoaded },
    { label: 'Loading GPU information', done: args.gpuLoaded },
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
