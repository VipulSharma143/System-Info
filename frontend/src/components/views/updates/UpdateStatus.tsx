import { AlertTriangle, CircleCheck, Download, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { UpdaterApi } from '../../../hooks/useUpdater';
import { ALERT_COPY, type AlertKind } from '../../../lib/errors';
import { APP_VERSION } from '../../../lib/version';
import Button from '../../common/Button';
import Panel from '../../common/Panel';

const IS_LINUX = typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent);

function formatSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

// The hook stores the catalogue sentence of whichever step failed; find its title so the inline state mirrors the alert.
function failureTitle(text: string | null): string {
  const kinds: AlertKind[] = ['updateCheck', 'updateDownload', 'updateInstall'];
  const match = kinds.find((kind) => ALERT_COPY[kind].text === text);
  return match ? ALERT_COPY[match].title : 'Something went wrong';
}

function Line({ icon: Icon, spin, tone, children }: { icon: typeof Loader2; spin?: boolean; tone?: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-[14px] text-ink">
      <Icon className={`h-4 w-4 shrink-0 ${spin ? 'animate-spin' : ''}`} style={{ color: tone ?? 'var(--text-muted)' }} />
      {children}
    </p>
  );
}

function StatusLine({ phase, version, error }: { phase: UpdaterApi['phase']; version?: string; error: string | null }) {
  switch (phase) {
    case 'checking':
      return <Line icon={Loader2} spin>Checking for updates…</Line>;
    case 'downloading':
      return <Line icon={Loader2} spin>Downloading v{version}…</Line>;
    case 'installing':
      return <Line icon={Loader2} spin>Installing v{version}. System Info will restart…</Line>;
    case 'available':
      return <Line icon={Sparkles} tone="var(--hue-updates)">Version {version} is available.</Line>;
    case 'up-to-date':
      return <Line icon={CircleCheck} tone="var(--ok)">You’re on the latest version.</Line>;
    case 'error':
      return (
        <div role="alert" className="flex items-start gap-2.5 text-[13px]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
          <div>
            <p className="font-medium text-ink">{failureTitle(error)}</p>
            <p className="mt-0.5 text-muted">{error ?? 'Something went wrong. Please try again.'}</p>
          </div>
        </div>
      );
    default:
      return <p className="text-[14px] text-muted">Check for updates to see whether a newer version is out.</p>;
  }
}

export default function UpdateStatus({ updater }: { updater: UpdaterApi }) {
  const { supported, phase, available, progress, error, lastChecked, autoInstall, setAutoInstall, checkNow, installNow } = updater;
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing';
  const percent = progress.total && progress.total > 0 ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;

  return (
    <Panel
      variant="hero"
      title="Software update"
      icon={Download}
      hue="updates"
      meta={`Installed: v${APP_VERSION}`}
      action={supported && <Button size="sm" icon={RefreshCw} loading={phase === 'checking'} disabled={busy} onClick={() => void checkNow()}>Check for updates</Button>}
    >
      {!supported ? (
        <p className="text-[13px] leading-relaxed text-muted">
          Updates are delivered through the System Info desktop app. This page is open in a browser, so only the release notes are available.
        </p>
      ) : (
        <div className="space-y-4">
          <StatusLine phase={phase} version={available?.version} error={error} />

          {phase === 'available' && available && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={Download} onClick={() => void installNow()}>Download &amp; install v{available.version}</Button>
              <span className="max-w-md text-[12px] leading-relaxed text-faint">
                Monitoring services stop for the install and restart automatically.{IS_LINUX && ' On a .deb install you will be asked for your password.'}
              </span>
            </div>
          )}

          {phase === 'error' && available && <Button icon={Download} onClick={() => void installNow()}>Retry install of v{available.version}</Button>}

          {phase === 'downloading' && (
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-[var(--h)] transition-[width] duration-200" style={{ width: `${percent ?? 8}%` }} />
              </div>
              <p className="num text-[12px] text-faint">
                {formatSize(progress.downloaded)}{progress.total ? ` of ${formatSize(progress.total)}` : ''}{percent !== null ? ` · ${percent}%` : ''}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" checked={autoInstall} onChange={(e) => setAutoInstall(e.target.checked)} className="h-3.5 w-3.5" />
              Install updates automatically when found at startup
            </label>
            <span className="text-[12px] text-faint">
              {lastChecked ? `Last checked ${new Date(lastChecked).toLocaleTimeString()}` : 'Checks at startup and every 6 hours'}
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}
