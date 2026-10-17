import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupProcesses, matches, share, sortProcesses, totals } from '../src/components/views/processes/model.ts';
import { fullestDrive, overallState, rankProcesses } from '../src/components/views/overview/model.ts';
import { interfaceKind, interfaceRows, isLive, summarise } from '../src/lib/network.ts';

const procs = [
  { pid: 10, name: 'chrome', memoryMB: 400 },
  { pid: 11, name: 'chrome', memoryMB: 200 },
  { pid: 12, name: 'code', memoryMB: 300 },
  { pid: 13, name: 'sshd', memoryMB: 10 },
];

describe('processes model', () => {
  it('totals and top-five share', () => {
    const t = totals(procs);
    assert.equal(t.count, 4);
    assert.equal(t.memoryMB, 910);
    assert.equal(t.heaviest?.pid, 10);
    assert.equal(t.topFiveShare, 100);
    assert.equal(totals([]).topFiveShare, null);
    assert.equal(totals([]).heaviest, null);
  });

  it('filters by name or pid, case-insensitively', () => {
    assert.ok(matches(procs[0], 'CHR'));
    assert.ok(matches(procs[2], '12'));
    assert.ok(!matches(procs[3], 'chrome'));
    assert.ok(matches(procs[3], '   '));
  });

  it('sorts each way with a stable pid tie-break', () => {
    assert.deepEqual(sortProcesses(procs, 'memory').map((p) => p.pid), [10, 12, 11, 13]);
    assert.deepEqual(sortProcesses(procs, 'name').map((p) => p.pid), [10, 11, 12, 13]);
    assert.deepEqual(sortProcesses([...procs].reverse(), 'pid').map((p) => p.pid), [10, 11, 12, 13]);
  });

  it('groups same-named processes with a combined size', () => {
    const g = groupProcesses(procs, 'memory');
    assert.deepEqual(g.map((x) => [x.name, x.count, x.memoryMB]), [['chrome', 2, 600], ['code', 1, 300], ['sshd', 1, 10]]);
    assert.deepEqual(g[0].members.map((m) => m.pid), [10, 11]);
  });

  it('share is clamped and safe with no total', () => {
    assert.equal(share(50, 200), 25);
    assert.equal(share(5, 0), 0);
    assert.equal(share(500, 200), 100);
  });
});

describe('overview model', () => {
  it('says smooth below the thresholds', () => {
    const s = overallState(20, 40, { name: 'C:', percent: 60 });
    assert.equal(s.tone, 'ok');
    assert.deepEqual(s.drivers, []);
  });

  it('names what is high, warm then critical', () => {
    const warm = overallState(75, 40, null);
    assert.equal(warm.tone, 'warn');
    assert.match(warm.detail, /Processor 75%/);
    const hot = overallState(95, 92, { name: '/', percent: 10 });
    assert.equal(hot.tone, 'critical');
    assert.deepEqual(hot.drivers.map((d) => d.label), ['Processor', 'Memory']);
  });

  it('finds the fullest drive and handles none', () => {
    assert.equal(fullestDrive([]), null);
    const d = fullestDrive([
      { name: 'C:', volumeLabel: '', driveType: 'Fixed', totalGB: 100, freeGB: 50, usedGB: 50, usedPercent: 50 },
      { name: 'D:', volumeLabel: '', driveType: 'Fixed', totalGB: 100, freeGB: 10, usedGB: 90, usedPercent: 90 },
    ]);
    assert.equal(d?.name, 'D:');
  });

  it('ranks processes relative to the heaviest and to the total', () => {
    const r = rankProcesses(procs, 2);
    assert.equal(r.length, 2);
    assert.equal(r[0].relative, 100);
    assert.equal(r[1].relative, 75);
    assert.ok(Math.abs(r[0].shareOfAll - (400 / 910) * 100) < 1e-9);
    assert.deepEqual(rankProcesses([], 3), []);
  });
});

describe('network model', () => {
  it('classifies by name only, and leaves unknown names alone', () => {
    assert.equal(interfaceKind('lo'), 'loopback');
    assert.equal(interfaceKind('wlp3s0'), 'wifi');
    assert.equal(interfaceKind('Wi-Fi'), 'wifi');
    assert.equal(interfaceKind('enp0s31f6'), 'ethernet');
    assert.equal(interfaceKind('Ethernet 2'), 'ethernet');
    assert.equal(interfaceKind('docker0'), 'virtual');
    assert.equal(interfaceKind('vEthernet (WSL)'), 'virtual');
    assert.equal(interfaceKind('Local Area Connection* 9'), 'other');
  });

  it('lists active interfaces first, busiest first, and never drops idle ones', () => {
    const rows = interfaceRows([
      { iface: 'lo', rxKBps: 0, txKBps: 0 },
      { iface: 'eth0', rxKBps: 10, txKBps: 5 },
      { iface: 'wlan0', rxKBps: 300, txKBps: 100 },
    ]);
    assert.deepEqual(rows.map((r) => r.net.iface), ['wlan0', 'eth0', 'lo']);
    assert.ok(Math.abs(rows.reduce((s, r) => s + r.share, 0) - 100) < 1e-9);
    assert.equal(rows[2].share, 0);
    assert.ok(isLive(rows[0].net) && !rows[2].live);
  });

  it('summarises a window and returns null when empty', () => {
    assert.deepEqual(summarise([1, 3, 2]), { peak: 3, average: 2 });
    assert.equal(summarise([]), null);
  });
});
