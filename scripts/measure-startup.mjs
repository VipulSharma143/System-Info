#!/usr/bin/env node
// Startup and soak measurement for the backend, the same way on Windows and Linux.
//
//   node scripts/measure-startup.mjs --exe <path-to-backend-executable> [--runs 3] [--port 5199]
//                                    [--soak-minutes 0] [--json out.json]
//
//   cold  = the backend's data directory (and therefore its startup cache) is deleted before launch
//   warm  = the directory from the cold run is reused, so the cache exists
//   For each run it reports ms until /health answers, until /api/system/all answers, and until /api/system/info
//   answers (the System page, which the cache exists to speed up), plus RSS and thread count shortly after start.
//   --soak-minutes N keeps the last process running and samples RSS/threads every 10 s, then reports growth per hour,
//   so a leak shows up as a slope instead of a feeling.
//   Linux reads RSS/threads from /proc; Windows uses `tasklist` (RSS) and PowerShell (threads).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []));
const exe = args.exe;
const runs = Number(args.runs ?? 3);
const port = Number(args.port ?? 5199);
const soakMinutes = Number(args['soak-minutes'] ?? 0);
const argv = args.args ? args.args.split(' ') : [];

if (!exe) {
  console.error('usage: node scripts/measure-startup.mjs --exe <backend executable> [--runs 3] [--port 5199] [--soak-minutes 0] [--json out.json]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${port}`;

async function untilOk(path, started, timeoutMs = 60_000) {
  while (performance.now() - started < timeoutMs) {
    try {
      const res = await fetch(base + path);
      if (res.ok) return Math.round(performance.now() - started);
    } catch { /* not listening yet */ }
    await sleep(25);
  }
  return null;
}

function processStats(pid) {
  try {
    if (process.platform === 'linux') {
      const text = readFileSync(`/proc/${pid}/status`, 'utf8');
      const rssKb = Number(/VmRSS:\s+(\d+)/.exec(text)?.[1] ?? NaN);
      const threads = Number(/Threads:\s+(\d+)/.exec(text)?.[1] ?? NaN);
      return { rssMb: rssKb / 1024, threads };
    }
    if (process.platform === 'win32') {
      const mem = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      const rssKb = Number(mem.split('","')[4]?.replace(/[^\d]/g, '') ?? NaN);
      const threads = Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).Threads.Count`], { encoding: 'utf8' }).trim());
      return { rssMb: rssKb / 1024, threads };
    }
  } catch { /* process gone */ }
  return { rssMb: NaN, threads: NaN };
}

async function launch(dataDir) {
  const started = performance.now();
  const child = spawn(exe, argv, {
    env: { ...process.env, ASPNETCORE_URLS: base, ASPNETCORE_ENVIRONMENT: 'Production', SYSTEM_INFO_DATA_DIR: dataDir, DOTNET_gcServer: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const exited = new Promise((r) => child.once('exit', r));
  const health = await untilOk('/health', started);
  const all = await untilOk('/api/system/all', started);
  const info = await untilOk('/api/system/info', started);
  await sleep(1500);
  return { child, exited, started, health, all, info, ...processStats(child.pid) };
}

async function stop(run) {
  run.child.kill();
  await Promise.race([run.exited, sleep(5000)]);
}

const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const fmt = (n) => (n == null || Number.isNaN(n) ? 'n/a' : Math.round(n));

const dataDir = mkdtempSync(join(tmpdir(), 'systeminfo-startup-'));
const results = { cold: [], warm: [] };
try {
  for (let i = 0; i < runs; i += 1) {
    rmSync(dataDir, { recursive: true, force: true });           // cold: no cache
    const cold = await launch(dataDir);
    results.cold.push(cold);
    await stop(cold);

    const warm = await launch(dataDir);                          // warm: cache written by the cold run
    results.warm.push(warm);
    if (i < runs - 1 || soakMinutes === 0) await stop(warm);
    else results.soak = warm;
  }

  console.log(`runs: ${runs}   (ms until the endpoint answered; medians)`);
  console.log('            /health   /api/system/all   /api/system/info   RSS MB   threads');
  for (const kind of ['cold', 'warm']) {
    const r = results[kind];
    console.log(`${kind.padEnd(10)}  ${String(fmt(median(r.map((x) => x.health)))).padStart(7)}   ${String(fmt(median(r.map((x) => x.all)))).padStart(15)}   ${String(fmt(median(r.map((x) => x.info)))).padStart(16)}   ${String(fmt(median(r.map((x) => x.rssMb)))).padStart(6)}   ${String(fmt(median(r.map((x) => x.threads)))).padStart(7)}`);
  }
  const coldInfo = median(results.cold.map((x) => x.info)), warmInfo = median(results.warm.map((x) => x.info));
  if (coldInfo && warmInfo) console.log(`System page ready: cold ${coldInfo} ms -> warm ${warmInfo} ms (${Math.round((1 - warmInfo / coldInfo) * 100)}% faster with the cache)`);

  if (soakMinutes > 0 && results.soak) {
    const samples = [];
    const end = Date.now() + soakMinutes * 60_000;
    while (Date.now() < end) {
      await sleep(10_000);
      await fetch(`${base}/api/system/all`).catch(() => undefined);
      samples.push({ t: Date.now(), ...processStats(results.soak.child.pid) });
    }
    await stop(results.soak);
    const first = samples[Math.floor(samples.length * 0.2)] ?? samples[0];     // skip warm-up growth
    const last = samples.at(-1);
    const hours = (last.t - first.t) / 3_600_000;
    const slope = hours > 0 ? (last.rssMb - first.rssMb) / hours : NaN;
    console.log(`soak ${soakMinutes} min: RSS ${first.rssMb.toFixed(1)} -> ${last.rssMb.toFixed(1)} MB (${slope.toFixed(2)} MB/hour after warm-up), threads ${first.threads} -> ${last.threads}`);
    results.soakSummary = { slopeMbPerHour: slope, firstRssMb: first.rssMb, lastRssMb: last.rssMb, firstThreads: first.threads, lastThreads: last.threads };
  }
  if (args.json) {
    const strip = (r) => ({ health: r.health, all: r.all, info: r.info, rssMb: r.rssMb, threads: r.threads });
    writeFileSync(args.json, JSON.stringify({ cold: results.cold.map(strip), warm: results.warm.map(strip), soak: results.soakSummary ?? null }, null, 2));
  }
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
