import { memo } from 'react';
import { Cpu, RefreshCw } from 'lucide-react';

import { useCpuDetail } from '../../hooks/useCpuDetail';
import { useNow } from '../../hooks/useOverlay';
import Button from '../common/Button';
import { EmptyState, LoadingState } from '../common/States';
import { ViewContainer } from '../common/Primitives';

import CpuHero from './cpu/CpuHero';
import Tiles from './cpu/Tiles';
import CoreGrid from './cpu/CoreGrid';
import { ActivityPanel, FrequencyPanel, SpecsPanel, TemperaturePanel } from './cpu/Panels';

/**
 * Processor page. One document from /api/system/cpu/detail: live load, clocks and temperature come from the same
 * native sample the Overlay tab reads, so the two always agree; the rest (identity, topology, caches, sensors, power,
 * activity) is read by the native CPU reader. Anything the machine does not report is shown as unavailable, with why.
 */
function CpuView({ active }: { active: boolean }) {
  const cpu = useCpuDetail(active);
  const now = useNow(active);
  const detail = cpu.data;

  if (!detail) {
    return (
      <ViewContainer>
        {cpu.startupError ? (
          <EmptyState icon={Cpu} hue="cpu" title="Processor details are not available"
            description="The background service is not answering, or it could not read the processor. It may still be starting; try again in a moment."
            action={<Button size="sm" icon={RefreshCw} onClick={cpu.retry}>Try again</Button>} />
        ) : (
          <LoadingState label="Reading the processor" />
        )}
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <CpuHero detail={detail} now={now} />
      <Tiles detail={detail} />
      <CoreGrid detail={detail} />
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <TemperaturePanel detail={detail} />
        <FrequencyPanel detail={detail} />
        <SpecsPanel detail={detail} />
        <ActivityPanel detail={detail} />
      </div>
    </ViewContainer>
  );
}

export default memo(CpuView);
