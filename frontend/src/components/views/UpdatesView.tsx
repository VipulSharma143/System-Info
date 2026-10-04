import { memo } from 'react';
import { Loader2, ScrollText, Sparkles } from 'lucide-react';
import type { UpdaterApi } from '../../hooks/useUpdater';
import { APP_VERSION } from '../../lib/version';
import { RECENT_RELEASES } from '../../lib/changelog';
import Panel from '../common/Panel';
import ReleaseNotes from '../common/ReleaseNotes';
import { ViewContainer } from '../common/Primitives';
import ReleaseHistory from './updates/ReleaseHistory';
import UpdateStatus from './updates/UpdateStatus';

/*
  What is installed, whether something newer exists, what changed in each, and the buttons to check
  or install. All state lives in useUpdater (owned by App), so the rail badge, the banner and this
  page can never disagree.
*/

const formatDate = (iso?: string): string | undefined => {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

const installed = RECENT_RELEASES.find((r) => r.version === APP_VERSION);

function UpdatesView({ updater }: { updater: UpdaterApi }) {
  const { available } = updater;
  return (
    <ViewContainer>
      <UpdateStatus updater={updater} />

      {available && (
        <Panel title={`What’s new in v${available.version}`} icon={Sparkles} hue="updates" meta={formatDate(available.date)}>
          {available.notes.trim() ? <ReleaseNotes body={available.notes} /> : <p className="text-[13px] text-muted">No release notes were published for this version.</p>}
        </Panel>
      )}

      <Panel title="Installed version" icon={ScrollText} hue="updates" meta={`v${APP_VERSION}`}>
        {installed ? <ReleaseNotes body={installed.body} /> : <p className="text-[13px] text-muted">No release notes were found for v{APP_VERSION}.</p>}
      </Panel>

      <ReleaseHistory />
    </ViewContainer>
  );
}

export default memo(UpdatesView);

/* Full-window cover while the installer runs: services are stopped at this
   point, so the dashboard behind it would only show "backend unreachable". */
export function UpdateInstallingOverlay({ version }: { version?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[var(--bg)]/95 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-[var(--hue-updates)]" />
      <p className="num text-[20px] font-semibold text-ink">Installing System Info v{version}</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-muted">
        Services have been stopped. The app will close and reopen on its own when the update is
        done — please don&apos;t close this window.
      </p>
    </div>
  );
}
