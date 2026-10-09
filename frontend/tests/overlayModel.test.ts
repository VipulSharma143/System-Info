import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTiles, coreCells, engineLabel, formatClock, formatPair, formatPower, formatTemp, liveState, measured, sourceLabel, sourceProblems,
} from '../src/components/views/overlay/model.ts';
import type { OverlayGpu, OverlaySnapshot } from '../src/types/overlay.ts';

const GIB = 1024 ** 3;

const gpu = (over: Partial<OverlayGpu> = {}): OverlayGpu => ({
  id: 'gpu-a', name: 'Test GPU', luid: null, vendor: 'NVIDIA', kind: 'discrete', pciAddress: null, driverVersion: '576.80',
  utilizationPercent: 71, temperatureC: 67, memoryUsedBytes: 3 * GIB, memoryTotalBytes: 8 * GIB, memoryPercent: 37.5,
  powerWatts: 62.4, powerLimitWatts: 115, coreClockMhz: 2370, memoryClockMhz: 8000, fanPercent: null, performanceState: 'P0',
  engines: [{ name: '3D', percent: 71 }], source: { utilization: 'nvml', temperature: 'nvml', memory: 'nvml' }, note: null, ...over,
});

const snapshot = (over: Partial<OverlaySnapshot> = {}): OverlaySnapshot => ({
  schema: 1, seq: 5, sampledAtMs: 1_000_000, intervalMs: 500, platform: 'windows',
  engine: { isa: 2, asmDemotions: 0, cycleMs: 1.2, nvml: 'ok', gpuCounters: 'ok' },
  cpu: { usagePercent: 33.3, temperatureC: null, temperatureSource: null, temperatureNote: 'No sensor.', clockMhz: 3200, logicalProcessors: 2, busiestCorePercent: 50, activeCores: 1,
    cores: [{ u: 50, mhz: 3300 }, { u: null, mhz: null }], note: null },
  ram: { totalBytes: 16 * GIB, usedBytes: 8 * GIB, availableBytes: 8 * GIB, usedPercent: 50, cachedBytes: null, swapTotalBytes: 0, swapUsedBytes: 0 },
  gpus: [gpu()],
  history: { intervalMs: 500, cpu: [1, null, 3], cpuTemp: [], ram: [50], gpus: { 'gpu-a': { usage: [70, 71], temp: [66, 67], memory: [37] } } },
  ...over,
});

describe('formatting never invents a value', () => {
  it('null stays null', () => {
    assert.equal(formatTemp(null), null);
    assert.equal(formatClock(null), null);
    assert.equal(formatClock(0), null);
    assert.equal(formatPair(null, 8 * GIB), null);
    assert.equal(formatPower(null, 115), null);
  });
  it('formats real values', () => {
    assert.equal(formatTemp(66.6), '67 °C');
    assert.equal(formatClock(2370), '2.37 GHz');
    assert.equal(formatClock(800), '800 MHz');
    assert.equal(formatPair(3 * GIB, 8 * GIB), '3.0 / 8.0 GB');
    assert.equal(formatPower(62.4, 115), '62 / 115 W');
    assert.equal(formatPower(62.4, null), '62 W');
  });
  it('labels where a number came from', () => {
    assert.equal(sourceLabel('nvml'), 'NVIDIA driver');
    assert.equal(sourceLabel('windows-counters'), 'Windows counters');
    assert.equal(sourceLabel(null), null);
    assert.equal(sourceLabel('something-new'), 'something-new');
  });
  it('drops gaps from a series but keeps real zeros', () => {
    assert.deepEqual(measured([1, null, 0, 3]), [1, 0, 3]);
    assert.deepEqual(measured(undefined), []);
  });
  it('names the engine tier', () => {
    assert.deepEqual([2, 1, 0].map(engineLabel), ['AVX2', 'SSE2', 'portable']);
  });
});

describe('liveState', () => {
  const s = { sampledAtMs: 100_000, intervalMs: 500 };
  it('is live within a couple of heartbeats', () => {
    assert.equal(liveState(s, 100_000 + 1500), 'live');
    assert.equal(liveState(s, 100_000 + 4000), 'live');
  });
  it('turns slow, then stopped, as samples stop arriving', () => {
    assert.equal(liveState(s, 100_000 + 6000), 'lagging');
    assert.equal(liveState(s, 100_000 + 11_000), 'stalled');
    assert.equal(liveState(null, 1), 'stalled');
  });
});

describe('buildTiles', () => {
  it('orders CPU, then discrete before integrated graphics, then memory', () => {
    const tiles = buildTiles(snapshot({ gpus: [gpu({ id: 'igpu', kind: 'integrated', name: 'iGPU' }), gpu({ id: 'dgpu', name: 'dGPU' })] }));
    assert.deepEqual(tiles.map((t) => t.id), ['cpu', 'dgpu', 'igpu', 'ram']);
  });
  it('keeps an unknown load null, not 0', () => {
    const tiles = buildTiles(snapshot({ cpu: { ...snapshot().cpu, usagePercent: null, logicalProcessors: 0, cores: [] } }));
    assert.equal(tiles[0].percent, null);
    assert.equal(tiles[0].subtitle, 'Measuring…');
  });
  it('explains a missing CPU temperature instead of showing a number', () => {
    const cpu = buildTiles(snapshot())[0];
    const temp = cpu.stats.find((s) => s.label === 'Temperature')!;
    assert.equal(temp.value, null);
    assert.equal(temp.hint, 'No sensor.');
    assert.ok(cpu.notes.includes('No sensor.'));
  });
  it('shows a GPU with its readings and where they came from', () => {
    const tile = buildTiles(snapshot())[1];
    const by = (label: string) => tile.stats.find((s) => s.label === label)?.value;
    assert.equal(tile.percent, 71);
    assert.equal(by('Temperature'), '67 °C');
    assert.equal(by('Video memory'), '3.0 / 8.0 GB');
    assert.equal(by('Power'), '62 / 115 W');
    assert.deepEqual(tile.sources, ['NVIDIA driver']);
    assert.deepEqual(tile.history, [70, 71]);
    assert.equal(tile.subtitle, 'Discrete · driver 576.80');
  });
  it('lists every distinct source of a hybrid GPU reading', () => {
    const tile = buildTiles(snapshot({ gpus: [gpu({ source: { utilization: 'windows-counters', temperature: null, memory: 'windows-counters' }, temperatureC: null })] }))[1];
    assert.deepEqual(tile.sources, ['Windows counters']);
    assert.equal(tile.stats.find((s) => s.label === 'Temperature')!.value, null);
  });
  it('hides swap when the system has none', () => {
    const ram = buildTiles(snapshot())[2];
    assert.equal(ram.stats.find((s) => s.label.startsWith('Swap'))!.value, null);
    assert.equal(ram.subtitle, '8.0 / 16.0 GB');
  });
  it('keeps unknown processors as null cells', () => {
    const cells = coreCells(snapshot().cpu);
    assert.deepEqual(cells.map((c) => c.percent), [50, null]);
    assert.equal(cells[0].clock, '3.30 GHz');
  });
});

describe('sourceProblems', () => {
  it('reports a missing NVIDIA driver only when an NVIDIA GPU is present', () => {
    const missing = snapshot({ engine: { ...snapshot().engine, nvml: 'NVIDIA management library (nvml) was not found.' } });
    assert.deepEqual(sourceProblems(missing), ['NVIDIA management library (nvml) was not found.']);
    assert.deepEqual(sourceProblems({ ...missing, gpus: [gpu({ vendor: 'AMD' })] }), []);
  });
  it('reports counters that could not be opened on Windows, not on Linux', () => {
    const bad = snapshot({ engine: { ...snapshot().engine, gpuCounters: 'Windows GPU load counters are not available.' } });
    assert.equal(sourceProblems(bad).length, 1);
    assert.deepEqual(sourceProblems({ ...bad, platform: 'linux' }), []);
  });
});
