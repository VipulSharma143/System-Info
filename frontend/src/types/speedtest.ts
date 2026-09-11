export interface SpeedMeasurement {
  mbps: number;
  mbPerSecond: number;
}

export interface SpeedTestResult {
  download: SpeedMeasurement;
  upload: SpeedMeasurement;
  pingMs: number;
}