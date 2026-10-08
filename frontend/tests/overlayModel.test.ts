import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cpuView, gpuLabel, gpuView, groupCores, loadState, memoryView, orderGpus, topologyLabel } from '../src/components/views/overlay/model.ts';
import type { CpuCoreReading, CpuDetail, GpuAdapter, RamDetails } from '../src/types/system.ts';

const core = (index: number, usage: number | null, type: 'performance' | 'efficiency' | null): CpuCoreReading =>
  ({ index, usagePercent: usage, clockMhz: null, temperatureC: null, coreId: index, coreType: type });

const detail = (cores: CpuCoreReading[], extra: Partial<CpuDetail> = {}): CpuDetail => ({
  totalUsagePercent: 38, cores, averageClockMhz: null, highestClockMhz: null, baseClockMhz: null, maxClockMhz: null,
  packageTemperatureC: null, powerWatts: null, loadAverage: null, temperatureSource: null, note: null, sampledAtUnixMs: 1, ...extra,
});

describe('cpuView', () => {
  const hybrid = [...Array.from({ length: 12 }, (_, i) => core(i, i < 3 ? 50 : 2, 'performance')), ...Array.from({ length: 8 }, (_, i) => core(12 + i, 0, 'efficiency'))];
  const layout = { logicalProcessors: 20, physicalCores: 14, hybrid: true, performanceCores: 6, efficiencyCores: 8, performanceThreads: 12, efficiencyThreads: 8 };

  it('describes a 6P + 8E hybrid CPU from the reported layout', () => {
    const view = cpuView(detail(hybrid, { layout }), null, null);
    assert.equal(topologyLabel(view), '6P + 8E · 14 cores · 20 threads');
    assert.equal(view.active, 3);
    assert.equal(view.measured, 20);
  });
  it('never shows a temperature that was not reported', () => {
    const view = cpuView(detail(hybrid, { systemTemperatureC: 28 }), null, null);
    assert.equal(view.packageTemperature, null);
    assert.equal(view.systemTemperature, 28);
  });
  it('does not claim a P/E split without a layout', () => {
    const view = cpuView(detail([core(0, 5, null), core(1, 5, null)]), 1, 2);
    assert.equal(view.hybrid, false);
    assert.equal(topologyLabel(view), '1 cores · 2 threads');
  });
  it('reports active processors as unknown while nothing is measured', () => {
    assert.equal(cpuView(detail([core(0, null, null)]), null, null).active, null);
    assert.equal(cpuView(null, null, null).status, 'unavailable');
  });
});

describe('groupCores', () => {
  it('groups a typed CPU by core type and leaves an untyped one whole', () => {
    assert.deepEqual(groupCores([core(0, 1, 'performance'), core(1, 1, 'efficiency')]).map((g) => g.key), ['performance', 'efficiency']);
    assert.deepEqual(groupCores([core(0, 1, null), core(1, 1, null)]).map((g) => g.key), ['all']);
    assert.deepEqual(groupCores([]), []);
  });
});

describe('loadState', () => {
  it('maps utilisation to a word and null to null', () => {
    assert.equal(loadState(0), 'Idle');
    assert.equal(loadState(55), 'Moderate');
    assert.equal(loadState(95), 'Saturated');
    assert.equal(loadState(undefined), null);
  });
});

describe('gpuView', () => {
  const adapter = { id: 'g0', index: 0, name: 'RTX 4060 Laptop', vendor: 'NVIDIA', integrated: false, dedicatedMemoryBytes: 8 * 1024 ** 3 } as GpuAdapter;
  it('keeps 8 GB of VRAM as 64-bit arithmetic', () => {
    const view = gpuView(adapter, { id: 'g0', memoryUsedBytes: 2 * 1024 ** 3, memoryTotalBytes: 8 * 1024 ** 3 } as never);
    assert.equal(view.vramTotalBytes, 8 * 1024 ** 3);
    assert.equal(view.vramFreeBytes, 6 * 1024 ** 3);
    assert.equal(view.vramPercent, 25);
  });
  it('shows no available VRAM when usage is unknown', () => {
    const view = gpuView(adapter, undefined);
    assert.equal(view.vramFreeBytes, null);
    assert.equal(view.status, 'no-live-data');
  });
});

describe('memoryView', () => {
  const ram = { totalBytes: 16, usedBytes: 6, availableBytes: 10, freeBytes: null, cachedBytes: null, buffersBytes: null, swapTotalBytes: 8, swapUsedBytes: 2, usedPercent: 37.5 } as RamDetails;
  it('derives swap availability and leaves unknown fields null', () => {
    const view = memoryView(ram)!;
    assert.equal(view.swapFree, 6);
    assert.equal(view.swapPercent, 25);
    assert.equal(view.free, null);
    assert.equal(memoryView(null), null);
  });
  it('has no swap figures when there is no swap', () => {
    const view = memoryView({ ...ram, swapTotalBytes: 0, swapUsedBytes: 0 })!;
    assert.equal(view.swapFree, null);
    assert.equal(view.swapPercent, null);
  });
});

describe('hybrid GPU rows', () => {
  const adapter = (id: string, integrated: boolean) => ({ id, index: 0, name: id, vendor: null, integrated, dedicatedMemoryBytes: null }) as GpuAdapter;
  it('keeps each GPU independent, integrated first, and never copies one reading to the other', () => {
    const igpu = gpuView(adapter('igpu', true), { id: 'igpu', utilizationPercent: 8 } as never);
    const dgpu = gpuView(adapter('dgpu', false), { id: 'dgpu', utilizationPercent: 94 } as never);
    const rows = orderGpus([dgpu, igpu]);
    assert.deepEqual(rows.map((g) => [gpuLabel(g, 2), g.usage]), [['Integrated GPU', 8], ['Discrete GPU', 94]]);
  });
  it('shows unknown, not 0, for a GPU with no reading', () => {
    const view = gpuView(adapter('dgpu', false), { id: 'dgpu', utilizationPercent: null, temperatureC: null } as never);
    assert.equal(view.usage, null);
    assert.equal(view.temperature, null);
    assert.equal(gpuLabel(view, 1), 'GPU');
  });
  it('counts busy threads per core type', () => {
    const cores = [core(0, 50, 'performance'), core(1, 2, 'performance'), core(2, 30, 'efficiency')];
    const view = cpuView(detail(cores), null, null);
    assert.equal(view.performanceActive, 1);
    assert.equal(view.efficiencyActive, 1);
  });
});
