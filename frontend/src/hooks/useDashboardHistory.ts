import { useState } from 'react';
import type { SystemSnapshot } from '../types/system';

/*
  One client-side ring buffer for every live series the dashboard charts, fed from the snapshot the
  app already polls — no extra requests, and a single state update per poll (the previous
  per-view buffers each updated separately and only started once their page was first opened).
*/
export const HISTORY_POINTS = 40;

export interface DashboardHistory {
  cpu: number[];
  ram: number[];
  rx: number[];
  tx: number[];
  /** Battery charge; empty when the machine has no battery. */
  charge: number[];
}

const EMPTY: DashboardHistory = { cpu: [], ram: [], rx: [], tx: [], charge: [] };

const push = (series: number[], value: number) =>
  series.length >= HISTORY_POINTS ? [...series.slice(1), value] : [...series, value];

function append(history: DashboardHistory, data: SystemSnapshot): DashboardHistory {
  const rx = data.network.reduce((sum, n) => sum + n.rxKBps, 0);
  const tx = data.network.reduce((sum, n) => sum + n.txKBps, 0);
  const charge = data.battery.available ? data.battery.capacityPercent : null;
  return {
    cpu: push(history.cpu, data.cpu.usedPercent),
    ram: push(history.ram, data.ram.usedPercent),
    rx: push(history.rx, rx),
    tx: push(history.tx, tx),
    charge: charge === null ? history.charge : push(history.charge, charge),
  };
}

export function useDashboardHistory(data: SystemSnapshot | null): DashboardHistory {
  // Derived-state pattern: updating state while rendering re-renders immediately, without a second commit.
  const [state, setState] = useState<{ source: SystemSnapshot | null; history: DashboardHistory }>({
    source: null,
    history: EMPTY,
  });
  if (data && data !== state.source) {
    setState({ source: data, history: append(state.history, data) });
  }
  return state.history;
}
