import type { HardwareSensors, HwDevice } from '../../../types/sensors';
import { formatSensor, limitPercent, limitsText } from '../sensors/model.ts';

/*
  View-model for the live monitor's drive tile. Same readings and rules as the Storage page's "Drive temperatures"
  panel (they read the same /api/system/sensors document): a missing reading is a dash, never 0, and a drive that
  reports nothing is listed with the reason instead of being dropped.
*/

export interface DriveReading {
  label: string;
  value: string;
  /** How close the reading is to the drive's own limit (0..100), or null when the drive gives no limit. */
  percent: number | null;
  limits: string | null;
}

export interface DriveRow {
  id: string;
  name: string;
  detail: string | null;
  /** The hottest temperature among the drive's readings, display-ready; null when none was reported. */
  hottest: string | null;
  readings: DriveReading[];
}

export type DriveTileState =
  | { kind: 'loading' }
  | { kind: 'empty'; note: string }
  | { kind: 'ready'; drives: DriveRow[]; source: string };

export function driveRow(d: HwDevice): DriveRow {
  const temps = d.sensors.filter((s) => s.kind === 'temperature' && s.value !== null && Number.isFinite(s.value));
  const hottest = temps.length > 0 ? Math.max(...temps.map((s) => s.value as number)) : null;
  return {
    id: d.id,
    name: d.name,
    detail: d.detail,
    hottest: hottest === null ? null : formatSensor({ kind: 'temperature', value: hottest }),
    readings: d.sensors.map((s) => ({ label: s.label, value: formatSensor(s), percent: limitPercent(s), limits: limitsText(s) })),
  };
}

export function driveTileState(sensors: HardwareSensors | null): DriveTileState {
  if (!sensors || !sensors.ready) return { kind: 'loading' };
  if (sensors.drives.devices.length === 0) {
    return { kind: 'empty', note: sensors.drives.note ?? 'No drive reported a temperature.' };
  }
  return { kind: 'ready', drives: sensors.drives.devices.map(driveRow), source: sensors.source };
}
