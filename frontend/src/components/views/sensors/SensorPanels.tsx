import { memo } from 'react';
import { Cpu, HardDrive, MemoryStick, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useJsonResource } from '../../../hooks/useJsonResource';
import type { HardwareSensors, HwCategory } from '../../../types/sensors';
import type { Hue } from '../../../lib/hues';
import Panel from '../../common/Panel';
import UsageBar from '../../common/UsageBar';
import { Callout, LoadingState } from '../../common/States';
import { formatSensor, limitPercent, limitsText } from './model';

const POLL_MS = 5000;

function useSensors(active: boolean) {
  return useJsonResource<HardwareSensors>('/api/system/sensors', { active, intervalMs: POLL_MS });
}

interface PanelProps {
  title: string;
  icon: LucideIcon;
  hue: Hue;
  pick: (s: HardwareSensors) => HwCategory;
  active: boolean;
}

/** One panel per kind of device; each device lists its sensors, or the panel says why there are none. */
const DevicePanel = memo(function DevicePanel({ title, icon, hue, pick, active }: PanelProps) {
  const sensors = useSensors(active);
  if (sensors.error && !sensors.data) {
    return <Callout tone="warn" icon={TriangleAlert}>{title} could not be loaded. The rest of this page is unaffected.</Callout>;
  }
  if (!sensors.data) return <Panel title={title} icon={icon} hue={hue}><LoadingState label="Reading sensors…" /></Panel>;

  const category = pick(sensors.data);
  if (!sensors.data.ready) return <Panel title={title} icon={icon} hue={hue}><LoadingState label="Reading sensors…" /></Panel>;
  if (category.devices.length === 0) {
    return (
      <Panel title={title} icon={icon} hue={hue}>
        <p className="text-[13px] leading-relaxed text-muted">{category.note ?? 'No sensors were reported.'}</p>
      </Panel>
    );
  }
  return (
    <Panel title={title} icon={icon} hue={hue} meta={`from ${sensors.data.source}`}>
      <div className="space-y-4">
        {category.devices.map((d) => (
          <section key={d.id}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="truncate text-[13px] font-medium text-ink">{d.name}</h3>
              {d.detail && <span className="shrink-0 text-[11px] text-faint">{d.detail}</span>}
            </div>
            <ul className="mt-2 space-y-2.5">
              {d.sensors.map((s, i) => {
                const percent = limitPercent(s);
                const limits = limitsText(s);
                return (
                  <li key={`${s.label}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[12px]">
                    <span className="truncate text-muted">{s.label}</span>
                    <span className="num text-right font-medium text-ink">{formatSensor(s)}</span>
                    {percent !== null && <div className="col-span-2"><UsageBar percent={percent} compact hue={hue} hideValue /></div>}
                    {limits && <span className="col-span-2 text-[11px] text-faint">{limits}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
});

export const DriveTemperaturesPanel = ({ active }: { active: boolean }) => (
  <DevicePanel title="Drive temperatures" icon={HardDrive} hue="disk" pick={(s) => s.drives} active={active} />
);
export const BoardSensorsPanel = ({ active }: { active: boolean }) => (
  <DevicePanel title="Motherboard sensors" icon={Cpu} hue="sys" pick={(s) => s.board} active={active} />
);
export const MemoryModulesPanel = ({ active }: { active: boolean }) => (
  <DevicePanel title="Memory module temperatures" icon={MemoryStick} hue="ram" pick={(s) => s.memory} active={active} />
);
