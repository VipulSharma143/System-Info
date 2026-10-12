import { memo } from 'react';
import { BatteryMedium, History, PlugZap, TriangleAlert } from 'lucide-react';
import { useJsonResource } from '../../../hooks/useJsonResource';
import type { BatteryHistory, BatterySession } from '../../../types/batteryHistory';
import Panel from '../../common/Panel';
import { StatTile, TileGrid } from '../../common/Primitives';
import { Callout, EmptyState, LoadingState } from '../../common/States';
import { formatDuration, formatWhen, newestFirst, percentChange, ratePerHour, sessionNotes, summarize } from './historyModel';

const POLL_MS = 30_000;

function SessionRow({ session }: { session: BatterySession }) {
  const charging = session.kind === 'charge';
  const change = percentChange(session);
  const rate = ratePerHour(session);
  const Icon = charging ? PlugZap : BatteryMedium;
  const notes = sessionNotes(session);
  const range = session.startPercent !== null && session.endPercent !== null ? `${session.startPercent}% → ${session.endPercent}%` : null;

  return (
    <li className="flex gap-3 py-3">
      <span className="glyph mt-0.5 shrink-0"><Icon className="h-4 w-4" strokeWidth={2} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[13px] font-medium text-ink">{charging ? 'Charger connected' : 'On battery'}</span>
          <span className="num text-[13px] text-ink">
            {range}
            {change !== null && change !== 0 && <span className="ml-1.5 text-muted">({change > 0 ? '+' : '−'}{Math.abs(change)})</span>}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-muted">
          <span>
            {charging ? 'Plugged in' : 'Unplugged'} {formatWhen(session.startUtc)}
            {session.endUtc ? ` · until ${formatWhen(session.endUtc)}` : ''}
          </span>
          <span className="num">
            {formatDuration(session.durationSec)}
            {rate !== null && ` · ${charging ? 'charged' : 'drained'} ${rate.toFixed(1)}%/h`}
          </span>
        </div>
        {notes.length > 0 && <div className="mt-1 text-[12px] text-faint">{notes.join(' · ')}</div>}
      </div>
    </li>
  );
}

function BatteryHistoryPanel({ active }: { active: boolean }) {
  const history = useJsonResource<BatteryHistory>('/api/battery/history', { active, intervalMs: POLL_MS });

  if (history.error && !history.data) {
    return (
      <Callout tone="warn" icon={TriangleAlert}>
        The battery history could not be loaded. Live battery information above is unaffected.
      </Callout>
    );
  }
  if (!history.data) {
    return <Panel title="Charging history" icon={History} hue="power"><LoadingState label="Loading battery history…" /></Panel>;
  }

  const { sessions, retentionDays } = history.data;
  if (sessions.length === 0) {
    return (
      <Panel title="Charging history" icon={History} hue="power">
        <EmptyState
          icon={History}
          hue="power"
          title="Nothing recorded yet"
          description={`System Info records every time the charger is connected or removed while it is running, and keeps the last ${retentionDays} days.`}
        />
      </Panel>
    );
  }

  const summary = summarize(sessions);
  return (
    <>
      <TileGrid cols={4}>
        <StatTile hue="power" label="Times plugged in" value={String(summary.plugIns)} detail={`Last ${retentionDays} days`} />
        <StatTile hue="power" label="Charged in total" value={String(Math.round(summary.chargedPoints))} unit="%" detail="Added across all charges" />
        <StatTile
          hue="power"
          label="Longest on battery"
          value={summary.longestOnBatterySec !== null ? formatDuration(summary.longestOnBatterySec) : 'None yet'}
          detail="Between two charges"
        />
        <StatTile
          hue="power"
          label="Full battery lasts about"
          value={summary.fullBatteryHours !== null ? summary.fullBatteryHours.toFixed(1) : 'Not enough data'}
          unit={summary.fullBatteryHours !== null ? 'h' : undefined}
          detail={summary.averageDrainPerHour !== null ? `Estimated from your measured ${summary.averageDrainPerHour.toFixed(1)}%/h drain` : 'Needs a stretch of 10+ minutes on battery'}
        />
      </TileGrid>
      <Panel title="Charging history" icon={History} hue="power" meta={`Last ${retentionDays} days`}>
        <ul className="divide-y divide-line">
          {newestFirst(sessions).map((s) => <SessionRow key={`${s.kind}-${s.startUtc}`} session={s} />)}
        </ul>
      </Panel>
    </>
  );
}

export default memo(BatteryHistoryPanel);
