import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSensor, limitPercent, limitsText, temperatureLimit } from '../src/components/views/sensors/model.ts';
import { busiestCore, hottestCore } from '../src/components/views/cpu/model.ts';
import type { CpuCore, CpuSensor } from '../src/types/cpu.ts';
import type { HwSensor } from '../src/types/sensors.ts';

const temp = (over: Partial<HwSensor> = {}): HwSensor => ({ label: 'Composite', kind: 'temperature', value: 41.8, unit: '°C', highC: null, criticalC: null, ...over });

describe('formatSensor', () => {
  it('formats each kind the way people read it', () => {
    assert.equal(formatSensor(temp()), '41.8 °C');
    assert.equal(formatSensor({ kind: 'voltage', value: 1.008 }), '1.008 V');
    assert.equal(formatSensor({ kind: 'fan', value: 1200 }), '1,200 RPM');
    assert.equal(formatSensor({ kind: 'fan', value: 0 }), '0 RPM', 'a stopped fan is a real reading');
  });
  it('shows a dash, never a number, when there is no value', () => {
    assert.equal(formatSensor(temp({ value: null })), '—');
    assert.equal(formatSensor({ kind: 'fan', value: Number.NaN }), '—');
  });
});

describe('temperature limits', () => {
  it('prefers the critical limit, falls back to the high one, and has none for other kinds', () => {
    assert.equal(temperatureLimit(temp({ highC: 70, criticalC: 85 })), 85);
    assert.equal(temperatureLimit(temp({ highC: 70 })), 70);
    assert.equal(temperatureLimit(temp()), null);
    assert.equal(temperatureLimit({ kind: 'voltage', highC: 70, criticalC: 85 }), null);
  });
  it('turns a reading into a bar only when there is a limit, clamped to 0..100', () => {
    assert.equal(limitPercent(temp({ value: 42.5, criticalC: 85 })), 50);
    assert.equal(limitPercent(temp({ value: 95, criticalC: 85 })), 100);
    assert.equal(limitPercent(temp()), null);
    assert.equal(limitPercent(temp({ value: null, criticalC: 85 })), null);
  });
  it('describes only the limits that exist', () => {
    assert.equal(limitsText(temp({ highC: 84.8, criticalC: 89.8 })), 'high 84.8 °C · critical 89.8 °C');
    assert.equal(limitsText(temp({ criticalC: 89.8 })), 'critical 89.8 °C');
    assert.equal(limitsText(temp()), null);
    assert.equal(limitsText({ kind: 'fan', highC: 1, criticalC: 2 }), null);
  });
});

const core = (index: number, over: Partial<CpuCore> = {}): CpuCore => ({ index, coreKey: null, kind: null, usagePercent: null, mhz: null, temperatureC: null, ...over });
const sensor = (label: string, kind: string, tempC: number | null): CpuSensor => ({ label, kind, coreKey: null, tempC, highC: null, criticalC: null });

describe('hottestCore', () => {
  it('picks the hottest per-core sensor and ignores the package and chiplet sensors', () => {
    const hot = hottestCore([sensor('CPU Package', 'package', 95), sensor('Core #1', 'core', 61), sensor('Core #2', 'core', 74), sensor('CCD1 (Tdie)', 'ccd', 99)]);
    assert.deepEqual(hot, { label: 'Core #2', tempC: 74 });
  });
  it('is null when no core reports a temperature', () => {
    assert.equal(hottestCore([]), null);
    assert.equal(hottestCore([sensor('CPU Package', 'package', 60), sensor('Core #1', 'core', null)]), null);
  });
});

describe('busiestCore', () => {
  it('picks the physical core with the highest mean load and reports its fastest thread', () => {
    const busy = busiestCore([
      core(0, { coreKey: 0, usagePercent: 10, mhz: 3000 }), core(1, { coreKey: 0, usagePercent: 20, mhz: 3100 }),
      core(2, { coreKey: 1, usagePercent: 90, mhz: 4500 }), core(3, { coreKey: 1, usagePercent: 70, mhz: 4700 }),
    ]);
    assert.deepEqual(busy, { label: 'Core 1', usagePercent: 80, mhz: 4700, temperatureC: null });
  });
  it('carries a temperature only when the hardware reports one for that core', () => {
    assert.equal(busiestCore([core(0, { coreKey: 0, usagePercent: 50, temperatureC: 67 }), core(1, { coreKey: 1, usagePercent: 10, temperatureC: 90 })])?.temperatureC, 67);
    assert.equal(busiestCore([core(0, { coreKey: 0, usagePercent: 50 })])?.temperatureC, null);
  });
  it('treats an unmeasured load as unknown, never as 0%, and gives null when nothing was measured', () => {
    assert.equal(busiestCore([core(0), core(1)]), null);
    assert.equal(busiestCore([]), null);
    assert.equal(busiestCore([core(0, { coreKey: 0 }), core(1, { coreKey: 1, usagePercent: 0 })])?.label, 'Core 1');
  });
  it('labels Linux core keys by the OS core number', () => {
    assert.equal(busiestCore([core(0, { coreKey: 100003, usagePercent: 40 })])?.label, 'Core 3');
  });
});
