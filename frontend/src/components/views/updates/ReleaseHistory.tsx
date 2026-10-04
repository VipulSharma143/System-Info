import { useState } from 'react';
import { ChevronRight, History } from 'lucide-react';
import { RECENT_RELEASES, loadArchivedReleases, type ReleaseEntry } from '../../../lib/changelog';
import { APP_VERSION } from '../../../lib/version';
import Button from '../../common/Button';
import Panel from '../../common/Panel';
import ReleaseNotes from '../../common/ReleaseNotes';

const previous = RECENT_RELEASES.filter((r) => r.version !== APP_VERSION);

/** Older releases as expandable rows; the long archive is only fetched when asked for. */
export default function ReleaseHistory() {
  const [archived, setArchived] = useState<ReleaseEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const showArchive = async () => {
    setLoading(true);
    try {
      setArchived(await loadArchivedReleases());
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title="Previous releases" icon={History} hue="updates">
      <div className="space-y-2">
        {[...previous, ...(archived ?? [])].map((entry) => (
          <details key={entry.version} className="group rounded-[var(--r-md)] bg-surface-2 px-4 py-3 open:bg-surface-3/60">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 text-[13px] text-ink">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-open:rotate-90" />
              <span className="num text-[14px] font-semibold">v{entry.version}</span>
              {entry.date && <span className="text-[12px] text-faint">{entry.date}</span>}
            </summary>
            <div className="mt-3 pl-6"><ReleaseNotes body={entry.body} /></div>
          </details>
        ))}
        {!archived && (
          <Button variant="ghost" size="sm" loading={loading} onClick={() => void showArchive()}>
            {loading ? 'Loading…' : 'Show older releases'}
          </Button>
        )}
      </div>
    </Panel>
  );
}
