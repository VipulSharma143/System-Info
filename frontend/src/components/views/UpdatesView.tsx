import { useState } from 'react';
import { AlertTriangle, ChevronRight, CircleCheck, Download, Loader2, RefreshCw } from 'lucide-react';
import type { UpdaterApi } from '../../hooks/useUpdater';
import { APP_VERSION } from '../../lib/version';
import {
  RECENT_RELEASES,
  loadArchivedReleases,
  type ReleaseEntry,
} from '../../lib/changelog';
import Panel from '../common/Panel';
import ReleaseNotes from '../common/ReleaseNotes';
import Button from '../common/Button';
import { ALERT_COPY, type AlertKind } from '../../lib/errors';
import { ViewContainer } from '../common/Primitives';

/*
  The Updates tab: what's installed, whether something newer exists, what
  changed in each, and the buttons to check/install. All state lives in
  useUpdater (owned by App) so the sidebar badge, the banner and this page
  can never disagree.
*/

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

const IS_LINUX = typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent);

export default function UpdatesView({ updater }: { updater: UpdaterApi }) {
  const {
    supported,
    phase,
    available,
    progress,
    error,
    lastChecked,
    autoInstall,
    setAutoInstall,
    checkNow,
    installNow,
  } = updater;

  const [archived, setArchived] = useState<ReleaseEntry[] | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);

  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing';
  const percent =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  const installed = RECENT_RELEASES.find((r) => r.version === APP_VERSION);
  const previous = RECENT_RELEASES.filter((r) => r.version !== APP_VERSION);

  const showArchive = async () => {
    setArchiveLoading(true);
    try {
      setArchived(await loadArchivedReleases());
    } finally {
      setArchiveLoading(false);
    }
  };

  return (
    <ViewContainer>
      <Panel
        title="Software update"
        meta={`Installed: v${APP_VERSION}`}
        action={
          supported && (
            <Button size="sm" icon={RefreshCw} loading={phase === 'checking'} disabled={busy} onClick={() => void checkNow()}>
              Check for updates
            </Button>
          )
        }
      >
        {!supported && (
          <p className="text-[13px] text-[var(--text-muted)]">
            Updates are delivered through the System Info desktop app. This page is running in a
            browser, so only the release notes below are available.
          </p>
        )}

        {supported && (
          <div className="space-y-3">
            <StatusLine phase={phase} version={available?.version} error={error} />

            {phase === 'available' && available && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" icon={Download} onClick={() => void installNow()}>
                  Download &amp; install v{available.version}
                </Button>
                <span className="text-[12px] text-[var(--text-faint)]">
                  Monitoring services are stopped for the install and restart automatically.
                  {IS_LINUX && ' On a .deb install you will be asked for your password.'}
                </span>
              </div>
            )}

            {phase === 'error' && available && (
              <Button icon={Download} onClick={() => void installNow()}>
                Retry install of v{available.version}
              </Button>
            )}

            {phase === 'downloading' && (
              <div className="space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                    style={{ width: `${percent ?? 8}%` }}
                  />
                </div>
                <p className="tabular text-[12px] text-[var(--text-faint)]">
                  {formatBytes(progress.downloaded)}
                  {progress.total ? ` of ${formatBytes(progress.total)}` : ''}
                  {percent !== null ? ` · ${percent}%` : ''}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={autoInstall}
                  onChange={(e) => setAutoInstall(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                Install updates automatically when found at startup
              </label>
              <span className="text-[12px] text-[var(--text-faint)]">
                {lastChecked
                  ? `Last checked ${new Date(lastChecked).toLocaleTimeString()}`
                  : 'Checks automatically at startup and every 6 hours'}
              </span>
            </div>
          </div>
        )}
      </Panel>

      {available && (
        <Panel
          title={`What's new in v${available.version}`}
          meta={formatDate(available.date) ?? undefined}
        >
          {available.notes.trim() ? (
            <ReleaseNotes body={available.notes} />
          ) : (
            <p className="text-[13px] text-[var(--text-faint)]">
              No release notes were published for this version.
            </p>
          )}
        </Panel>
      )}

      <Panel title="Installed version" meta={`v${APP_VERSION}`}>
        {installed ? (
          <ReleaseNotes body={installed.body} />
        ) : (
          <p className="text-[13px] text-[var(--text-faint)]">
            No release notes were found for v{APP_VERSION}.
          </p>
        )}
      </Panel>

      <Panel title="Previous releases">
        <div className="space-y-2">
          {[...previous, ...(archived ?? [])].map((entry) => (
            <details
              key={entry.version}
              className="group rounded-lg border border-[var(--border)] px-3 py-2 transition-colors open:bg-[var(--bg)]/40"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] text-[var(--text)]">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)] transition-transform group-open:rotate-90" />
                <span className="font-medium">v{entry.version}</span>
                {entry.date && (
                  <span className="text-[12px] text-[var(--text-faint)]">{entry.date}</span>
                )}
              </summary>
              <div className="mt-3">
                <ReleaseNotes body={entry.body} />
              </div>
            </details>
          ))}

          {!archived && (
            <Button variant="ghost" size="sm" loading={archiveLoading} onClick={() => void showArchive()}>
              {archiveLoading ? 'Loading…' : 'Show older releases'}
            </Button>
          )}
        </div>
      </Panel>
    </ViewContainer>
  );
}

// The hook stores the catalog sentence for whichever step failed; find the
// matching catalog title so the inline state mirrors the alert exactly.
function failureTitle(text: string | null): string {
  const kinds: AlertKind[] = ['updateCheck', 'updateDownload', 'updateInstall'];
  const match = kinds.find((kind) => ALERT_COPY[kind].text === text);
  return match ? ALERT_COPY[match].title : 'Something went wrong';
}

function StatusLine({
  phase,
  version,
  error,
}: {
  phase: UpdaterApi['phase'];
  version?: string;
  error: string | null;
}) {
  if (phase === 'checking') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking for updates…
      </p>
    );
  }
  if (phase === 'downloading') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Downloading v{version}…
      </p>
    );
  }
  if (phase === 'installing') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing v{version} — System Info will
        restart…
      </p>
    );
  }
  if (phase === 'available') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text)]">
        <Download className="h-3.5 w-3.5 text-[var(--accent)]" /> Version {version} is available.
      </p>
    );
  }
  if (phase === 'up-to-date') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text)]">
        <CircleCheck className="h-3.5 w-3.5 text-[var(--accent)]" /> You&apos;re up to date.
      </p>
    );
  }
  if (phase === 'error') {
    return (
      <div role="alert" className="flex items-start gap-2.5 text-[13px]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--critical)]" />
        <div>
          <p className="font-medium text-[var(--text)]">{failureTitle(error)}</p>
          <p className="mt-0.5 text-[var(--text-muted)]">{error ?? 'Something went wrong. Please try again.'}</p>
        </div>
      </div>
    );
  }
  return (
    <p className="text-[13px] text-[var(--text-muted)]">
      Press “Check for updates” to look for a newer version.
    </p>
  );
}

/* Full-window cover while the installer runs: services are stopped at this
   point, so the dashboard behind it would only show "backend unreachable". */
export function UpdateInstallingOverlay({ version }: { version?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[var(--bg)]/95 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-[var(--accent)]" />
      <p className="text-[16px] font-semibold text-[var(--text)]">Installing System Info v{version}</p>
      <p className="max-w-sm text-[13px] text-[var(--text-faint)]">
        Services have been stopped. The app will close and reopen on its own when the update is
        done — please don&apos;t close this window.
      </p>
    </div>
  );
}
