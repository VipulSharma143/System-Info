import { Play, Power, Square } from 'lucide-react';
import { isTauri } from '../../lib/tauri';
import { confirmExit, showAlert } from '../../lib/alerts';
import { reportDiagnostic, type AlertKind } from '../../lib/errors';
import { useServiceControl, type ServiceHealth } from '../../hooks/useServiceControl';
import Button from '../common/Button';

// Renders nothing when this bundle is running as a plain browser tab (the
// legacy launcher path) — there is no process for these buttons to control
// there. Inside Tauri it's the desktop-controls cluster the migration spec
// asks for: a status readout plus Start/Resume, Stop, and Exit (distinct
// from Stop — see the hook's module docs and STOP-vs-EXIT table).
export default function ServiceControls() {
  const { status, pending, start, stop, exit } = useServiceControl();

  if (!isTauri()) return null;

  const { label, color, filled } = summarize(status.backend, status.analytics);

  // start/stop reject if the desktop shell can't complete the request. Nothing
  // used to surface that; now the user gets a plain-language alert and the
  // technical cause goes to the developer console.
  const run = async (action: () => Promise<void>, failure: AlertKind) => {
    try {
      await action();
    } catch (err) {
      reportDiagnostic(`${failure} failed`, err);
      void showAlert(failure);
    }
  };

  const handleExit = async () => {
    if (await confirmExit()) void exit();
  };

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-medium">
        <span
          className="inline-flex h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: filled ? color : 'transparent', border: `1.5px solid ${color}` }}
        />
        <span className="max-w-[9rem] truncate xl:max-w-none" style={{ color }}>
          {label}
        </span>
      </span>

      <div className="flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--border)] p-0.5">
        <Button
          variant="ghost"
          size="sm"
          icon={Play}
          collapseLabel
          onClick={() => void run(start, 'serviceStart')}
          disabled={pending || (status.backend === 'running' && status.analytics !== 'stopped')}
          title="Start or resume monitoring services"
        >
          Start
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={Square}
          collapseLabel
          onClick={() => void run(stop, 'serviceStop')}
          disabled={pending || (status.backend === 'stopped' && status.analytics === 'stopped')}
          title="Stop monitoring services (keeps the window open)"
        >
          Stop
        </Button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border)]" />
        <Button
          variant="danger"
          size="sm"
          icon={Power}
          collapseLabel
          onClick={() => void handleExit()}
          title="Stop services and close System Info"
        >
          Exit
        </Button>
      </div>
    </div>
  );
}

function summarize(
  backend: ServiceHealth,
  analytics: ServiceHealth
): { label: string; color: string; filled: boolean } {
  if (backend === 'running' && analytics === 'running') {
    return { label: 'Running', color: 'var(--accent)', filled: true };
  }
  if (backend === 'stopped' && analytics === 'stopped') {
    return { label: 'Stopped', color: 'var(--text-muted)', filled: false };
  }
  if (backend === 'starting' || analytics === 'starting') {
    return { label: 'Starting…', color: 'var(--warn)', filled: true };
  }
  if (backend === 'running' && (analytics === 'unavailable' || analytics === 'stopped')) {
    return { label: 'Partial — analytics unavailable', color: 'var(--warn)', filled: true };
  }
  return { label: 'Stopped', color: 'var(--text-muted)', filled: false };
}
