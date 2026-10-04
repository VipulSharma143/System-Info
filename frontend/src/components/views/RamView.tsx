import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

import { useJsonResource } from '../../hooks/useJsonResource';
import { useMetricHistory } from '../../hooks/useMetricHistory';
import { dismissAlert, showAlert } from '../../lib/alerts';
import { inlineMessage } from '../../lib/errors';
import type { MemoryHardwareInfo, MemoryHealth, RamDetails } from '../../types/system';

import Button from '../common/Button';
import Panel from '../common/Panel';
import { ErrorState } from '../common/States';
import { ViewContainer } from '../common/Primitives';

import { HealthPanel, ModulesPanel, PlatformPanel, SourcesPanel } from './ram/HardwarePanels';
import { CommitPanel, CurrentUsage, Overview, RuntimeSkeleton, SwapPanel } from './ram/RuntimePanels';

/*
  The RAM page renders three independent backend responses and never assumes
  they all arrive:

    runtime   GET /api/system/ram              polled every few seconds
    hardware  GET /api/system/memory/hardware  fetched once (DIMMs do not change at runtime)
    health    GET /api/system/memory/health    polled slowly

  Any one of them can be loading, unavailable or failed while the others work,
  so each section decides its own state. There is no platform logic here: the
  backend already normalised Windows and Linux into the same shapes, and a
  null field simply means "this platform did not report it".
*/

const RUNTIME_POLL_MS = 3000;
const HEALTH_POLL_MS = 30_000;

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

interface RamViewProps {
  /** True while the RAM tab is the visible one. Nothing is requested otherwise. */
  active: boolean;
}

export default function RamView({ active }: RamViewProps) {
  const ram = useJsonResource<RamDetails>('/api/system/ram', { active, intervalMs: RUNTIME_POLL_MS });
  const hw = useJsonResource<MemoryHardwareInfo>('/api/system/memory/hardware', { active });
  const health = useJsonResource<MemoryHealth>('/api/system/memory/health', {
    active,
    intervalMs: HEALTH_POLL_MS,
  });

  const history = useMetricHistory(ram.data?.usedPercent);

  // Only the live reading raises the app-level alert; physical-module trouble is shown in place.
  const retryRuntime = ram.retry;
  useEffect(() => {
    if (!ram.error) return;
    void showAlert('memory', { onRetry: retryRuntime });
    return () => dismissAlert('memory');
  }, [ram.error, retryRuntime]);

  return (
    <ViewContainer>
      {ram.error && !ram.data ? (
        <Panel title="Memory">
          <div className="space-y-3">
            <ErrorState message={inlineMessage('memory')} />
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={ram.retry}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : ram.data ? (
        <>
          <Overview ram={ram.data} />
          <CurrentUsage ram={ram.data} history={history} />
        </>
      ) : (
        <RuntimeSkeleton />
      )}

      <PlatformPanel hw={hw} summary={hw.data?.summary ?? null} />
      <ModulesPanel hw={hw} />

      {ram.data && (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
          <SwapPanel ram={ram.data} />
          <CommitPanel ram={ram.data} />
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        <HealthPanel health={health} />
        <SourcesPanel ram={ram} hw={hw} health={health} />
      </div>
    </ViewContainer>
  );
}
