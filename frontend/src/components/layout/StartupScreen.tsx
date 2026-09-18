import { CheckCircle2, Loader2 } from 'lucide-react';
import { ErrorState } from '../common/States';

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
  // genuine error state — this is a real failure, not "still starting".
  failed: boolean;
  errorMessage?: string;
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
// Reuses the app's existing visual language rather than inventing a new
// style: Loader2 (already used by LoadingState), ErrorState (already used
// for real failures elsewhere), and the same --bg/--text/--text-muted/
// --text-faint/--accent/--border tokens the rest of the app is built on.
export default function StartupScreen({ steps, failed, errorMessage, onRetry }: StartupScreenProps) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-8 bg-[var(--bg)] px-6 text-[var(--text)]">
      <div className="text-[15px] font-medium tracking-tight text-[var(--text)]">System Info</div>

      {failed ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <ErrorState
            message={
              errorMessage
                ? `Startup didn't finish — ${errorMessage}`
                : "Startup didn't finish. The backend never became reachable."
            }
          />
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-[var(--border)] px-4 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-hover)]"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <ul className="flex w-full max-w-sm flex-col gap-2.5">
            {steps.map((step) => (
              <StartupStepRow key={step.label} step={step} />
            ))}
          </ul>

          <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Please wait…
          </div>
        </>
      )}
    </div>
  );
}

function StartupStepRow({ step }: { step: StartupStep }) {
  return (
    <li className="flex items-center gap-2.5 text-[13px]">
      {step.done ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" strokeWidth={2} />
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--text-faint)]" />
      )}
      <span className={step.done ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}>{step.label}</span>
    </li>
  );
}