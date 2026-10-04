// Live memory sections of the RAM page: usage, swap / page file, commit.

import { NOT_REPORTED, formatMemory, formatPercent, ratioPercent } from '../../../lib/format';
import type { RamDetails } from '../../../types/system';

import Panel from '../../common/Panel';
import Skeleton from '../../common/Skeleton';
import Sparkline from '../../common/Sparkline';
import UsageBar from '../../common/UsageBar';
import UsageRing from '../../common/UsageRing';
import { InfoRow, StatTile, TileGrid, severityColor } from '../../common/Primitives';


import { NotReported, val } from './cells';

/** "Usage" row whose bar already prints the percentage, or the shared unknown value. */
function UsageRow({ percent }: { percent: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-2 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-[12px] text-[var(--text-muted)]">Usage</span>
      {percent === null ? (
        <NotReported />
      ) : (
        <div className="w-full max-w-[260px]">
          <UsageBar percent={percent} compact />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Runtime sections                                                    */
/* ------------------------------------------------------------------ */

export function RuntimeSkeleton() {
  return (
    <>
      <Panel title="Memory">
        <div className="flex flex-wrap items-center gap-6">
          <Skeleton className="h-[132px] w-[132px] rounded-full" />
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[72px]" />
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Current usage">
        <TileGrid cols={3}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[72px]" />
          ))}
        </TileGrid>
      </Panel>
    </>
  );
}

function CompactTile({ label, bytes }: { label: string; bytes: number | null }) {
  return (
    <StatTile
      label={label}
      value={
        bytes === null ? (
          <span className="text-[14px] font-normal text-[var(--text-faint)]">{NOT_REPORTED}</span>
        ) : (
          formatMemory(bytes)
        )
      }
    />
  );
}

export function Overview({ ram }: { ram: RamDetails }) {
  return (
    <Panel title="Memory">
      <div className="flex flex-wrap items-center gap-6">
        <UsageRing percent={ram.usedPercent} />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="Total" value={formatMemory(ram.totalBytes)} detail="Visible to the OS" />
          <StatTile
            label="Used"
            value={formatMemory(ram.usedBytes)}
            percentForColor={ram.usedPercent}
            detail={`${formatPercent(ram.usedPercent)} of total`}
          />
          <StatTile label="Available" value={formatMemory(ram.availableBytes)} detail="Ready for applications" />
        </div>
      </div>
      {ram.note && <p className="mt-3 text-[12px] text-[var(--text-faint)]">{ram.note}</p>}
    </Panel>
  );
}

export function CurrentUsage({ ram, history }: { ram: RamDetails; history: number[] }) {
  return (
    <Panel title="Current usage">
      <div className="space-y-3">
        <TileGrid cols={3}>
          <CompactTile label="Free" bytes={ram.freeBytes} />
          <CompactTile label="Cached" bytes={ram.cachedBytes} />
          <CompactTile label="Buffers" bytes={ram.buffersBytes} />
        </TileGrid>
        <div>
          <Sparkline points={history} color={severityColor(ram.usedPercent)} height={40} />
          <div className="mt-1 text-right text-[11px] text-[var(--text-faint)]">
            memory in use, last couple of minutes
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function SwapPanel({ ram }: { ram: RamDetails }) {
  const total = ram.swapTotalBytes;
  const used = ram.swapUsedBytes;
  const percent = ratioPercent(used, total);

  return (
    <Panel title="Swap / page file">
      {total === null ? (
        <NotReported />
      ) : total === 0 ? (
        <InfoRow label="Total" value="None configured" />
      ) : (
        <>
          <InfoRow label="Total" value={formatMemory(total)} />
          <InfoRow label="Used" value={val(used, formatMemory)} />
          <InfoRow
            label="Free"
            value={used !== null && used <= total ? formatMemory(total - used) : <NotReported />}
          />
          <UsageRow percent={percent} />
        </>
      )}
    </Panel>
  );
}

export function CommitPanel({ ram }: { ram: RamDetails }) {
  const limit = ram.commitLimitBytes;
  const used = ram.commitUsedBytes;
  // Only computable when the limit is positive and the used figure is real.
  const percent = limit !== null && limit > 0 ? ratioPercent(used, limit) : null;

  return (
    <Panel title="Commit memory">
      {limit === null && used === null ? (
        <p className="text-[13px] text-[var(--text-faint)]">
          Commit figures are not reported on this system.
        </p>
      ) : (
        <>
          <InfoRow label="Commit used" value={val(used, formatMemory)} />
          <InfoRow label="Commit limit" value={val(limit, formatMemory)} />
          <UsageRow percent={percent} />
        </>
      )}
    </Panel>
  );
}
