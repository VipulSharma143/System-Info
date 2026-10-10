import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cacheLabel, cacheValue, cpuSourceLabel, describeCoreCounts, describeHybrid, formatCount, formatRate, formatWatts, groupCores,
  missingFrequencyReason, timeSegments,
} from '../src/components/views/cpu/model.ts';
import type { CpuCore, CpuDetail } from '../src/types/cpu.ts';

const core = (index: number, over: Partial<CpuCore> = {}): CpuCore => ({ index, coreKey: null, kind: null, usagePercent: null, mhz: null, temperatureC: null, ...over });

const detail = (over: Partial<CpuDetail> = {}): CpuDetail => ({
  platform: 'linux', sampledAtMs: 1, intervalMs: 500, detailSampledAtMs: 1,
  identity: { model: 'Test CPU', vendor: 'GenuineIntel', architecture: 'x86-64', family: 6, modelId: 154, stepping: 3, virtualized: false },
  topology: { packages: 1, physicalCores: 4, logicalProcessors: 6, performanceCores: 2, efficiencyCores: 2, lowPowerCores: null },
  live: null, cores: [],
  frequency: { baseMhz: null, baseSource: null, maxMhz: null, maxSource: null, minMhz: null, policyMaxMhz: null, governor: null, driver: null, preference: null, boost: null },
  caches: [], features: [], sensors: [], sensorsNote: null,
  power: { packageWatts: null, limit1Watts: null, limit2Watts: null, source: null, note: null },
  throttle: { packageEvents: null, coreEvents: null },
  time: { userPercent: null, systemPercent: null, idlePercent: null, iowaitPercent: null, irqPercent: null, stealPercent: null },
  activity: { load1: null, load5: null, load15: null, runnableTasks: null, queueLength: null, threads: null, processes: null, contextSwitchesPerSec: null, interruptsPerSec: null, systemCallsPerSec: null },
  history: { intervalMs: 500, usage: [], temperature: [] },
  ...over,
});

describe('groupCores', () => {
  it('puts SMT siblings of one physical core together and uses the OS core number', () => {
    const groups = groupCores([
      core(0, { coreKey: 0, kind: 'performance', usagePercent: 90, temperatureC: 58 }),
      core(1, { coreKey: 0, kind: 'performance', usagePercent: 10, temperatureC: 58 }),
      core(2, { coreKey: 8, kind: 'efficiency', usagePercent: 5 }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, 'Core 0');
    assert.equal(groups[0].threads.length, 2);
    assert.equal(groups[0].usagePercent, 50);
    assert.equal(groups[0].temperatureC, 58);
    assert.equal(groups[1].label, 'Core 8');
    assert.equal(groups[1].temperatureC, null);
  });

  it('strips the package from Linux core keys (package * 100000 + core)', () => {
    assert.equal(groupCores([core(0, { coreKey: 100003 })])[0].label, 'Core 3');
  });

  it('a core whose threads were not measured has no load — not 0', () => {
    const [g] = groupCores([core(0, { coreKey: 1 }), core(1, { coreKey: 1 })]);
    assert.equal(g.usagePercent, null);
  });

  it('measured threads are averaged; unmeasured ones are skipped, not counted as 0', () => {
    const [g] = groupCores([core(0, { coreKey: 1, usagePercent: 80 }), core(1, { coreKey: 1 })]);
    assert.equal(g.usagePercent, 80);
  });

  it('threads with no known core stand alone, in order', () => {
    const groups = groupCores([core(0), core(1)]);
    assert.deepEqual(groups.map((g) => g.label), ['Thread 0', 'Thread 1']);
  });
});

describe('caches', () => {
  it('names and splits', () => {
    assert.equal(cacheLabel({ level: 1, type: 'Data' }), 'L1 data cache');
    assert.equal(cacheLabel({ level: 3, type: 'Unified' }), 'L3 cache');
    assert.deepEqual(cacheValue({ level: 1, type: 'Data', totalBytes: 4 * 48 * 1024, instances: 4, perInstanceBytes: 48 * 1024 }), { total: '192 KB', split: '4 × 48 KB' });
    assert.deepEqual(cacheValue({ level: 1, type: 'Data', totalBytes: 160 * 1024, instances: 4, perInstanceBytes: null }), { total: '160 KB', split: '4 caches' });
    assert.deepEqual(cacheValue({ level: 3, type: 'Unified', totalBytes: 12 * 1024 * 1024, instances: 1, perInstanceBytes: 12 * 1024 * 1024 }), { total: '12 MB', split: null });
    assert.deepEqual(cacheValue({ level: 3, type: 'Unified', totalBytes: null, instances: 1, perInstanceBytes: null }), { total: null, split: null });
  });
});

describe('formatting never invents a value', () => {
  it('null stays null', () => {
    assert.equal(formatWatts(null), null);
    assert.equal(formatRate(null), null);
    assert.equal(formatCount(null), null);
    assert.equal(cpuSourceLabel(null), null);
  });
  it('real values read naturally', () => {
    assert.equal(formatWatts(12.34), '12.3 W');
    assert.equal(formatWatts(125.4), '125 W');
    assert.equal(formatRate(850), '850/s');
    assert.equal(formatRate(24_000), '24.0 k/s');
    assert.equal(formatRate(2_500_000), '2.50 M/s');
    assert.equal(formatCount(1234567), '1,234,567');
    assert.equal(cpuSourceLabel('rapl'), 'the processor energy counter');
    assert.equal(cpuSourceLabel('some-new-source'), 'some-new-source');
  });
});

describe('time breakdown', () => {
  it('shows only the parts the platform reports, idle last', () => {
    const s = timeSegments({ userPercent: 20, systemPercent: 10, idlePercent: 70, iowaitPercent: null, irqPercent: 0, stealPercent: null });
    assert.deepEqual(s.map((x) => x.key), ['userPercent', 'systemPercent', 'irqPercent', 'idlePercent']);
  });
  it('nothing reported means no segments', () => {
    assert.deepEqual(timeSegments(detail().time), []);
  });
  it('clamps a stray value into range', () => {
    assert.equal(timeSegments({ ...detail().time, userPercent: 104 })[0].percent, 100);
  });
});

describe('topology text', () => {
  it('counts', () => {
    assert.equal(describeCoreCounts(detail()), '4 cores · 6 threads');
    assert.equal(describeCoreCounts(detail({ topology: { ...detail().topology, physicalCores: 1, logicalProcessors: 1 } })), '1 core · 1 thread');
    assert.equal(describeCoreCounts(detail({ topology: { packages: null, physicalCores: null, logicalProcessors: null, performanceCores: null, efficiencyCores: null, lowPowerCores: null } })), null);
  });
  it('hybrid split is shown only when both kinds exist', () => {
    assert.equal(describeHybrid(detail()), '2 P + 2 E');
    assert.equal(describeHybrid(detail({ topology: { ...detail().topology, lowPowerCores: 2 } })), '2 P + 2 E + 2 LP');
    assert.equal(describeHybrid(detail({ topology: { ...detail().topology, performanceCores: null, efficiencyCores: null } })), null);
  });
});

describe('why a figure is missing is specific to the platform', () => {
  it('windows', () => {
    assert.match(missingFrequencyReason(detail({ platform: 'windows' }), 'max'), /Windows does not report a maximum boost/);
  });
  it('virtual machine on linux', () => {
    const vm = detail({ identity: { ...detail().identity, virtualized: true } });
    assert.match(missingFrequencyReason(vm, 'max'), /virtual machine/);
    assert.match(missingFrequencyReason(detail(), 'max'), /frequency driver/);
  });
});
