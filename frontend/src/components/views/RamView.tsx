import { useEffect, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

import { useJsonResource, type JsonResource } from '../../hooks/useJsonResource';
import { useMetricHistory } from '../../hooks/useMetricHistory';
import { dismissAlert, showAlert } from '../../lib/alerts';
import { inlineMessage, safeMessage } from '../../lib/errors';
import {
  NOT_REPORTED,
  formatBits,
  formatMemory,
  formatMemoryType,
  formatPercent,
  formatSpeed,
  ratioPercent,
} from '../../lib/format';
import type {
  MemoryHardwareInfo,
  MemoryHardwareSummary,
  MemoryHealth,
  MemoryModule,
  RamDetails,
} from '../../types/system';

import Button from '../common/Button';
import Panel from '../common/Panel';
import Skeleton from '../common/Skeleton';
import Sparkline from '../common/Sparkline';
import UsageBar from '../common/UsageBar';
import UsageRing from '../common/UsageRing';
import { EmptyState, ErrorState } from '../common/States';
import { Badge, InfoRow, StatTile, TileGrid, ViewContainer, severityColor } from '../common/Primitives';

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

/** The single rendering of an unknown value. */
function NotReported({ hint }: { hint?: string }) {
  return (
    <span className="text-[13px] text-[var(--text-faint)]" title={hint}>
      {NOT_REPORTED}
    </span>
  );
}

/** Formats a present value, or renders the shared "Not reported" for null. */
function val<T>(value: T | null | undefined, format: (v: T) => string): ReactNode {
  return value === null || value === undefined ? <NotReported /> : format(value);
}

function yesNo(value: boolean | null, yes: string, no: string): ReactNode {
  return value === null ? <NotReported /> : value ? yes : no;
}

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

function RuntimeSkeleton() {
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

function Overview({ ram }: { ram: RamDetails }) {
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

function CurrentUsage({ ram, history }: { ram: RamDetails; history: number[] }) {
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

function SwapPanel({ ram }: { ram: RamDetails }) {
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

function CommitPanel({ ram }: { ram: RamDetails }) {
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

/* ------------------------------------------------------------------ */
/* Physical hardware sections                                          */
/* ------------------------------------------------------------------ */

/** Why there is no module data right now, in plain words (never a raw error). */
function hardwareProblem(hw: JsonResource<MemoryHardwareInfo>): string | null {
  if (hw.error) return "We couldn't read physical memory details. Current usage above is not affected.";
  if (hw.data && !hw.data.available) {
    return safeMessage(hw.data.note, 'Physical memory details are not available on this system.');
  }
  return null;
}

function PlatformPanel({
  hw,
  summary,
}: {
  hw: JsonResource<MemoryHardwareInfo>;
  summary: MemoryHardwareSummary | null;
}) {
  const problem = hardwareProblem(hw);

  if (hw.loading) {
    return (
      <Panel title="Memory platform">
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      </Panel>
    );
  }

  const s = summary;
  return (
    <Panel title="Memory platform" meta={problem ? undefined : 'Reported by firmware'}>
      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <div>
          <InfoRow label="Installed memory" value={val(s?.installedBytes, formatMemory)} />
          <InfoRow label="Memory type" value={s?.memoryType ? formatMemoryType(s.memoryType) : <NotReported />} />
          <InfoRow label="Configured speed" value={val(s?.configuredSpeedMTs, formatSpeed)} />
          <InfoRow label="Maximum reported speed" value={val(s?.maxSpeedMTs, formatSpeed)} />
          <InfoRow label="Form factor" value={s?.formFactor ? s.formFactor : <NotReported />} />
          <InfoRow
            label="ECC capability"
            value={yesNo(s?.eccSupport ?? null, 'Supported', 'Not supported')}
          />
        </div>
        <div>
          <InfoRow label="Physical slots" value={val(s?.slotCount, String)} />
          <InfoRow label="Occupied slots" value={val(s?.moduleCount, String)} />
          <InfoRow label="Empty slots" value={val(s?.emptySlots, String)} />
          <InfoRow label="Maximum capacity" value={val(s?.maxCapacityBytes, formatMemory)} />
          <InfoRow
            label="Maximum capacity / module"
            value={val(s?.maxModuleCapacityBytes, formatMemory)}
          />
          {/* Never inferred from the DIMM count: stays "Unknown" until a platform provider can prove it. */}
          <InfoRow label="Channel mode" value={s?.channelMode ?? 'Unknown'} />
        </div>
      </div>
      {problem && <p className="mt-3 text-[12px] text-[var(--text-faint)]">{problem}</p>}
    </Panel>
  );
}

function ModuleCard({ module, index }: { module: MemoryModule; index: number }) {
  const title = module.locator ?? `Module ${index + 1}`;
  return (
    <div className="card min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--text)]">{title}</div>
          {module.bankLocator && (
            <div className="truncate text-[12px] text-[var(--text-faint)]">{module.bankLocator}</div>
          )}
        </div>
        {module.memoryType && <Badge tone="info" dot={false}>{formatMemoryType(module.memoryType)}</Badge>}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="tabular text-[26px] font-medium leading-none text-[var(--text)]">
          {module.capacityBytes !== null ? formatMemory(module.capacityBytes) : NOT_REPORTED}
        </span>
        {module.speedMTs !== null && (
          <span className="text-[13px] text-[var(--text-muted)]">{formatSpeed(module.speedMTs)}</span>
        )}
      </div>

      <div className="mt-3">
        <InfoRow label="Manufacturer" value={val(module.manufacturer, String)} />
        <InfoRow label="Part number" value={val(module.partNumber, String)} />
        <InfoRow label="Serial" value={val(module.serialNumber, String)} />
        <InfoRow label="Form factor" value={val(module.formFactor, String)} />
        <InfoRow label="Configured speed" value={val(module.configuredSpeedMTs, formatSpeed)} />
        <InfoRow label="Rank" value={val(module.rank, String)} />
        <InfoRow label="Data width" value={val(module.dataWidthBits, formatBits)} />
        <InfoRow label="Total width" value={val(module.totalWidthBits, formatBits)} />
        <InfoRow label="ECC" value={yesNo(module.eccCapable, 'Supported', 'Not supported')} />
      </div>
    </div>
  );
}

function ModulesPanel({ hw }: { hw: JsonResource<MemoryHardwareInfo> }) {
  const modules = hw.data?.modules ?? [];
  const problem = hardwareProblem(hw);
  const summary = hw.data?.summary ?? null;

  let body: ReactNode;
  if (hw.loading) {
    body = (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[300px]" />
        ))}
      </div>
    );
  } else if (problem) {
    body = <EmptyState title="Hardware information unavailable" description={problem} />;
  } else if (modules.length === 0) {
    body = (
      <EmptyState
        title="No memory modules reported"
        description="The firmware did not list any populated memory modules."
      />
    );
  } else {
    // One card per detected module. Empty slots are summarised below, never faked as cards.
    body = (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {modules.map((m, i) => (
            <ModuleCard key={`${m.locator ?? 'module'}-${i}`} module={m} index={i} />
          ))}
        </div>
        {summary?.slotCount != null && summary.moduleCount != null && (
          <p className="text-[12px] text-[var(--text-muted)]">
            {summary.moduleCount} occupied
            {summary.emptySlots != null && <> · {summary.emptySlots} empty</>}
            {' · '}
            {summary.slotCount} {summary.slotCount === 1 ? 'slot' : 'slots'} total
          </p>
        )}
      </div>
    );
  }

  return (
    <Panel
      title="Memory modules"
      meta={!hw.loading && !problem && modules.length > 0 ? `${modules.length} installed` : undefined}
    >
      {body}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Health + sources                                                    */
/* ------------------------------------------------------------------ */

function HealthPanel({ health }: { health: JsonResource<MemoryHealth> }) {
  const h = health.data;
  if (health.loading) {
    return (
      <Panel title="Memory health">
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      </Panel>
    );
  }

  const noCounters = !h || (h.correctedErrors === null && h.uncorrectedErrors === null);
  return (
    <Panel title="Memory health">
      {/* Capability, enabled state and live counters are different facts; each shows only what was reported. */}
      <InfoRow label="ECC support" value={yesNo(h?.eccSupport ?? null, 'Supported', 'Not supported')} />
      <InfoRow label="ECC enabled" value={yesNo(h?.eccEnabled ?? null, 'Enabled', 'Disabled')} />
      <InfoRow label="Corrected errors" value={val(h?.correctedErrors, (n) => n.toLocaleString())} />
      <InfoRow label="Uncorrected errors" value={val(h?.uncorrectedErrors, (n) => n.toLocaleString())} />
      {noCounters && (
        <p className="mt-3 text-[12px] text-[var(--text-faint)]">
          {health.error
            ? "We couldn't read memory health information."
            : safeMessage(h?.note, 'Memory error counters are not available on this system.')}
        </p>
      )}
    </Panel>
  );
}

function SourcesPanel({
  ram,
  hw,
  health,
}: {
  ram: JsonResource<RamDetails>;
  hw: JsonResource<MemoryHardwareInfo>;
  health: JsonResource<MemoryHealth>;
}) {
  // A request still in flight is "Checking", never "Unavailable" — that would be a claim we can't back yet.
  const CHECKING = 'Checking…';

  const runtime = ram.loading
    ? CHECKING
    : !ram.data
      ? 'Unavailable'
      : ram.data.source === 'native'
        ? 'Native OS API'
        : 'Operating system (basic fallback)';

  const firmware = hw.loading ? CHECKING : hw.data?.available ? 'SMBIOS / firmware' : 'Unavailable';

  const healthSource = health.loading
    ? CHECKING
    : health.data?.source === 'edac'
      ? 'EDAC / OS error counters'
      : health.data?.eccSupport != null
        ? 'SMBIOS / firmware (capability only)'
        : 'Unavailable';

  return (
    <Panel title="Detection sources">
      <InfoRow label="Runtime memory" value={runtime} />
      <InfoRow label="Physical modules" value={firmware} />
      <InfoRow label="Platform limits" value={firmware} />
      <InfoRow label="Memory health" value={healthSource} />
      <p className="mt-3 text-[12px] text-[var(--text-faint)]">
        Each section reads from a different place, so one can be available while another is not.
      </p>
    </Panel>
  );
}

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
