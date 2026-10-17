import { Play, Power, Square } from 'lucide-react';
import { isTauri } from '../../lib/tauri';
import { confirmExit, showAlert } from '../../lib/alerts';
import { getBehavior, keepsRunning } from '../../lib/behaviorClient';
import { reportDiagnostic, type AlertKind } from '../../lib/errors';
import { useServiceControl, type ServiceHealth } from '../../hooks/useServiceControl';
import Button from '../common/Button';

// Desktop-only controls: a status readout plus Start/Resume, Stop (keeps the window) and Exit
// (follows the background setting: closes the window and keeps running, or stops everything). Renders nothing in a plain browser tab, where there is no process to control.
export default function ServiceControls() {
  const { status, pending, start, stop, exit } = useServiceControl();

  if (!isTauri()) return null;

  const { label, color, filled } = summarize(status.backend);

  // start/stop reject if the desktop shell can't complete the request: the user gets a plain-language
  // alert and the technical cause goes to the developer console.
  const run = async (action: () => Promise<void>, failure: AlertKind) => {
    try {
      await action();
    } catch (err) {
      reportDiagnostic(`${failure} failed`, err);
      void showAlert(failure);
    }
  };

  // Exit follows the background setting (the shell decides): read it fresh so the wording matches what will happen,
  // even if it was just changed on the System page.
  const handleExit = async () => {
    const background = await getBehavior().then(keepsRunning, () => false);
    if (await confirmExit(background)) void exit();
  };

  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap text-[12px] font-medium">
        <span
          className="inline-flex h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: filled ? color : 'transparent', border: `1.5px solid ${color}` }}
        />
        <span className="max-w-[9rem] truncate xl:max-w-none" style={{ color }}>
          {label}
        </span>
      </span>

      <div className="flex items-center gap-0.5 rounded-full bg-surface-2 p-1">
        <Button
          variant="ghost"
          size="sm"
          icon={Play}
          collapseLabel
          onClick={() => void run(start, 'serviceStart')}
          disabled={pending || status.backend === 'running' || status.backend === 'starting'}
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
          disabled={pending || status.backend === 'stopped'}
          title="Stop monitoring services (keeps the window open)"
        >
          Stop
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Power}
          collapseLabel
          onClick={() => void handleExit()}
          title="Close System Info (keeps running in the background if you chose that on the System page)"
        >
          Exit
        </Button>
      </div>
    </div>
  );
}

function summarize(backend: ServiceHealth): { label: string; color: string; filled: boolean } {
  switch (backend) {
    case 'running':
      return { label: 'Running', color: 'var(--ok)', filled: true };
    case 'starting':
      return { label: 'Starting…', color: 'var(--warn)', filled: true };
    case 'unavailable':
      return { label: 'Backend unavailable', color: 'var(--warn)', filled: true };
    default:
      return { label: 'Stopped', color: 'var(--text-muted)', filled: false };
  }
}
