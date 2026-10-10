import { memo, type ReactNode } from 'react';
import { Activity as ActivityIcon, Gauge as GaugeIcon, Microchip, Thermometer } from 'lucide-react';

import type { CpuDetail } from '../../../types/cpu';
import Panel from '../../common/Panel';
import UsageBar from '../../common/UsageBar';
import { Badge, InfoRow, Unavailable } from '../../common/Primitives';
import { formatClock, formatTemp, num } from '../overlay/model';
import {
  cacheLabel, cacheValue, cpuSourceLabel, featureBadges, formatCount, formatRate, formatWatts, missingFrequencyReason, timeSegments,
} from './model';

/** A spec row: the value when the machine reported it, otherwise "Unavailable" with the reason on hover. */
function Row({ label, value, reason, hint }: { label: string; value: ReactNode | null | undefined; reason?: string; hint?: string }) {
  const missing = value === null || value === undefined || value === '';
  return <InfoRow label={label} value={missing ? <Unavailable reason={reason} /> : value} hint={missing ? undefined : hint} />;
}

const ClockText = (mhz: number | null) => formatClock(mhz);

/* ----------------------------------------------------------------------------------- Temperature */

export const TemperaturePanel = memo(function TemperaturePanel({ detail }: { detail: CpuDetail }) {
  const { live, sensors, throttle } = detail;
  const throttleKnown = num(throttle.packageEvents) || num(throttle.coreEvents);
  const throttleReason = detail.platform === 'windows' ? 'Windows does not count thermal throttling events.' : 'This processor’s driver does not report throttling.';
  return (
    <Panel title="Temperature" icon={Thermometer} hue="cpu">
      <Row label="CPU temperature" value={formatTemp(live?.temperatureC ?? null)} reason={live?.temperatureNote ?? 'This computer does not report a CPU temperature.'}
        hint={num(live?.temperatureC) ? `from ${cpuSourceLabel(live?.temperatureSource ?? null) ?? 'the system sensor'}` : undefined} />
      {sensors.length > 0 ? (
        <ul className="mt-2 space-y-2.5">
          {sensors.map((s, i) => {
            const limit = s.criticalC ?? s.highC;
            return (
              <li key={`${s.label}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[12px]">
                <span className="truncate text-muted">{s.label ?? 'Sensor'}</span>
                <span className="num text-right font-medium text-ink">{formatTemp(s.tempC)}</span>
                {num(limit) && num(s.tempC) && <div className="col-span-2"><UsageBar percent={(s.tempC / limit) * 100} compact hue="cpu" hideValue /></div>}
                {(num(s.highC) || num(s.criticalC)) && (
                  <span className="col-span-2 text-[11px] text-faint">
                    {[num(s.highC) ? `high ${formatTemp(s.highC)}` : null, num(s.criticalC) ? `critical ${formatTemp(s.criticalC)}` : null].filter(Boolean).join(' · ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {detail.sensorsNote && <p className="mt-3 text-[12px] leading-relaxed text-muted">{detail.sensorsNote}</p>}
      <div className="mt-3 border-t border-line pt-1">
        <Row label="Thermal throttling" reason={throttleReason}
          value={throttleKnown ? `${formatCount(throttle.packageEvents) ?? DASH} package${num(throttle.coreEvents) ? ` · ${formatCount(throttle.coreEvents)} core` : ''} since boot` : null} />
      </div>
    </Panel>
  );
});
const DASH = '—';

/* ----------------------------------------------------------------------------------- Frequency and power */

export const FrequencyPanel = memo(function FrequencyPanel({ detail }: { detail: CpuDetail }) {
  const { frequency: f, live, power } = detail;
  const limits = [num(power.limit1Watts) ? `sustained ${formatWatts(power.limit1Watts)}` : null, num(power.limit2Watts) ? `burst ${formatWatts(power.limit2Watts)}` : null].filter(Boolean);
  return (
    <Panel title="Clock speed and power" icon={GaugeIcon} hue="cpu">
      <Row label="Current (average)" value={ClockText(live?.clockMhz ?? null)} reason="No thread has reported a clock yet." />
      <Row label="Fastest thread now" value={ClockText(live?.highestClockMhz ?? null)} reason="No thread has reported a clock yet." />
      <Row label="Base clock" value={ClockText(f.baseMhz)} reason={missingFrequencyReason(detail, 'base')}
        hint={f.baseSource ? `from ${cpuSourceLabel(f.baseSource)}` : undefined} />
      <Row label="Maximum boost" value={ClockText(f.maxMhz)} reason={missingFrequencyReason(detail, 'max')}
        hint={f.maxSource ? `from ${cpuSourceLabel(f.maxSource)}` : undefined} />
      <Row label="Minimum" value={ClockText(f.minMhz)} reason={missingFrequencyReason(detail, 'min')} />
      {detail.platform === 'linux' && (
        <>
          <Row label="Policy limit" value={ClockText(f.policyMaxMhz)} reason={missingFrequencyReason(detail, 'policy')} />
          <Row label="Governor" value={f.governor} reason={missingFrequencyReason(detail, 'policy')} hint={f.driver ? `(${f.driver})` : undefined} />
          <Row label="Energy preference" value={f.preference} reason="This frequency driver has no energy preference." />
          <Row label="Boost" value={f.boost === null ? null : f.boost ? 'Allowed' : 'Disabled'} reason="The kernel does not say whether boost is enabled." />
        </>
      )}
      <div className="mt-2 border-t border-line pt-1">
        <Row label="Package power" value={formatWatts(power.packageWatts)} reason={power.note ?? 'Not reported on this computer.'}
          hint={num(power.packageWatts) && power.source ? `from ${cpuSourceLabel(power.source)}` : undefined} />
        <Row label="Power limits" value={limits.length ? limits.join(' · ') : null} reason="The processor’s power limits are not readable here." />
      </div>
    </Panel>
  );
});

/* ----------------------------------------------------------------------------------- Specifications */

export const SpecsPanel = memo(function SpecsPanel({ detail }: { detail: CpuDetail }) {
  const { identity: i, topology: t, caches } = detail;
  const family = [i.family, i.modelId, i.stepping];
  const features = featureBadges(detail.features);
  return (
    <Panel title="Specifications" icon={Microchip} hue="cpu">
      <Row label="Processor" value={i.model} reason="The system did not report a processor name." />
      <Row label="Vendor" value={i.vendor} />
      <Row label="Architecture" value={i.architecture} />
      <Row label="Family · model · stepping" value={family.every(num) ? family.join(' · ') : null} reason="Not reported by this processor." />
      <Row label="Sockets" value={num(t.packages) ? t.packages : null} />
      <Row label="Physical cores" value={num(t.physicalCores) ? t.physicalCores : null} />
      <Row label="Logical processors" value={num(t.logicalProcessors) ? t.logicalProcessors : null} />
      {num(t.performanceCores) && num(t.efficiencyCores) && (
        <Row label="Performance · efficiency cores" value={`${t.performanceCores} · ${t.efficiencyCores}${num(t.lowPowerCores) ? ` · ${t.lowPowerCores} low-power` : ''}`} />
      )}
      <Row label="Runs on" value={i.virtualized === null ? null : i.virtualized ? 'A virtual machine' : 'Physical hardware'} reason="Not reported." />
      {caches.length > 0 && (
        <div className="mt-2 border-t border-line pt-1">
          {caches.map((c) => {
            const v = cacheValue(c);
            return <Row key={`${c.level}-${c.type}`} label={cacheLabel(c)} value={v.total} hint={v.split ?? undefined} />;
          })}
        </div>
      )}
      {features.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-[12px] text-muted">Instruction sets and features</p>
          <div className="flex flex-wrap gap-1.5">{features.map((f) => <Badge key={f} tone="muted" dot={false}>{f}</Badge>)}</div>
        </div>
      )}
    </Panel>
  );
});

/* ----------------------------------------------------------------------------------- Activity */

export const ActivityPanel = memo(function ActivityPanel({ detail }: { detail: CpuDetail }) {
  const a = detail.activity;
  const segments = timeSegments(detail.time);
  const load = [a.load1, a.load5, a.load15];
  return (
    <Panel title="Where the time goes" icon={ActivityIcon} hue="cpu" meta="since the last update">
      {segments.length > 0 ? (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-3" role="img"
            aria-label={segments.map((s) => `${s.label} ${s.percent.toFixed(0)} percent`).join(', ')}>
            {segments.filter((s) => s.key !== 'idlePercent').map((s) => (
              <span key={s.key} style={{ width: `${s.percent}%`, background: s.color, transition: 'width 400ms ease' }} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {segments.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-[12px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color, border: s.key === 'idlePercent' ? '1px solid var(--line)' : undefined }} />
                <span className="truncate text-muted">{s.label}</span>
                <span className="num ml-auto text-ink">{s.percent.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="text-[12px] text-faint">The breakdown appears after the second reading.</p>}

      <div className="mt-3 border-t border-line pt-1">
        <Row label="Load average (1 · 5 · 15 min)" value={load.every(num) ? load.map((v) => v.toFixed(2)).join(' · ') : null}
          reason={detail.platform === 'windows' ? 'Windows has no load average.' : 'Not reported.'} />
        <Row label={detail.platform === 'windows' ? 'Processor queue' : 'Runnable tasks'}
          value={formatCount(detail.platform === 'windows' ? a.queueLength : a.runnableTasks)} reason="Not reported." />
        <Row label="Threads" value={formatCount(a.threads)} />
        <Row label="Processes" value={formatCount(a.processes)} reason={detail.platform === 'linux' ? 'Counted on the Processes tab.' : undefined} />
        <Row label="Context switches" value={formatRate(a.contextSwitchesPerSec)} reason="Appears after the second reading." />
        <Row label="Interrupts" value={formatRate(a.interruptsPerSec)} reason="Appears after the second reading." />
        {detail.platform === 'windows' && <Row label="System calls" value={formatRate(a.systemCallsPerSec)} reason="Appears after the second reading." />}
      </div>
    </Panel>
  );
});
