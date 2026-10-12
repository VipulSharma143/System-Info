/** One reading from /api/system/sensors. `kind` is temperature, voltage or fan; `unit` is °C, V or RPM. */
export interface HwSensor {
  label: string;
  kind: 'temperature' | 'voltage' | 'fan';
  value: number | null;
  unit: string;
  highC: number | null;
  criticalC: number | null;
}

export interface HwDevice {
  id: string;
  name: string;
  detail: string | null;
  sensors: HwSensor[];
}

export interface HwCategory {
  devices: HwDevice[];
  /** The reason there are no devices; null when there are some. */
  note: string | null;
}

export interface HardwareSensors {
  /** False while the Windows sensor library is still opening. */
  ready: boolean;
  platform: string;
  source: string;
  sampledAtMs: number;
  drives: HwCategory;
  board: HwCategory;
  memory: HwCategory;
}
