import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { driveRow, driveTileState } from '../src/components/views/overlay/driveModel.ts';
import type { HardwareSensors, HwDevice } from '../src/types/sensors.ts';

const nvme: HwDevice = {
  id: 'nvme0',
  name: 'Samsung SSD 980 PRO 1TB',
  detail: 'nvme0',
  sensors: [
    { label: 'Composite', kind: 'temperature', value: 41.85, unit: '°C', highC: 84.85, criticalC: 89.85 },
    { label: 'Sensor 1', kind: 'temperature', value: 47, unit: '°C', highC: null, criticalC: null },
    { label: 'Sensor 2', kind: 'temperature', value: null, unit: '°C', highC: null, criticalC: null },
  ],
};

const doc = (over: Partial<HardwareSensors> = {}): HardwareSensors => ({
  ready: true,
  platform: 'linux',
  source: 'Linux hwmon',
  sampledAtMs: 0,
  drives: { devices: [nvme], note: null },
  board: { devices: [], note: null },
  memory: { devices: [], note: null },
  ...over,
});

describe('overlay drive tile model', () => {
  it('shows the hottest reading and every sensor, with the drive limits', () => {
    const row = driveRow(nvme);
    assert.equal(row.name, 'Samsung SSD 980 PRO 1TB');
    assert.equal(row.hottest, '47.0 °C');
    assert.deepEqual(row.readings.map((r) => r.value), ['41.9 °C', '47.0 °C', '—']);
    assert.match(row.readings[0].limits ?? '', /^high \d+\.\d °C · critical \d+\.\d °C$/);
    assert.ok(row.readings[0].percent !== null && row.readings[0].percent > 40 && row.readings[0].percent < 50);
    assert.equal(row.readings[1].percent, null);
  });

  it('never turns a missing reading into 0', () => {
    const row = driveRow({ ...nvme, sensors: [{ label: 'Composite', kind: 'temperature', value: null, unit: '°C', highC: null, criticalC: null }] });
    assert.equal(row.hottest, null);
    assert.equal(row.readings[0].value, '—');
  });

  it('is loading until the sensor library is ready', () => {
    assert.deepEqual(driveTileState(null), { kind: 'loading' });
    assert.deepEqual(driveTileState(doc({ ready: false })), { kind: 'loading' });
  });

  it('explains an empty list with the backend note', () => {
    const s = driveTileState(doc({ drives: { devices: [], note: 'Load the drivetemp module.' } }));
    assert.deepEqual(s, { kind: 'empty', note: 'Load the drivetemp module.' });
  });

  it('lists drives when some report', () => {
    const s = driveTileState(doc());
    assert.equal(s.kind, 'ready');
    if (s.kind === 'ready') {
      assert.equal(s.drives.length, 1);
      assert.equal(s.source, 'Linux hwmon');
    }
  });
});
