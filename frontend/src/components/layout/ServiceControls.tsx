import { Play, Power, Square } from 'lucide-react';
import { isTauri } from '../../lib/tauri';
import { useServiceControl, type ServiceHealth } from '../../hooks/useServiceControl';

// Renders nothing when this bundle is running as a plain browser tab (the
// legacy launcher path) — there is no process for these buttons to control
// there. Inside Tauri it's the desktop-controls cluster the migration spec
// asks for: a status readout plus Start/Resume, Stop, and Exit (distinct
// from Stop — see the hook's module docs and STOP-vs-EXIT table).
export default function ServiceControls() {
  const { status, pending, start, stop, exit } = useServiceControl();

  if (!isTauri()) return null;

  const { label, color, filled } = summarize(status.backend, status.analytics);

  const handleExit = () => {
    if (window.confirm('Exit System Info? This stops monitoring and closes the app.')) {
      void exit();
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
        <span
          className="inline-flex h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: filled ? color : 'transparent', border: `1.5px solid ${color}` }}
        />
        <span style={{ color }}>{label}</span>
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void start()}
          disabled={pending || (status.backend === 'running' && status.analytics !== 'stopped')}
          title="Start/resume monitoring services"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
        >
          <Play className="h-3.5 w-3.5" strokeWidth={2} />
          Start
        </button>
        <button
          type="button"
          onClick={() => void stop()}
          disabled={pending || (status.backend === 'stopped' && status.analytics === 'stopped')}
          title="Stop monitoring services (keeps the window open)"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
        >
          <Square className="h-3.5 w-3.5" strokeWidth={2} />
          Stop
        </button>
        <button
          type="button"
          onClick={handleExit}
          title="Stop services and close System Info"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--critical)] hover:bg-[var(--surface-hover)]"
        >
          <Power className="h-3.5 w-3.5" strokeWidth={2} />
          Exit
        </button>
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
