// Live memory sections of the RAM page: usage, swap / page file, commit.
import { memo } from 'react';
import { ArrowLeftRight, Layers, MemoryStick } from 'lucide-react';

import { NOT_REPORTED, formatMemory, formatPercent, ratioPercent } from '../../../lib/format';
import type { RamDetails } from '../../../types/system';

import Panel from '../../common/Panel';
import Skeleton from '../../common/Skeleton';
import Sparkline from '../../common/Sparkline';
import UsageBar from '../../common/UsageBar';
import UsageRing from '../../common/UsageRing';
import { InfoRow, StatTile, TileGrid } from '../../common/Primitives';
import { usageColor } from '../../../lib/hues';

import { NotReported, val } from './cells';

/** "Usage" row whose bar already prints the percentage, or the shared unknown value. */
function UsageRow({ percent }: { percent: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="shrink-0 text-[12px] text-muted">Usage</span>
      {percent === null ? <NotReported /> : <div className="w-full max-w-[260px]"><UsageBar percent={percent} compact hue="ram" /></div>}
    </div>
  );
}

export function RuntimeSkeleton() {
  return (
    <Panel variant="hero" title="Memory" icon={MemoryStick} hue="ram">
      <div className="flex flex-wrap items-center gap-8">
        <Skeleton className="h-[148px] w-[148px] rounded-full" />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    </Panel>
  );
}

function CompactTile({ label, bytes }: { label: string; bytes: number | null }) {
  return (
    <StatTile
      hue="ram"
      label={label}
      value={bytes === null ? <span className="text-[14px] font-normal text-faint">{NOT_REPORTED}</span> : formatMemory(bytes)}
    />
  );
}

/** Headline panel: the ring, the three numbers that matter, and the recent trend underneath. */
export const Overview = memo(function Overview({ ram, history }: { ram: RamDetails; history: number[] }) {
  return (
    <Panel variant="hero" title="Memory" icon={MemoryStick} hue="ram">
      <div className="flex flex-wrap items-center gap-8">
        <UsageRing percent={ram.usedPercent} hue="ram" />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile hue="ram" label="Total" value={formatMemory(ram.totalBytes)} detail="Visible to the OS" />
          <StatTile hue="ram" label="Used" value={formatMemory(ram.usedBytes)} percentForColor={ram.usedPercent} detail={`${formatPercent(ram.usedPercent)} of total`} />
          <StatTile hue="ram" label="Available" value={formatMemory(ram.availableBytes)} detail="Ready for applications" />
        </div>
      </div>
      <div className="mt-6">
        <Sparkline points={history} color={usageColor(ram.usedPercent, 'ram')} height={44} dot />
        <div className="mt-1 text-right text-[12px] text-faint">memory in use, last couple of minutes</div>
      </div>
      {ram.note && <p className="mt-3 text-[12px] text-faint">{ram.note}</p>}
    </Panel>
  );
});

export const CurrentUsage = memo(function CurrentUsage({ ram }: { ram: RamDetails }) {
  return (
    <TileGrid cols={3}>
      <CompactTile label="Free" bytes={ram.freeBytes} />
      <CompactTile label="Cached" bytes={ram.cachedBytes} />
      <CompactTile label="Buffers" bytes={ram.buffersBytes} />
    </TileGrid>
  );
});

export const SwapPanel = memo(function SwapPanel({ ram }: { ram: RamDetails }) {
  const total = ram.swapTotalBytes;
  const used = ram.swapUsedBytes;

  return (
    <Panel title="Swap / page file" icon={ArrowLeftRight} hue="ram">
      {total === null ? (
        <NotReported />
      ) : total === 0 ? (
        <InfoRow label="Total" value="None configured" />
      ) : (
        <>
          <InfoRow label="Total" value={formatMemory(total)} />
          <InfoRow label="Used" value={val(used, formatMemory)} />
          <InfoRow label="Free" value={used !== null && used <= total ? formatMemory(total - used) : <NotReported />} />
          <UsageRow percent={ratioPercent(used, total)} />
        </>
      )}
    </Panel>
  );
});

export const CommitPanel = memo(function CommitPanel({ ram }: { ram: RamDetails }) {
  const limit = ram.commitLimitBytes;
  const used = ram.commitUsedBytes;
  // Only computable when the limit is positive and the used figure is real.
  const percent = limit !== null && limit > 0 ? ratioPercent(used, limit) : null;

  return (
    <Panel title="Commit memory" icon={Layers} hue="ram">
      {limit === null && used === null ? (
        <p className="text-[13px] text-muted">Commit figures are not reported on this system.</p>
      ) : (
        <>
          <InfoRow label="Commit used" value={val(used, formatMemory)} />
          <InfoRow label="Commit limit" value={val(limit, formatMemory)} />
          <UsageRow percent={percent} />
        </>
      )}
    </Panel>
  );
});
