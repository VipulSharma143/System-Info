// Runs the measurement script against the fake backend and checks that it reports a clear cold-vs-warm difference.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('measure-startup reports a faster warm start when a cache exists', () => {
  const out = mkdtempSync(join(tmpdir(), 'ms-test-'));
  try {
    const json = join(out, 'r.json');
    execFileSync(process.execPath, ['scripts/measure-startup.mjs', '--exe', process.execPath, '--args', 'tests/tools/fake-backend.mjs', '--runs', '2', '--port', '5188', '--json', json], { stdio: 'pipe' });
    const r = JSON.parse(readFileSync(json, 'utf8'));
    const med = (xs) => xs.map((x) => x.info).sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    assert.equal(r.cold.length, 2);
    assert.equal(r.warm.length, 2);
    assert.ok(med(r.cold) >= 400, `cold start waits for collection (${med(r.cold)} ms)`);
    assert.ok(med(r.warm) < 300, `warm start answers from the cache (${med(r.warm)} ms)`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
