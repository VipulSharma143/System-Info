// Physical-memory sections of the RAM page: platform summary, modules, ECC health, data sources.
import { memo, type ReactNode } from 'react';
import { HeartPulse, MemoryStick, Radar, Server } from 'lucide-react';

import { type JsonResource } from '../../../hooks/useJsonResource';
import { safeMessage } from '../../../lib/errors';
import { NOT_REPORTED, formatBits, formatMemory, formatMemoryType, formatSpeed } from '../../../lib/format';
import type { MemoryHardwareInfo, MemoryHardwareSummary, MemoryHealth, MemoryModule, RamDetails } from '../../../types/system';

import Panel from '../../common/Panel';
import Skeleton from '../../common/Skeleton';
import { EmptyState } from '../../common/States';
import { Badge, InfoRow } from '../../common/Primitives';


import { NotReported, val, yesNo } from './cells';

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

export const PlatformPanel = memo(function PlatformPanel({
  hw,
  summary,
}: {
  hw: JsonResource<MemoryHardwareInfo>;
  summary: MemoryHardwareSummary | null;
}) {
  const problem = hardwareProblem(hw);

  if (hw.loading) {
    return (
      <Panel title="Memory platform" icon={Server} hue="ram">
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
    <Panel title="Memory platform" icon={Server} hue="ram" meta={problem ? undefined : 'Reported by firmware'}>
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
      {problem && <p className="mt-3 text-[12px] text-faint">{problem}</p>}
    </Panel>
  );
});

function ModuleCard({ module, index }: { module: MemoryModule; index: number }) {
  const title = module.locator ?? `Module ${index + 1}`;
  return (
    <div className="min-w-0 rounded-[var(--r-md)] bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{title}</div>
          {module.bankLocator && (
            <div className="truncate text-[12px] text-faint">{module.bankLocator}</div>
          )}
        </div>
        {module.memoryType && <Badge tone="info" dot={false}>{formatMemoryType(module.memoryType)}</Badge>}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="num text-[26px] font-semibold leading-none text-ink">
          {module.capacityBytes !== null ? formatMemory(module.capacityBytes) : NOT_REPORTED}
        </span>
        {module.speedMTs !== null && (
          <span className="text-[13px] text-muted">{formatSpeed(module.speedMTs)}</span>
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

export const ModulesPanel = memo(function ModulesPanel({ hw }: { hw: JsonResource<MemoryHardwareInfo> }) {
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
          <p className="text-[12px] text-muted">
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
      icon={MemoryStick}
      hue="ram"
      meta={!hw.loading && !problem && modules.length > 0 ? `${modules.length} installed` : undefined}
    >
      {body}
    </Panel>
  );
});

/* ------------------------------------------------------------------ */
/* Health + sources                                                    */
/* ------------------------------------------------------------------ */

export const HealthPanel = memo(function HealthPanel({ health }: { health: JsonResource<MemoryHealth> }) {
  const h = health.data;
  if (health.loading) {
    return (
      <Panel title="Memory health" icon={HeartPulse} hue="ram">
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
    <Panel title="Memory health" icon={HeartPulse} hue="ram">
      {/* Capability, enabled state and live counters are different facts; each shows only what was reported. */}
      <InfoRow label="ECC support" value={yesNo(h?.eccSupport ?? null, 'Supported', 'Not supported')} />
      <InfoRow label="ECC enabled" value={yesNo(h?.eccEnabled ?? null, 'Enabled', 'Disabled')} />
      <InfoRow label="Corrected errors" value={val(h?.correctedErrors, (n) => n.toLocaleString())} />
      <InfoRow label="Uncorrected errors" value={val(h?.uncorrectedErrors, (n) => n.toLocaleString())} />
      {noCounters && (
        <p className="mt-3 text-[12px] text-faint">
          {health.error
            ? "We couldn't read memory health information."
            : safeMessage(h?.note, 'Memory error counters are not available on this system.')}
        </p>
      )}
    </Panel>
  );
});

export const SourcesPanel = memo(function SourcesPanel({
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
    <Panel title="Detection sources" icon={Radar} hue="ram">
      <InfoRow label="Runtime memory" value={runtime} />
      <InfoRow label="Physical modules" value={firmware} />
      <InfoRow label="Platform limits" value={firmware} />
      <InfoRow label="Memory health" value={healthSource} />
      <p className="mt-3 text-[12px] text-faint">
        Each section reads from a different place, so one can be available while another is not.
      </p>
    </Panel>
  );
});
