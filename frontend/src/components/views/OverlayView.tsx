import { memo, useMemo } from 'react';
import { MonitorX } from 'lucide-react';

import { useCompactPreference, useNow, useOverlay } from '../../hooks/useOverlay';
import Button from '../common/Button';
import { EmptyState, LoadingState } from '../common/States';
import { ViewContainer } from '../common/Primitives';

import StatusBar from './overlay/StatusBar';
import Tile from './overlay/Tile';
import { buildTiles } from './overlay/model';

/**
 * Live monitor. One snapshot from the native engine (CPU, every GPU, memory, plus a minute of history) is the only
 * data this page reads, so its numbers always belong to the same moment and always match the GPU page.
 */
function OverlayView({ active }: { active: boolean }) {
  const overlay = useOverlay(active);
  const now = useNow(active);
  const [compact, setCompact] = useCompactPreference();
  const snapshot = overlay.data;
  const tiles = useMemo(() => (snapshot ? buildTiles(snapshot) : []), [snapshot]);

  if (!snapshot) {
    return (
      <ViewContainer>
        {overlay.startupError ? (
          <EmptyState icon={MonitorX} hue="overlay" title="The live monitor did not start" description="The background service is not answering. It may still be starting; try again in a moment."
            action={<Button onClick={overlay.retry}>Try again</Button>} />
        ) : (
          <LoadingState label="Starting the live monitor" />
        )}
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <StatusBar snapshot={snapshot} now={now} compact={compact} onCompact={setCompact} />
      <div className={`grid gap-4 ${compact ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4' : 'grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3'}`}>
        {tiles.map((t) => <Tile key={t.id} tile={t} compact={compact} />)}
      </div>
    </ViewContainer>
  );
}

export default memo(OverlayView);
